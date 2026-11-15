/**
 * `core/clipboard.ts`：复制纯文本。
 *
 * 顺序必须是「原生桥 → Clipboard API → textarea 兜底」，因为移动端 WebView
 * 既没有剪贴板写权限，也可能整个 `navigator.clipboard` 都不存在。
 */
import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import {copyText} from "../../src/core/clipboard";

interface TestHost {
    JSAndroid?: {writeClipboard: (text: string) => void;};
    JSHarmony?: {writeClipboard: (text: string) => unknown;};
    webkit?: {messageHandlers: {setClipboard: {postMessage: (text: string) => void;};};};
}

const host = (): TestHost => window as unknown as TestHost;

const setContainer = (container: string): void => {
    window.siyuan.config.system.container = container;
};

const setClipboard = (clipboard: unknown): void => {
    Object.defineProperty(navigator, "clipboard", {value: clipboard, configurable: true, writable: true});
};

const setExecCommand = (result: boolean | (() => boolean)): ReturnType<typeof vi.fn> => {
    const impl = typeof result === "function" ? result : () => result;
    const spy = vi.fn(impl);
    (document as unknown as {execCommand: unknown;}).execCommand = spy;
    return spy;
};

beforeEach(() => {
    setContainer("");
    setClipboard(undefined);
    delete host().JSAndroid;
    delete host().JSHarmony;
    delete host().webkit;
    setExecCommand(true);
});

describe("copyText", () => {
    it("空文本直接返回 false，不做任何尝试", async () => {
        const writeText = vi.fn(async () => undefined);
        setClipboard({writeText});
        await expect(copyText("")).resolves.toBe(false);
        expect(writeText).not.toHaveBeenCalled();
    });

    it("安卓容器走 App 注入的原生桥", async () => {
        setContainer("android");
        const bridge = vi.fn();
        host().JSAndroid = {writeClipboard: bridge};
        const writeText = vi.fn(async () => undefined);
        setClipboard({writeText});

        await expect(copyText("文本")).resolves.toBe(true);
        expect(bridge).toHaveBeenCalledWith("文本");
        expect(writeText).not.toHaveBeenCalled();
    });

    it("iOS 容器走 messageHandlers", async () => {
        setContainer("ios");
        const postMessage = vi.fn();
        host().webkit = {messageHandlers: {setClipboard: {postMessage}}};

        await expect(copyText("文本")).resolves.toBe(true);
        expect(postMessage).toHaveBeenCalledWith("文本");
    });

    it("鸿蒙桥返回 false 表示没写进去", async () => {
        setContainer("harmony");
        host().JSHarmony = {writeClipboard: () => false};
        await expect(copyText("文本")).resolves.toBe(false);
    });

    it("鸿蒙桥返回其它值时按成功处理", async () => {
        setContainer("harmony");
        host().JSHarmony = {writeClipboard: () => undefined};
        await expect(copyText("文本")).resolves.toBe(true);
    });

    it("容器类型对不上时不用本地桥，继续往下走", async () => {
        setContainer("desktop");
        const bridge = vi.fn();
        host().JSAndroid = {writeClipboard: bridge};
        const writeText = vi.fn(async () => undefined);
        setClipboard({writeText});

        await expect(copyText("文本")).resolves.toBe(true);
        expect(bridge).not.toHaveBeenCalled();
        expect(writeText).toHaveBeenCalledWith("文本");
    });

    it("容器是安卓但桥不存在时继续往下走", async () => {
        setContainer("android");
        const writeText = vi.fn(async () => undefined);
        setClipboard({writeText});

        await expect(copyText("文本")).resolves.toBe(true);
        expect(writeText).toHaveBeenCalledWith("文本");
    });

    it("Clipboard API 被拒绝时退回 textarea + execCommand", async () => {
        setClipboard({
            writeText: vi.fn(async () => {
                throw new Error("denied");
            }),
        });
        const execCommand = setExecCommand(true);

        await expect(copyText("文本")).resolves.toBe(true);
        expect(execCommand).toHaveBeenCalledWith("copy");
        // 兜底用的 textarea 必须收掉，不能留在页面里
        expect(document.querySelector("textarea")).toBeNull();
    });

    it("Clipboard API 不存在时同样走兜底", async () => {
        const execCommand = setExecCommand(true);
        await expect(copyText("文本")).resolves.toBe(true);
        expect(execCommand).toHaveBeenCalledWith("copy");
    });

    it("连 window.siyuan 都不存在时按没有原生桥处理", async () => {
        (window as unknown as {siyuan?: unknown;}).siyuan = undefined;
        const execCommand = setExecCommand(true);
        await expect(copyText("文本")).resolves.toBe(true);
        expect(execCommand).toHaveBeenCalledWith("copy");
    });

    it("execCommand 返回 false 时如实回报失败", async () => {
        setExecCommand(false);
        await expect(copyText("文本")).resolves.toBe(false);
    });

    it("execCommand 抛错时按失败处理，不把异常抛给调用方", async () => {
        setExecCommand(() => {
            throw new Error("blocked");
        });
        await expect(copyText("文本")).resolves.toBe(false);
    });

    it("兜底的 textarea 不可见、只读、带选区，且复制内容正确", async () => {
        setExecCommand(() => {
            const area = document.querySelector("textarea") as HTMLTextAreaElement;
            expect(area.value).toBe("多行\n文本");
            expect(area.getAttribute("readonly")).toBe("true");
            expect(area.style.opacity).toBe("0");
            expect(area.style.position).toBe("fixed");
            expect(area.selectionStart).toBe(0);
            expect(area.selectionEnd).toBe("多行\n文本".length);
            return true;
        });
        await expect(copyText("多行\n文本")).resolves.toBe(true);
    });
});
