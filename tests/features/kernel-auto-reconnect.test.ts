/**
 * 断连后自动重连（`kernel-auto-reconnect`）的单元测试。
 *
 * 这个功能的全部行为都在「等一会儿 → 探一次 → 再等」这个循环里，所以必须用假定时器：
 * 真等 500ms × N 次既慢又测不准，而且「失败若干次后放弃」「探到就停」这两条关键分支
 * 只有把时间一格一格推进去才看得见。
 *
 * `window.location.reload()` 在 jsdom 里是不可配置的（`vi.spyOn` 会抛
 * "Cannot redefine property"），所以这里换成整个 `location` 对象再还原，
 * 这样才断言得到「重载前端」这一步真的发生了。
 */
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import kernelAutoReconnect from "../../src/features/kernel-auto-reconnect/index";
import {mountFeature} from "../helpers/feature-host";
import type {HostHarness} from "../helpers/feature-host";
import {mockState} from "../mocks/siyuan";

/** jsdom 原本的 location 描述符，用来在测试后还原（它不可 spy，只能整块换掉）。 */
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

/** 内核探活一次应答：`alive` 决定回调给的是 0 还是非 0 code。 */
const answerProbes = (...alive: boolean[]): void => {
    let index = 0;
    (mockState.fetchPost as unknown as {mockImplementation: (fn: unknown) => void;}).mockImplementation(
        async (...args: unknown[]) => {
            const callback = args[2] as (response: unknown) => void;
            const current = alive[Math.min(index, alive.length - 1)];
            index += 1;
            callback({code: current ? 0 : 1});
            return {code: current ? 0 : 1};
        },
    );
};

/** 断连面板就是「内核掉了」唯一稳定可观察的表现。 */
const showErrorLog = (): HTMLElement => {
    const dialog = document.createElement("div");
    dialog.id = "errorLog";
    document.body.append(dialog);
    return dialog;
};

const probes = (): number => mockState.fetchPost.mock.calls.length;

describe("auto-reconnect after a disconnect", () => {
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

    const mount = (config: Record<string, unknown> = {}): HostHarness => {
        harness = mountFeature(kernelAutoReconnect, {config});
        return harness;
    };

    it("nothing happens without a disconnect panel at mount, and no probe runs however long the wait", async () => {
        mount({attempts: 2, interval: 500});

        await vi.advanceTimersByTimeAsync(5000);

        expect(probes()).toBe(0);
        expect(reload).not.toHaveBeenCalled();
    });

    it("already disconnected at mount: the first probe waits a full interval, and a hit reloads the frontend", async () => {
        answerProbes(true);
        showErrorLog();
        const host = mount({attempts: 2, interval: 500});

        // 立刻探会把「间隔」这个设置架空，所以第一次也要先等
        await vi.advanceTimersByTimeAsync(499);
        expect(probes()).toBe(0);

        await vi.advanceTimersByTimeAsync(1);
        expect(probes()).toBe(1);
        expect(mockState.fetchPost.mock.calls[0][0]).toBe("/api/system/currentTime");
        expect(reload).toHaveBeenCalledTimes(1);
        // 日志里带上第几次探到的，出问题能对得上时间线
        expect(host.records.logs.flat().join("\n")).toContain("kernel is back on probe 1");
    });

    it("retrying stops once a probe succeeds", async () => {
        answerProbes(true);
        showErrorLog();
        mount({attempts: 5, interval: 500});

        await vi.advanceTimersByTimeAsync(500);
        await vi.advanceTimersByTimeAsync(10000);

        expect(probes()).toBe(1);
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it("two failures and then a recovery: the log reports probe 3", async () => {
        answerProbes(false, false, true);
        showErrorLog();
        const host = mount({attempts: 3, interval: 500});

        await vi.advanceTimersByTimeAsync(1499);
        expect(probes()).toBe(2);
        expect(reload).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        expect(probes()).toBe(3);
        expect(reload).toHaveBeenCalledTimes(1);
        expect(host.records.logs.flat().join("\n")).toContain("kernel is back on probe 3");
    });

    it("gives up after the configured attempts and hands reconnection back to SiYuan", async () => {
        answerProbes(false);
        showErrorLog();
        const host = mount({attempts: 2, interval: 500});

        await vi.advanceTimersByTimeAsync(1000);

        expect(probes()).toBe(2);
        expect(reload).not.toHaveBeenCalled();
        expect(host.records.logs.flat().join("\n"))
            .toContain("kernel not detected after 2 auto-reconnect attempts");

        // 放弃之后不能还有定时器在偷偷重试
        await vi.advanceTimersByTimeAsync(10000);
        expect(probes()).toBe(2);
    });

    it("0 attempts turns auto-retry off completely", async () => {
        answerProbes(true);
        showErrorLog();
        mount({attempts: 0, interval: 500});

        await vi.advanceTimersByTimeAsync(5000);

        expect(probes()).toBe(0);
        expect(reload).not.toHaveBeenCalled();
    });

    it("an invalid attempt count falls back to the default of 2, and a negative count means 0", async () => {
        answerProbes(false);
        showErrorLog();
        mount({attempts: "abc", interval: 500});
        await vi.advanceTimersByTimeAsync(5000);
        expect(probes()).toBe(2);

        harness?.dispose();
        document.body.innerHTML = "";
        mockState.fetchPost.mockClear();

        showErrorLog();
        mount({attempts: -3, interval: 500});
        await vi.advanceTimersByTimeAsync(5000);
        expect(probes()).toBe(0);
    });

    it("an attempt count above the limit is capped at 20", async () => {
        answerProbes(false);
        showErrorLog();
        const host = mount({attempts: 999, interval: 500});

        await vi.advanceTimersByTimeAsync(500 * 20);

        expect(probes()).toBe(20);
        expect(host.records.logs.flat().join("\n"))
            .toContain("kernel not detected after 20 auto-reconnect attempts");
    });

    it("a too-small interval falls back to 100ms and a too-large one is capped at 10s", async () => {
        answerProbes(true);
        showErrorLog();
        mount({attempts: 1, interval: 1});

        await vi.advanceTimersByTimeAsync(99);
        expect(probes()).toBe(0);
        await vi.advanceTimersByTimeAsync(1);
        expect(probes()).toBe(1);

        harness?.dispose();
        document.body.innerHTML = "";
        mockState.fetchPost.mockClear();
        reload.mockClear();

        showErrorLog();
        mount({attempts: 1, interval: 999999});
        await vi.advanceTimersByTimeAsync(9999);
        expect(probes()).toBe(0);
        await vi.advanceTimersByTimeAsync(1);
        expect(probes()).toBe(1);
    });

    it("a probe that never answers counts as a timeout and the next attempt follows", async () => {
        // 内核挂了就是这样：请求发出去石沉大海
        (mockState.fetchPost as unknown as {mockImplementation: (fn: unknown) => void;}).mockImplementation(
            () => new Promise(() => undefined),
        );
        showErrorLog();
        const host = mount({attempts: 2, interval: 500});

        // 500ms 等间隔 + 2000ms 等超时，然后才是第二次等待
        await vi.advanceTimersByTimeAsync(500 + 2000 + 500 + 2000);
        expect(probes()).toBe(2);
        expect(reload).not.toHaveBeenCalled();
        expect(host.records.logs.flat().join("\n")).toContain("kernel not detected");
    });

    it("a probe that throws synchronously counts as not recovered and does not end the retry round", async () => {
        let calls = 0;
        (mockState.fetchPost as unknown as {mockImplementation: (fn: unknown) => void;}).mockImplementation(
            () => {
                calls += 1;
                throw new Error("sync failure");
            },
        );
        showErrorLog();
        mount({attempts: 2, interval: 500});

        await vi.advanceTimersByTimeAsync(1000);

        expect(calls).toBe(2);
    });

    it("no probe once the kernel recovers on its own during the wait (the panel disappears)", async () => {
        answerProbes(false);
        const dialog = showErrorLog();
        const host = mount({attempts: 5, interval: 500});

        await vi.advanceTimersByTimeAsync(200);
        dialog.remove();
        await vi.advanceTimersByTimeAsync(10000);

        expect(probes()).toBe(0);
        // 面板自己消失说明主 WebSocket 已经回来，不该再写一条「放弃」日志
        expect(host.records.logs.flat().join("\n")).not.toContain("not detected");
    });

    it("a disconnect after mount: retrying starts once the panel is inserted", async () => {
        answerProbes(true);
        const host = mount({attempts: 2, interval: 500});

        await vi.advanceTimersByTimeAsync(5000);
        expect(probes()).toBe(0);

        showErrorLog();
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(500);

        expect(probes()).toBe(1);
        expect(host.records.logs.flat().join("\n")).toContain("kernel is back on probe 1");
    });

    it("other body mutations during a retry do not start another round", async () => {
        answerProbes(false);
        showErrorLog();
        mount({attempts: 2, interval: 500});

        await vi.advanceTimersByTimeAsync(250);
        // body 里任何插入都会再次触发观察器，这时不能另起一轮（否则次数翻倍）
        document.body.append(document.createElement("div"));
        await vi.advanceTimersByTimeAsync(750);

        expect(probes()).toBe(2);
    });

    it("a new disconnect after giving up starts a fresh round", async () => {
        answerProbes(false);
        const first = showErrorLog();
        mount({attempts: 1, interval: 500});

        await vi.advanceTimersByTimeAsync(500);
        expect(probes()).toBe(1);

        first.remove();
        await Promise.resolve();
        showErrorLog();
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(500);

        expect(probes()).toBe(2);
    });

    it("destroying during the wait stops probing and reloading, and disconnects the observer", async () => {
        answerProbes(true);
        const dialog = showErrorLog();
        const host = mount({attempts: 3, interval: 500});

        await vi.advanceTimersByTimeAsync(200);
        host.dispose();
        harness = undefined;

        await vi.advanceTimersByTimeAsync(10000);
        expect(probes()).toBe(0);
        expect(reload).not.toHaveBeenCalled();

        // 卸载后再出现断连面板也不该有任何动作
        dialog.remove();
        await Promise.resolve();
        showErrorLog();
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(5000);
        expect(probes()).toBe(0);
    });

    it("destroying between two attempts stops immediately", async () => {
        answerProbes(false);
        showErrorLog();
        const host = mount({attempts: 5, interval: 500});

        await vi.advanceTimersByTimeAsync(500);
        expect(probes()).toBe(1);

        host.dispose();
        harness = undefined;
        await vi.advanceTimersByTimeAsync(5000);

        expect(probes()).toBe(1);
    });
});
