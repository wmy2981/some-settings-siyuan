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

describe("断连后自动重连", () => {
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

    it("挂载时没有断连面板就什么都不做，面板自己等多久都不探", async () => {
        mount({attempts: 2, interval: 500});

        await vi.advanceTimersByTimeAsync(5000);

        expect(probes()).toBe(0);
        expect(reload).not.toHaveBeenCalled();
    });

    it("挂载时已经断连：等满一个间隔才探第一次，探到就重载前端", async () => {
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

    it("探到之后不再继续重试", async () => {
        answerProbes(true);
        showErrorLog();
        mount({attempts: 5, interval: 500});

        await vi.advanceTimersByTimeAsync(500);
        await vi.advanceTimersByTimeAsync(10000);

        expect(probes()).toBe(1);
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it("前两次没恢复、第三次恢复：日志里是 probe 3", async () => {
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

    it("一直探不到就按次数放弃，并交回思源自己的重连", async () => {
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

    it("次数设为 0 表示完全关闭自动重试", async () => {
        answerProbes(true);
        showErrorLog();
        mount({attempts: 0, interval: 500});

        await vi.advanceTimersByTimeAsync(5000);

        expect(probes()).toBe(0);
        expect(reload).not.toHaveBeenCalled();
    });

    it("次数非法时回落到默认的 2 次，负数按 0 次处理", async () => {
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

    it("次数超过上限时按 20 次封顶", async () => {
        answerProbes(false);
        showErrorLog();
        const host = mount({attempts: 999, interval: 500});

        await vi.advanceTimersByTimeAsync(500 * 20);

        expect(probes()).toBe(20);
        expect(host.records.logs.flat().join("\n"))
            .toContain("kernel not detected after 20 auto-reconnect attempts");
    });

    it("间隔过小时按 100ms 兜底，过大时按 10s 封顶", async () => {
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

    it("探活请求没有回应时按超时算失败，继续下一次", async () => {
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

    it("探活请求同步抛错时按「没恢复」处理，不会中断整轮重试", async () => {
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

    it("等待期间内核自己恢复了（面板消失）就不再探", async () => {
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

    it("断开发生在挂载之后：面板被插入时才开始重试", async () => {
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

    it("重试进行中不会因为 body 的其它变动再起一轮", async () => {
        answerProbes(false);
        showErrorLog();
        mount({attempts: 2, interval: 500});

        await vi.advanceTimersByTimeAsync(250);
        // body 里任何插入都会再次触发观察器，这时不能另起一轮（否则次数翻倍）
        document.body.append(document.createElement("div"));
        await vi.advanceTimersByTimeAsync(750);

        expect(probes()).toBe(2);
    });

    it("放弃之后再次断连会重新开始一轮", async () => {
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

    it("销毁时停在等待里，不再探也不再重载；观察器一并断开", async () => {
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

    it("在两次尝试之间销毁时立即收手", async () => {
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
