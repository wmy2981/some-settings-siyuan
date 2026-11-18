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
    "feature.kernelReconnectButton.label": "Reconnect now",
    "feature.kernelReconnectButton.working": "Reconnecting…",
    "feature.kernelReconnectButton.offline": "The kernel is not back yet, please try again later",
};

const i18n = (key: string): string => I18N[key] ?? key;

/** 造一个断连面板；`action: false` 模拟桌面浏览器那种没有动作区的版本。 */
const showErrorLog = (options: {action?: boolean; body?: boolean;} = {}): HTMLElement => {
    const dialog = document.createElement("div");
    dialog.id = "errorLog";
    const action = options.action === false ?
        "" :
        '<div class="b3-dialog__action"><button class="b3-button">Exit safely</button></div>';
    const content = '<p class="b3-dialog__content">Kernel connection lost</p>';
    dialog.innerHTML = options.body === false ?
        '<div class="b3-dialog__container"></div>' :
        `<div class="b3-dialog__container"><div class="b3-dialog__body">${content}${action}</div></div>`;
    document.body.append(dialog);
    return dialog;
};

const injected = (): HTMLButtonElement[] =>
    Array.from(document.querySelectorAll<HTMLButtonElement>("[data-ss-reconnect]"));

describe("Reconnect now button in the offline dialog", () => {
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
        it("Only a code 0 answer counts as recovered", async () => {
            answerProbe(0);
            await expect(probeKernel()).resolves.toBe(true);
            expect(mockState.fetchPost.mock.calls[0].slice(0, 2)).toEqual(["/api/system/currentTime", {}]);
        });

        it("A non-zero code or an empty response counts as not recovered", async () => {
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

        it("Falls back to a 2000ms timeout when the request never answers", async () => {
            hangProbe();
            let settled: boolean | undefined;
            void probeKernel().then((value) => settled = value);

            await vi.advanceTimersByTimeAsync(1999);
            expect(settled).toBeUndefined();

            await vi.advanceTimersByTimeAsync(1);
            expect(settled).toBe(false);
        });

        it("Treats a synchronous throw as not recovered and never rethrows", async () => {
            (mockState.fetchPost as unknown as {mockImplementation: (fn: unknown) => void;}).mockImplementation(
                () => {
                    throw new Error("boom");
                },
            );
            await expect(probeKernel()).resolves.toBe(false);
        });
    });

    describe("reconnectNow", () => {
        it("Reloads the frontend once the kernel answers, the only clean rebuild", async () => {
            answerProbe(0);
            const host = {log: {scope: "test", info: vi.fn(), warn: vi.fn(), error: vi.fn()}} as unknown as Parameters<
                typeof reconnectNow
            >[0];

            await expect(reconnectNow(host)).resolves.toBe(true);
            expect(reload).toHaveBeenCalledTimes(1);
            expect(host.log.info).toHaveBeenCalledWith(expect.stringContaining("reloading the frontend"));
        });

        it("Returns false without reloading while the kernel is still away", async () => {
            answerProbe(1);
            const host = {log: {scope: "test", info: vi.fn(), warn: vi.fn(), error: vi.fn()}} as unknown as Parameters<
                typeof reconnectNow
            >[0];

            await expect(reconnectNow(host)).resolves.toBe(false);
            expect(reload).not.toHaveBeenCalled();
            expect(host.log.info).not.toHaveBeenCalled();
        });
    });

    describe("Mounting", () => {
        it("Injects nothing without the dialog and adds the button once it appears", async () => {
            harness = mountFeature(kernelReconnectButton, {i18n});
            expect(injected()).toHaveLength(0);

            const dialog = showErrorLog();
            await tick();

            const button = injected()[0];
            expect(button).toBeDefined();
            expect(dialog.querySelector("[data-ss-reconnect]")).toBe(button);
        });

        it("Injects the button into the native action row, keeping the exit button", async () => {
            showErrorLog();
            harness = mountFeature(kernelReconnectButton, {i18n});
            await tick();

            const action = document.querySelector("#errorLog .b3-dialog__action")!;
            const button = injected()[0];
            expect(button.textContent).toBe("Reconnect now");
            expect(button.getAttribute("type")).toBe("button");
            expect(button.className).toBe("b3-button b3-button--outline");
            // prepend：我们的按钮在「安全退出」前面，原生按钮一个都不动
            expect(action.firstElementChild).toBe(button);
            expect(action.querySelectorAll("button")).toHaveLength(2);
            expect(action.lastElementChild?.textContent).toBe("Exit safely");
        });

        it("Adds its own action row after the body when the dialog has none", async () => {
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

        it("Injects nothing when the dialog has neither an action nor a body area", async () => {
            showErrorLog({action: false, body: false});
            harness = mountFeature(kernelReconnectButton, {i18n});
            await tick();

            expect(injected()).toHaveLength(0);
        });

        it("Injects a single button however often the same dialog is scanned", async () => {
            showErrorLog();
            harness = mountFeature(kernelReconnectButton, {i18n});
            await tick();
            document.body.append(document.createElement("div"));
            await tick();
            document.body.append(document.createElement("div"));
            await tick();

            expect(injected()).toHaveLength(1);
        });

        it("Injects into the new dialog when the kernel recreates it", async () => {
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

        it("Disables the button while reconnecting, then restores it with a notice", async () => {
            answerProbe(1);
            showErrorLog();
            harness = mountFeature(kernelReconnectButton, {i18n});
            await tick();

            const button = injected()[0];
            button.click();
            // 点下去立刻进入「正在重连」，这段时间里不能重复点
            expect(button.disabled).toBe(true);
            expect(button.textContent).toBe("Reconnecting…");

            await tick();
            expect(button.disabled).toBe(false);
            expect(button.textContent).toBe("Reconnect now");
            expect(harness.records.messages).toEqual(["The kernel is not back yet, please try again later"]);
            expect(reload).not.toHaveBeenCalled();
        });

        it("Reloads the frontend on success and shows no not-recovered notice", async () => {
            answerProbe(0);
            showErrorLog();
            harness = mountFeature(kernelReconnectButton, {i18n});
            await tick();

            injected()[0].click();
            await tick();

            expect(reload).toHaveBeenCalledTimes(1);
            expect(harness.records.messages).toEqual([]);
        });

        it("Touches nothing and shows no notice when the button is removed mid-probe", async () => {
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
            expect(button.textContent).toBe("Reconnecting…");
        });

        it("Removes the injected button on unmount and ignores new dialogs", async () => {
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
