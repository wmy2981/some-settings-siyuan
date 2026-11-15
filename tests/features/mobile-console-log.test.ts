/**
 * 控制台日志查看器（mobile-console-log）。
 *
 * 要守的三层：
 * 1. **拦截**：挂载后 console 的五个方法被包一层，日志照旧进真控制台，同时进环形缓冲；
 *    卸载必须原样还原（否则插件卸载后整页控制台都留在包装层里）。
 * 2. **缓冲**：容量从配置读、夹在 200～20000，非法/非正数回落默认值，超出丢最早的。
 * 3. **窗口**：逐条渲染（时间/级别/文本，HTML 转义）、计数、复制全部、清空、单实例。
 */
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import type {FeatureConfig} from "../../src/core/types";
import {
    mountConsoleLog,
    openConsoleLog,
} from "../../src/features/mobile-console-log/console";
import definition from "../../src/features/mobile-console-log/index";
import {mountFeature} from "../helpers/feature-host";
import type {HostHarness} from "../helpers/feature-host";

/**
 * 原生 console。模块加载时抓一份，任何测试之后都还原回去：
 * 被测功能会直接改写 `console[level]`，而 `tests/setup.ts` 的 spy 每轮只加在
 * 「上一轮留下的函数」上，不还原就会一层套一层，断言到底调了几次就没法算了。
 */
const nativeConsole = {
    debug: console.debug,
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
};

/** 让 i18n 返回可断言的文案；计数那条必须保留 `${count}` 占位符，功能就是靠它替换的。 */
const messages: Record<string, string> = {
    "feature.mobileConsoleLog.dialogTitle": "控制台日志",
    "feature.mobileConsoleLog.count": "共 ${count} 条",
    "feature.mobileConsoleLog.copy": "复制全部",
    "feature.mobileConsoleLog.clear": "清空",
    "common.copied": "已复制全部日志",
    "common.copyFailed": "复制失败",
    "feature.mobileConsoleLog.empty": "还没有日志",
};
const i18n = (key: string): string => messages[key] ?? key;

const mounted: HostHarness[] = [];

const mount = (config: FeatureConfig = {}): HostHarness => {
    const harness = mountFeature(definition, {config, i18n});
    mounted.push(harness);
    return harness;
};

/** 缓冲在模块作用域里，跨用例共享；每条用例开始前通过「清空」按钮把它清掉。 */
const resetEntries = (): void => {
    const harness = mount();
    openConsoleLog();
    document.querySelector<HTMLButtonElement>("[data-log-clear]")?.click();
    harness.dispose();
};

/**
 * 把 console 的五个方法换成安静的空实现。
 *
 * 一层是隔离上一轮的包装层（`uninstall` 交还的是当初 `bind` 出来的新函数），
 * 一层是让测试输出不被打满 —— 这些日志正是被测对象，断言走缓冲不靠 stdout。
 */
const silenceConsole = (): Record<string, ReturnType<typeof vi.fn>> => {
    const passthrough = {
        debug: vi.fn(),
        log: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    };
    Object.assign(console, passthrough);
    return passthrough;
};

/** 把 `requestAnimationFrame` 换成可显式驱动的队列（源码的刷新排在帧回调里）。 */
const stubFrames = () => {
    const pending = new Map<number, FrameRequestCallback>();
    let nextId = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback): number => {
        nextId += 1;
        pending.set(nextId, callback);
        return nextId;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((handle: number): void => {
        pending.delete(handle);
    });
    return {
        pending: () => pending.size,
        flush: async (): Promise<void> => {
            const callbacks = [...pending.values()];
            pending.clear();
            callbacks.forEach((callback) => callback(0));
            await Promise.resolve();
        },
    };
};

const rows = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>(".ss-console-log__row"));
const textsOf = (selector: string): string[] =>
    Array.from(document.querySelectorAll<HTMLElement>(selector)).map((element) => element.textContent ?? "");
const countText = (): string => document.querySelector<HTMLElement>("[data-log-count]")?.textContent ?? "";

beforeEach(() => {
    resetEntries();
    silenceConsole();
});

afterEach(() => {
    mounted.splice(0).forEach((harness) => harness.dispose());
    // 万一断言失败让 dispose 没走到，这里也把 console 拔回原生实现
    Object.assign(console, nativeConsole);
    vi.useRealTimers();
});

describe("控制台日志查看器", () => {
    it("声明里只在移动端出现、默认关闭，容量与入口的默认值固定", () => {
        expect(definition.id).toBe("mobile-console-log");
        expect(definition.category).toBe("settings");
        expect(definition.enabled).toBe(true);
        // 手机上根本没有开发者控制台，这个功能只在移动端有意义
        expect(definition.frontends).toEqual(["mobile"]);
        expect(definition.settings.map((field) => field.kind)).toEqual(["switch", "number", "button"]);

        const [enabled, capacity, entry] = definition.settings as any[];
        expect(enabled).toMatchObject({key: "enabled", default: false});
        expect(capacity).toMatchObject({
            key: "capacity",
            default: 2000,
            min: 200,
            max: 20000,
            step: 100,
            unit: "feature.mobileConsoleLog.entries",
        });
        // 入口是一行动作按钮：点击直接调 openConsoleLog（不写配置、不进草稿）
        expect(entry.key).toBe("open");
        expect(entry.onClick).toBe(openConsoleLog);
        expect(definition.mount).toBe(mountConsoleLog);
    });

    it("挂载后包住五个 console 方法，原方法仍然照常被调用", () => {
        const passthrough = console.log as unknown as ReturnType<typeof vi.fn>;
        const harness = mount();

        // 样式必须覆盖列表与各级别的配色，否则深色主题下日志看不见
        expect(harness.css()).toContain(".ss-console-log__list");
        expect(harness.css()).toContain(".ss-console-log__row--error .ss-console-log__level");
        expect(harness.styleElement()).not.toBeNull();

        expect(console.log).not.toBe(passthrough);
        console.log("hello");
        // 「照旧出现在真正的控制台里」是这套包装的前提，不能只收日志不上报
        expect(passthrough).toHaveBeenCalledWith("hello");

        openConsoleLog();
        expect(textsOf(".ss-console-log__text")).toEqual(["hello"]);
    });

    it("逐条渲染时间、级别与文本，并把 HTML 转义掉", () => {
        mount();
        console.log("hello");
        console.log({a: 1});
        console.error(new TypeError("boom"));
        console.warn(undefined);
        console.info(function namedFn(): void {});
        console.debug("<b>x</b>");
        openConsoleLog();

        expect(rows()).toHaveLength(6);
        expect(textsOf(".ss-console-log__level")).toEqual(["log", "log", "error", "warn", "info", "debug"]);
        expect(textsOf(".ss-console-log__text")).toEqual([
            "hello",
            // 对象走 JSON、Error 走 name: message、undefined 与函数各有固定写法：
            // 用户看到的就是这几类值的唯一可读形式，改了就等于日志失真
            '{"a":1}',
            "TypeError: boom",
            "undefined",
            "[function namedFn]",
            "<b>x</b>",
        ]);
        // 日志文本来自任意来源，直接拼进 innerHTML 就是注入
        expect(rows()[5].querySelector(".ss-console-log__text")?.innerHTML).toBe("&lt;b&gt;x&lt;/b&gt;");
        textsOf(".ss-console-log__time").forEach((time) => {
            expect(time).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
        });
        expect(countText()).toBe("共 6 条");
    });

    it("超出容量时丢最早的日志，只留最后 capacity 条", () => {
        mount({capacity: 200});
        for (let index = 1; index <= 250; index += 1) {
            console.log(`m${index}`);
        }
        openConsoleLog();

        expect(rows()).toHaveLength(200);
        expect(textsOf(".ss-console-log__text")[0]).toBe("m51");
        expect(textsOf(".ss-console-log__text")[199]).toBe("m250");
        expect(countText()).toBe("共 200 条");
    });

    it("容量配置低于下限时抬到 200，高于上限时压到 20000", () => {
        mount({capacity: 50});
        for (let index = 0; index < 260; index += 1) {
            console.log(`low${index}`);
        }
        openConsoleLog();
        // 50 是设置项允许被绕过的最小值，功能必须自己兜住，否则日志没存几条就被丢光
        expect(countText()).toBe("共 200 条");
        expect(textsOf(".ss-console-log__text")[0]).toBe("low60");
        mounted.splice(0).forEach((harness) => harness.dispose());
        resetEntries();

        mount({capacity: 99999});
        for (let index = 0; index < 20005; index += 1) {
            console.log(`high${index}`);
        }
        openConsoleLog();
        expect(countText()).toBe("共 20000 条");
        // 渲染上限是 4000 行（大桶容量下一次性拼两万行 DOM 会卡死移动端），
        // 所以窗口里看到的是缓冲末尾的那 4000 条
        expect(rows()).toHaveLength(4000);
        expect(textsOf(".ss-console-log__text")[0]).toBe("high16005");
        expect(textsOf(".ss-console-log__text")[3999]).toBe("high20004");
    });

    it("容量是 0 / 负数 / 非数字时回落到默认 2000 条", () => {
        // 0 与负数会被归一化丢弃，NaN 说明配置被写坏了：三种都只该退到默认值
        mount({capacity: 0});
        for (let index = 0; index < 2005; index += 1) {
            console.log(`d${index}`);
        }
        openConsoleLog();
        expect(countText()).toBe("共 2000 条");
        expect(textsOf(".ss-console-log__text")[0]).toBe("d5");
    });

    it("清空按钮丢掉全部日志，随后新日志仍会继续收", async () => {
        const frames = stubFrames();
        mount({capacity: 200});
        console.log("first");
        console.log("second");
        openConsoleLog();
        expect(rows()).toHaveLength(2);

        document.querySelector<HTMLButtonElement>("[data-log-clear]")?.click();
        expect(rows()).toHaveLength(0);
        expect(countText()).toBe("共 0 条");
        expect(document.querySelector(".ss-console-log__empty")?.textContent).toBe("还没有日志");

        console.log("after-clear");
        await frames.flush();
        // 清空只清缓冲，拦截仍在：下一行必须在打开着的窗口里自己冒出来
        expect(textsOf(".ss-console-log__text")).toEqual(["after-clear"]);
    });

    it("复制全部把纯文本送进剪贴板，失败时给出失败提示", async () => {
        const writeText = vi.fn<(...args: [string]) => Promise<void>>(async () => undefined);
        Object.defineProperty(navigator, "clipboard", {
            value: {writeText},
            configurable: true,
        });
        const harness = mount();
        console.log("alpha");
        console.error("beta");
        openConsoleLog();

        document.querySelector<HTMLButtonElement>("[data-log-copy]")?.click();
        await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
        const copied = writeText.mock.calls[0][0];
        expect(copied.split("\n")).toHaveLength(2);
        expect(copied).toMatch(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\] LOG alpha$/m);
        expect(copied).toMatch(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\] ERROR beta$/m);
        // showMessage 排在 copyText 的 then 里，等它落定再断言
        await vi.waitFor(() => expect(harness.records.messages).toEqual(["已复制全部日志"]));

        // 没有 Clipboard API、execCommand 也不可用（jsdom 里就是 undefined）：只能报失败
        Object.defineProperty(navigator, "clipboard", {value: undefined, configurable: true});
        document.querySelector<HTMLButtonElement>("[data-log-copy]")?.click();
        await vi.waitFor(() => expect(harness.records.messages).toEqual(["已复制全部日志", "复制失败"]));
    });

    it("重复点入口只保留一个窗口", () => {
        mount();
        openConsoleLog();
        openConsoleLog();
        // 复制/清空按钮各只有一份：第二次点击不能把内容再渲染一遍
        expect(document.querySelectorAll(".ss-console-log")).toHaveLength(1);
        expect(document.querySelectorAll("[data-log-copy]")).toHaveLength(1);
    });

    it("功能没挂载时点入口什么都不做（没有宿主可拿来弹窗）", () => {
        openConsoleLog();
        expect(document.querySelector(".ss-console-log")).toBeNull();
        expect(document.querySelectorAll(".b3-dialog")).toHaveLength(0);
    });

    it("dispose 还原 console、收掉窗口并停掉未执行的刷新帧", () => {
        const frames = stubFrames();
        const passthrough = console.log as unknown as ReturnType<typeof vi.fn>;
        const harness = mount();
        const wrapped = console.log;
        openConsoleLog();
        console.log("during");
        expect(frames.pending()).toBe(1);

        harness.dispose();
        // 宿主卸载后整页控制台还留在包装层里，就会继续往一个没人再看的缓冲里塞日志
        expect(console.log).not.toBe(wrapped);
        console.log("after-dispose");
        expect(passthrough).toHaveBeenCalledWith("after-dispose");
        expect(document.querySelector(".ss-console-log")).toBeNull();
        expect(frames.pending()).toBe(0);
        expect(harness.styleElement()).toBeNull();

        // 重新挂载后打开窗口：缓冲里只该有卸载前的 "during"，之后的日志不再被收
        mount();
        openConsoleLog();
        expect(textsOf(".ss-console-log__text")).toEqual(["during"]);
    });

    it("保存新的容量后立即裁剪已有日志，并继续按新容量收", async () => {
        const frames = stubFrames();
        const harness = mount({capacity: 400});
        for (let index = 1; index <= 450; index += 1) {
            console.log(`c${index}`);
        }
        openConsoleLog();
        expect(countText()).toBe("共 400 条");

        harness.config.capacity = 200;
        harness.notifyConfigChange();
        console.log("c451");
        await frames.flush();

        expect(countText()).toBe("共 200 条");
        // 裁剪留下的必须是最近的 200 条（c252～c451），而不是最早的
        expect(textsOf(".ss-console-log__text")[0]).toBe("c252");
        expect(textsOf(".ss-console-log__text")[199]).toBe("c451");
    });
});
