/**
 * 测试公共环境。
 *
 * 每个测试前把 DOM、`window.siyuan`（宿主注入的全局配置）和宿主替身的状态复位，
 * 让测试之间互不影响；同时把 `console` 的噪声压掉，只在断言里显式观察。
 */
import {webcrypto} from "node:crypto";
import {ReadableStream as NodeReadableStream} from "node:stream/web";
import {
    afterEach,
    beforeEach,
    vi,
} from "vitest";
import {
    closeOpenSettings,
    resetMockState,
} from "./mocks/siyuan";

// vmThreads 的隔离上下文不会自动带全 Node 的 Web API，按测试运行时的真实能力补齐。
// 类型上只当作一张可写表：这里写的是运行时的宿主形状，不是给 `Window` 补声明。
const runtime = globalThis as unknown as Record<string, unknown>;
runtime.window ??= runtime;
runtime.ReadableStream ??= NodeReadableStream;
runtime.crypto ??= webcrypto;
if (typeof window.crypto?.subtle === "undefined") {
    Object.defineProperty(window, "crypto", {configurable: true, value: webcrypto});
}

/** 宿主注入 `window.siyuan` 的最小形状：核心用到的字段都在这里。 */
const baseSiyuan = () => ({
    config: {
        readonly: false,
        system: {
            kernelVersion: "3.8.7",
            container: "",
        },
    },
    isPublish: false,
    languages: {
        cancel: "Cancel",
        save: "Save",
    },
    ws: {
        app: {
            plugins: [] as unknown[],
        },
    },
});

beforeEach(() => {
    // 纯逻辑测试用 node 环境，避免为每个文件创建昂贵的 jsdom。
    if (typeof document !== "undefined") {
        document.head.innerHTML = "";
        document.body.innerHTML = "";
    }
    // node 环境没有 `window`：模块顶部已经把 `globalThis` 别名成 `window`，这里直接用。
    window.siyuan = baseSiyuan() as unknown as typeof window.siyuan;
    window.open = vi.fn() as unknown as typeof window.open;
    resetMockState();
    // 被隔离的错误路径会打一堆日志，测试里只关心断言，不关心控制台的噪声
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
    // 测试没亲手关掉的面板由宿主侧收掉：面板的销毁回调是它清理定时器的地方，
    // 直接把实例丢掉会留下还在轮询的定时器，在环境拆除后触发未捕获异常。
    closeOpenSettings();
    vi.restoreAllMocks();
});
