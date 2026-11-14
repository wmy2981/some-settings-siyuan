/**
 * 「清除本插件配置」（clear-config）。
 *
 * 唯一入口是一条动作按钮：确认框 → 调 core 清目录 → 提示 → 重新载入前端。
 * 这里逐条守住「取消时什么都不做」「失败不装作清干净了」「确认框的删除型按钮」，
 * 以及那段只作用于确认弹窗的聚焦态样式 —— 它没法靠类的挂载时刻拿到元素，
 * 只能事后塞进最后一个 `[data-key="dialog-confirm"]`。
 */
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import {setDetailedLogging} from "../../src/core/log";
import {clearAllConfigs} from "../../src/features/clear-config/clear";
import zhCN from "../../src/i18n/zh-CN.json";
import {createActionContext} from "../helpers/feature-host";
import {mockState} from "../mocks/siyuan";

/**
 * 记录每一次 `confirm()` 的完整入参。
 *
 * 宿主替身的 `confirm` 只接收前 4 个参数，而这里要断言的正是第 5 个
 * （`isDelete`，它决定按钮是红色删除样式、文案变成「删除」），所以包一层只记录不改行为。
 */
const confirmArgs: unknown[][] = [];

beforeEach(() => {
    // 失败路径只通过 reportError 留下控制台记录
    setDetailedLogging(true);
});

afterEach(() => {
    setDetailedLogging(false);
});

vi.mock("siyuan", async (importOriginal) => {
    const actual = await importOriginal<Record<string, any>>();
    return {
        ...actual,
        confirm: (...args: unknown[]) => {
            confirmArgs.push(args);
            return actual.confirm(...args);
        },
    };
});

const t = (key: string): string => (zhCN as Record<string, string>)[key] ?? key;

const action = () => createActionContext({featureId: "clear-config", i18n: t});

/** 动作行里那条异步链没有返回 Promise 给我们等，自己排空微任务。 */
const flush = async (): Promise<void> => {
    for (let i = 0; i < 6; i += 1) {
        await Promise.resolve();
    }
};

/**
 * 把 `window.setTimeout` 换成「只记录不调度」。
 *
 * `window.location` 在 jsdom 里不可重定义，`reload` 挂不上 spy；能断言的只有
 * 「排了一个 600ms 的重新载入」这个事实。真触发只会得到 jsdom 的 navigation 噪声。
 */
const captureTimeouts = () => {
    const timers: {handler: TimerHandler; delay?: number;}[] = [];
    vi.spyOn(window, "setTimeout").mockImplementation(
        ((handler: TimerHandler, delay?: number) => {
            timers.push({handler, delay});
            return timers.length;
        }) as unknown as typeof window.setTimeout,
    );
    return timers;
};

/** 造一个与内核一致的确认弹窗外壳。 */
const addConfirmDialog = (): HTMLElement => {
    const element = document.createElement("div");
    element.setAttribute("data-key", "dialog-confirm");
    element.innerHTML = '<button id="confirmDialogConfirmBtn" class="b3-button b3-button--remove"></button>';
    document.body.append(element);
    return element;
};

describe("清除本插件配置", () => {
    it("先问一句：标题、说明、确定回调、没有取消回调，并且是删除型按钮", () => {
        // isDelete 为 true 时内核把按钮画成红色线框、文案换成「删除」；
        // 清除配置不可撤销，不能显示成默认的蓝色文字按钮
        const {context} = action();
        clearAllConfigs(context);

        expect(mockState.confirms).toEqual([{
            title: zhCN["feature.clearConfig.confirmTitle"],
            text: zhCN["feature.clearConfig.confirmText"],
            accepted: true,
        }]);
        expect(confirmArgs[0]).toHaveLength(5);
        expect(typeof confirmArgs[0][2]).toBe("function");
        expect(confirmArgs[0][3]).toBeUndefined();
        expect(confirmArgs[0][4]).toBe(true);
    });

    it("取消时什么都不做：不清除、不提示、不重载", async () => {
        // 取消分支最容易写成「反正用户会再点」，一旦漏判就是直接删掉全部配置
        mockState.confirmAnswer = false;
        const timers = captureTimeouts();
        const {context, calls} = action();

        clearAllConfigs(context);
        await flush();

        expect(calls.clear).toBe(0);
        expect(mockState.messages).toEqual([]);
        expect(timers).toEqual([]);
    });

    it("确认后清除一次、提示 3 秒，并排一次 600ms 后的重新载入", async () => {
        const timers = captureTimeouts();
        const {context, calls} = action();

        clearAllConfigs(context);
        await flush();

        expect(calls.clear).toBe(1);
        expect(mockState.messages).toEqual([{text: zhCN["feature.clearConfig.done"], timeout: 3000, type: undefined}]);
        // 重新载入是唯一能同时收掉面板草稿、又让插件按默认配置重装的做法
        expect(timers.map((timer) => timer.delay)).toEqual([600]);
        expect(typeof timers[0].handler).toBe("function");
    });

    it("有文件删不掉时不留「已清除」的假象：报错、不提示完成、不重载", async () => {
        // 重新载入会把没删掉的那份配置又读回来，用户以为清干净了其实没有
        const timers = captureTimeouts();
        const failure = new Error("feature-alpha: permission denied");
        const {context} = action();
        // 这个替身默认「清除一定成功」，失败路径只能就地换掉那一个方法
        (context as unknown as {clearAllConfigs: () => Promise<void>;}).clearAllConfigs = async () => {
            throw failure;
        };

        clearAllConfigs(context);
        await flush();

        expect(console.error).toHaveBeenCalledWith(expect.stringContaining("clear-config.clear"));
        expect(mockState.messages.map((message) => message.text)).not.toContain(zhCN["feature.clearConfig.done"]);
        expect(mockState.messages.at(-1)!.text).toContain("permission denied");
        expect(mockState.messages.at(-1)!.type).toBe("error");
        expect(timers).toEqual([]);
    });

    it("把「已聚焦但指针不在上面」的删除按钮底色压平到最后一个确认弹窗里", () => {
        // confirm 一打开就把焦点放到确认按钮上，红色线框会被 :focus 的浅红底色填成实心；
        // 规则只能塞进弹窗元素本身，弹窗销毁时一起消失，不影响别的确认框
        const first = addConfirmDialog();
        const last = addConfirmDialog();
        const {context} = action();

        clearAllConfigs(context);

        const style = last.querySelector("style")!;
        expect(style).not.toBeNull();
        expect(style.textContent)
            .toBe("#confirmDialogConfirmBtn:focus:not(:hover):not(:active) { background-color: transparent; }");
        // 只补最后一个：弹窗可以叠加，最后进 DOM 的才是这次 confirm 建出来的
        expect(first.querySelector("style")).toBeNull();
        // 挂在弹窗自己身上，弹窗没了规则就没了
        expect(style.parentElement).toBe(last);
    });

    it("确认框还没进 DOM 时静默跳过补样式，主流程照常执行", () => {
        // 某些宿主版本建窗是异步的；这里少一段样式顶多是按钮看着偏实心，
        // 绝不能因此让清除流程抛错
        const {context, calls} = action();

        expect(() => clearAllConfigs(context)).not.toThrow();
        expect(calls.clear).toBe(1);
    });

    it("声明为永不挂载的动作按钮", async () => {
        const {default: definition} = await import("../../src/features/clear-config/index");
        expect(definition.mount).toBeUndefined();
        expect(definition.isEnabled!({})).toBe(false);
        expect(definition.settings).toHaveLength(1);
        expect(definition.settings[0]).toMatchObject({
            kind: "button",
            key: "clear",
            title: "feature.clearConfig.dialogTitle",
            description: "feature.clearConfig.tip",
            label: "feature.clearConfig.action",
        });
    });
});
