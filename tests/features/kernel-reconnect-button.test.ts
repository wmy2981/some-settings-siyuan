/**
 * 断连面板「立即重连」按钮（`kernel-reconnect-button`）的单元测试。
 *
 * 两个导出函数（`probeKernel` / `reconnectNow`）单独测，挂载逻辑再按「断连面板出现了没有 /
 * 动作区在不在」分支测。探活有 2000ms 超时，所以整个文件都用假定时器，
 * 只有这样才能断言「没有回应就算没恢复」而不是干等两秒。
 */
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import {
    probeKernel,
    reconnectNow,
} from "../../src/features/kernel-reconnect-button/button";
import kernelReconnectButton from "../../src/features/kernel-reconnect-button/index";
import {mountFeature} from "../helpers/feature-host";
import type {HostHarness} from "../helpers/feature-host";
import {mockState} from "../mocks/siyuan";

/** jsdom 的 location 不可 spy，只能整块替换后还原。 */
const locationDescriptor = Object.getOwnPropertyDescriptor(window, "location");

const stubLocation = (): ReturnType<typeof vi.fn> => {
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
        configurable: true,
        writable: true,
        value: {reload, href: "http://localhost/", search: ""},
    });
    return reload;
};

const restoreLocation = (): void => {
    if (locationDescriptor) {
        Object.defineProperty(window, "location", locationDescriptor);
    }
};

const tick = async (rounds = 4): Promise<void> => {
    for (let index = 0; index < rounds; index++) {
        await Promise.resolve();
    }
};

/** 内核按固定 code 应答探活。 */
const answerProbe = (code: number): void => {
    (mockState.fetchPost as unknown as {mockImplementation: (fn: unknown) => void;}).mockImplementation(
        async (...args: unknown[]) => {
            (args[2] as (response: unknown) => void)({code});
            return {code};
        },
    );
};

/** 探活请求永不回应（内核真的没了）。 */
const hangProbe = (): void => {
    (mockState.fetchPost as unknown as {mockImplementation: (fn: unknown) => void;}).mockImplementation(
        () => new Promise(() => undefined),
    );
};

const I18N: Record<string, string> = {
    "feature.kernelReconnectButton.label": "立即重连",
    "feature.kernelReconnectButton.working": "正在重连…",
    "feature.kernelReconnectButton.offline": "内核还没有恢复，请稍后再试",
};

const i18n = (key: string): string => I18N[key] ?? key;

/** 造一个断连面板；`action: false` 模拟桌面浏览器那种没有动作区的版本。 */
const showErrorLog = (options: {action?: boolean; body?: boolean;} = {}): HTMLElement => {
    const dialog = document.createElement("div");
    dialog.id = "errorLog";
    const action = options.action === false ?
        "" :
        '<div class="b3-dialog__action"><button class="b3-button">安全退出</button></div>';
    const content = '<p class="b3-dialog__content">内核连接中断</p>';
    dialog.innerHTML = options.body === false ?
        '<div class="b3-dialog__container"></div>' :
        `<div class="b3-dialog__container"><div class="b3-dialog__body">${content}${action}</div></div>`;
    document.body.append(dialog);
    return dialog;
};

const injected = (): HTMLButtonElement[] =>
    Array.from(document.querySelectorAll<HTMLButtonElement>("[data-ss-reconnect]"));

describe("断连面板立即重连按钮", () => {
    let harness: HostHarness | undefined;
    let reload: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.useFakeTimers();
        reload = stubLocation();
    });

    afterEach(() => {
        harness?.dispose();
        harness = undefined;
        vi.useRealTimers();
        restoreLocation();
    });

    describe("probeKernel", () => {
        it("内核回了 code 0 才算恢复", async () => {
            answerProbe(0);
            await expect(probeKernel()).resolves.toBe(true);
            expect(mockState.fetchPost.mock.calls[0].slice(0, 2)).toEqual(["/api/system/currentTime", {}]);
        });

        it("非 0 code 与空响应都算没恢复", async () => {
            answerProbe(1);
            await expect(probeKernel()).resolves.toBe(false);

            (mockState.fetchPost as unknown as {mockImplementation: (fn: unknown) => void;}).mockImplementation(
                async (...args: unknown[]) => {
                    (args[2] as (response: unknown) => void)(undefined);
                    return null;
                },
            );
            await expect(probeKernel()).resolves.toBe(false);
        });

        it("请求一直没有回应时用 2000ms 超时兜底，不会永远挂着", async () => {
            hangProbe();
            let settled: boolean | undefined;
            void probeKernel().then((value) => settled = value);

            await vi.advanceTimersByTimeAsync(1999);
            expect(settled).toBeUndefined();

            await vi.advanceTimersByTimeAsync(1);
            expect(settled).toBe(false);
        });

        it("请求同步抛错时当作没恢复，不把异常抛给调用方", async () => {
            (mockState.fetchPost as unknown as {mockImplementation: (fn: unknown) => void;}).mockImplementation(
                () => {
                    throw new Error("boom");
                },
            );
            await expect(probeKernel()).resolves.toBe(false);
        });
    });

    describe("reconnectNow", () => {
        it("探到内核恢复就重载前端（重载是唯一能重建主 WebSocket 的干净路径）", async () => {
            answerProbe(0);
            const host = {log: {scope: "test", info: vi.fn(), warn: vi.fn(), error: vi.fn()}} as unknown as Parameters<
                typeof reconnectNow
            >[0];

            await expect(reconnectNow(host)).resolves.toBe(true);
            expect(reload).toHaveBeenCalledTimes(1);
            expect(host.log.info).toHaveBeenCalledWith(expect.stringContaining("reloading the frontend"));
        });

        it("内核还没回来就不重载，只返回 false 让人去提示用户", async () => {
            answerProbe(1);
            const host = {log: {scope: "test", info: vi.fn(), warn: vi.fn(), error: vi.fn()}} as unknown as Parameters<
                typeof reconnectNow
            >[0];

            await expect(reconnectNow(host)).resolves.toBe(false);
            expect(reload).not.toHaveBeenCalled();
            expect(host.log.info).not.toHaveBeenCalled();
        });
    });

    describe("挂载", () => {
        it("挂载时没有断连面板就不注入；面板出现后自动补上按钮", async () => {
            harness = mountFeature(kernelReconnectButton, {i18n});
            expect(injected()).toHaveLength(0);

            const dialog = showErrorLog();
            await tick();

            const button = injected()[0];
            expect(button).toBeDefined();
            expect(dialog.querySelector("[data-ss-reconnect]")).toBe(button);
        });

        it("按钮插在内核自己的动作区里，原生「安全退出」保持原位", async () => {
            showErrorLog();
            harness = mountFeature(kernelReconnectButton, {i18n});
            await tick();

            const action = document.querySelector("#errorLog .b3-dialog__action")!;
            const button = injected()[0];
            expect(button.textContent).toBe("立即重连");
            expect(button.getAttribute("type")).toBe("button");
            expect(button.className).toBe("b3-button b3-button--outline");
            // prepend：我们的按钮在「安全退出」前面，原生按钮一个都不动
            expect(action.firstElementChild).toBe(button);
            expect(action.querySelectorAll("button")).toHaveLength(2);
            expect(action.lastElementChild?.textContent).toBe("安全退出");
        });

        it("面板没有动作区时自己补一行，插在正文之后", async () => {
            showErrorLog({action: false});
            harness = mountFeature(kernelReconnectButton, {i18n});
            await tick();

            const body = document.querySelector("#errorLog .b3-dialog__body")!;
            const row = body.querySelector(".b3-dialog__action")!;
            expect(row).not.toBe(null);
            expect(row.querySelector("[data-ss-reconnect]")).not.toBe(null);
            // 补出来的那一行排在正文后面，不能压住内核原来的内容
            expect(body.lastElementChild).toBe(row);
        });

        it("面板既没有动作区也没有正文区时不注入（不硬塞按钮）", async () => {
            showErrorLog({action: false, body: false});
            harness = mountFeature(kernelReconnectButton, {i18n});
            await tick();

            expect(injected()).toHaveLength(0);
        });

        it("同一块面板被反复扫描也只注入一颗按钮", async () => {
            showErrorLog();
            harness = mountFeature(kernelReconnectButton, {i18n});
            await tick();
            document.body.append(document.createElement("div"));
            await tick();
            document.body.append(document.createElement("div"));
            await tick();

            expect(injected()).toHaveLength(1);
        });

        it("内核重新创建面板时会注入到新面板里", async () => {
            const first = showErrorLog();
            harness = mountFeature(kernelReconnectButton, {i18n});
            await tick();
            expect(injected()).toHaveLength(1);

            first.remove();
            await tick();
            showErrorLog();
            await tick();

            expect(injected()).toHaveLength(1);
        });

        it("点击后按钮禁用并显示「正在重连…」，内核没恢复时给出明确提示再复原", async () => {
            answerProbe(1);
            showErrorLog();
            harness = mountFeature(kernelReconnectButton, {i18n});
            await tick();

            const button = injected()[0];
            button.click();
            // 点下去立刻进入「正在重连」，这段时间里不能重复点
            expect(button.disabled).toBe(true);
            expect(button.textContent).toBe("正在重连…");

            await tick();
            expect(button.disabled).toBe(false);
            expect(button.textContent).toBe("立即重连");
            expect(harness.records.messages).toEqual(["内核还没有恢复，请稍后再试"]);
            expect(reload).not.toHaveBeenCalled();
        });

        it("点击后探到内核恢复就重载前端，不弹「还没恢复」", async () => {
            answerProbe(0);
            showErrorLog();
            harness = mountFeature(kernelReconnectButton, {i18n});
            await tick();

            injected()[0].click();
            await tick();

            expect(reload).toHaveBeenCalledTimes(1);
            expect(harness.records.messages).toEqual([]);
        });

        it("探活期间按钮被拆掉（面板关了）就不再改它、也不再提示", async () => {
            hangProbe();
            showErrorLog();
            harness = mountFeature(kernelReconnectButton, {i18n});
            await tick();

            const button = injected()[0];
            button.click();
            button.remove();
            await vi.advanceTimersByTimeAsync(2000);

            expect(harness.records.messages).toEqual([]);
            expect(button.disabled).toBe(true);
            expect(button.textContent).toBe("正在重连…");
        });

        it("卸载时把已经注入的按钮摘掉，并且不再响应新的断连面板", async () => {
            const dialog = showErrorLog();
            harness = mountFeature(kernelReconnectButton, {i18n});
            await tick();
            expect(injected()).toHaveLength(1);

            harness.dispose();
            harness = undefined;
            // 不留一颗点了没反应的按钮
            expect(dialog.querySelector("[data-ss-reconnect]")).toBe(null);

            dialog.remove();
            await tick();
            showErrorLog();
            await tick();
            expect(injected()).toHaveLength(0);
        });
    });
});
