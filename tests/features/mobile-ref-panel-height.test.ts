/**
 * 移动端增大候选浮层高度（`mobile-ref-panel-height`）的单元测试。
 *
 * 内核把浮层高度写成**内联** `max-height`（视口高 / 3），CSS 追不上，所以这个功能是
 * 「观察到 style 变了就改写内联值」。测试要覆盖三层：
 * 目标高度怎么算（视口百分比 + 下限）、什么时候不写（已有更大值 / 解析不了 / 会超出屏幕）、
 * 以及重扫的三种触发方式（挂载、`loaded-protyle-static`、每 2 秒一次）。
 *
 * jsdom 的 `getBoundingClientRect()` 恒为 0、也没有 `visualViewport`，
 * 所以需要「面板贴在屏幕下半部分」或「软键盘弹起」的用例都自己补桩。
 */
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import mobileRefPanelHeight from "../../src/features/mobile-ref-panel-height/index";
import {mountFeature} from "../helpers/feature-host";
import type {HostHarness} from "../helpers/feature-host";

/** jsdom 默认视口高度；所有期望值都按它算。 */
const VIEWPORT = 768;

const tick = async (rounds = 5): Promise<void> => {
    for (let index = 0; index < rounds; index++) {
        await Promise.resolve();
    }
};

/** 造一个候选浮层；`maxHeight` 模拟内核写进去的内联值。 */
const hint = (maxHeight?: string): HTMLElement => {
    const element = document.createElement("div");
    element.className = "protyle-hint";
    if (maxHeight !== undefined) {
        element.style.maxHeight = maxHeight;
    }
    document.body.append(element);
    return element;
};

/** 让浮层出现在离视口顶部 `top` 的位置（jsdom 里真实布局恒为 0）。 */
const placeAt = (element: HTMLElement, top: number): void => {
    Object.defineProperty(element, "getBoundingClientRect", {
        configurable: true,
        value: () => ({top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({})}),
    });
};

const stubVisualViewport = (value: {offsetTop?: number; height?: number;}): void => {
    Object.defineProperty(window, "visualViewport", {configurable: true, writable: true, value});
};

describe("移动端增大候选浮层高度", () => {
    let harness: HostHarness | undefined;

    beforeEach(() => {
        vi.useFakeTimers();
        expect(window.innerHeight).toBe(VIEWPORT);
    });

    afterEach(() => {
        harness?.dispose();
        harness = undefined;
        vi.useRealTimers();
        // 这个桩是本文件加的，撤掉免得影响别的用例
        delete (window as unknown as {visualViewport?: unknown;}).visualViewport;
    });

    const mount = (config: Record<string, unknown> = {}): HostHarness => {
        harness = mountFeature(mobileRefPanelHeight, {config});
        return harness;
    };

    it("默认按视口 60% 放宽已经存在的浮层", () => {
        const element = hint("256px");
        mount();

        // 768 * 0.6 = 460.8，取整到 461
        expect(element.style.maxHeight).toBe("461px");
    });

    it("浮层还没写内联高度时也照常放宽（内核可能刚建出来）", () => {
        const element = hint();
        mount();

        expect(element.style.maxHeight).toBe("461px");
    });

    it("比例低于下限时按 20% 计算，但不会低于 160px 的可读高度", () => {
        const element = hint();
        mount({maxHeight: 20});

        // 768 * 0.2 = 153.6 → 被 160 的下限托住
        expect(element.style.maxHeight).toBe("160px");
    });

    it("比例取 100% 时也不越过可视区底部（留 8px 空隙）", () => {
        const element = hint();
        mount({maxHeight: 100});

        // 768 - 0(顶) - 8(空隙) = 760
        expect(element.style.maxHeight).toBe("760px");
    });

    it("配置超出范围时夹到 20~100 之间，非数字回落 60", () => {
        const high = hint();
        mount({maxHeight: 200});
        expect(high.style.maxHeight).toBe("760px");

        harness?.dispose();
        document.body.innerHTML = "";

        const low = hint();
        mount({maxHeight: 5});
        expect(low.style.maxHeight).toBe("160px");

        harness?.dispose();
        document.body.innerHTML = "";

        const invalid = hint();
        mount({maxHeight: "abc"});
        expect(invalid.style.maxHeight).toBe("461px");
    });

    it("已经比目标更高的浮层不会被压矮（别把用户拖大的面板改小）", () => {
        const element = hint("800px");
        mount({maxHeight: 60});

        expect(element.style.maxHeight).toBe("800px");
    });

    it("内联值解析不出像素数（比如 max-content）时原样不动", async () => {
        // jsdom 不接受 max-height: auto，这里用同样「不带你数字」的关键字代替
        const element = hint("max-content");
        mount();

        expect(element.style.maxHeight).toBe("max-content");
    });

    it("面板位置靠下时按剩余空间收窄，不会把面板推出屏幕", () => {
        const element = hint("100px");
        placeAt(element, 500);
        mount({maxHeight: 100});

        // 768 - 500 - 8 = 260
        expect(element.style.maxHeight).toBe("260px");
    });

    it("软键盘弹起时按 visualViewport 量可视区底部", () => {
        // 键盘把可视区压到 100~500 这一段，innerHeight 仍然是 768
        stubVisualViewport({offsetTop: 100, height: 400});
        const element = hint("100px");
        mount({maxHeight: 100});

        // 底部 500 - 0 - 8 = 492，小于按整窗算出来的 768
        expect(element.style.maxHeight).toBe("492px");
    });

    it("visualViewport 缺字段时退回 window.innerHeight", () => {
        stubVisualViewport({});
        const element = hint("100px");
        mount({maxHeight: 100});

        expect(element.style.maxHeight).toBe("760px");
    });

    it("内核重新写入内联高度后自动再放宽一次", async () => {
        const element = hint("256px");
        mount();

        // 内核每次算完位置都会重写这个值，写回「视口高 / 3」
        element.style.maxHeight = "256px";
        await tick();

        expect(element.style.maxHeight).toBe("461px");
    });

    it("放宽之后观察器不会自激（写一次就稳定下来）", async () => {
        const element = hint("256px");
        mount();
        const first = element.style.maxHeight;

        for (let round = 0; round < 3; round++) {
            await tick();
        }

        expect(first).toBe("461px");
        expect(element.style.maxHeight).toBe("461px");
    });

    it("只处理候选浮层，别的元素一个都不碰", () => {
        const other = document.createElement("div");
        other.className = "protyle-wysiwyg";
        other.style.maxHeight = "100px";
        document.body.append(other);
        mount();

        expect(other.style.maxHeight).toBe("100px");
    });

    it("同一次扫描处理多个浮层", () => {
        const first = hint("100px");
        const second = hint("300px");
        mount();

        expect(first.style.maxHeight).toBe("461px");
        // 300 已经比 461 小，按目标放宽
        expect(second.style.maxHeight).toBe("461px");
    });

    it("编辑器加载完成（loaded-protyle-static）时补扫新出现的浮层", async () => {
        mount();
        const element = hint("100px");
        await tick();
        // 还没扫到：只靠 2 秒一次的兜底，这里时间没走
        expect(element.style.maxHeight).toBe("100px");

        harness?.emitBus("loaded-protyle-static", {});
        await tick();

        expect(element.style.maxHeight).toBe("461px");
    });

    it("每 2 秒重扫一次，兜住没有事件通知的情况", async () => {
        mount();
        const element = hint("100px");

        await vi.advanceTimersByTimeAsync(1999);
        expect(element.style.maxHeight).toBe("100px");

        await vi.advanceTimersByTimeAsync(1);
        await tick();
        expect(element.style.maxHeight).toBe("461px");
    });

    it("重复扫描时已处理的元素保持稳定，不会来回改写同一份内联值", async () => {
        const element = hint("100px");
        mount();
        await tick();

        // 再走两轮扫描：值没有被反复改写，说明没有叠加多个观察器来回写
        harness?.emitBus("loaded-protyle-static", {});
        await vi.advanceTimersByTimeAsync(2000);
        await tick();

        expect(element.style.maxHeight).toBe("461px");
        expect(harness?.records.bus.filter((item) => item.type === "loaded-protyle-static")).toHaveLength(1);
    });

    it("配置变更后新出现的浮层按新比例放宽", async () => {
        mount({maxHeight: 60});
        harness!.config.maxHeight = 100;
        harness!.notifyConfigChange();
        await tick();

        const element = hint("100px");
        harness!.emitBus("loaded-protyle-static", {});
        await tick();

        // 100% 仍然受「到可视区底部」的限制：768 - 0 - 8 = 760
        expect(element.style.maxHeight).toBe("760px");
    });

    it("卸载后停止定时重扫，也不再观察内联值变化", async () => {
        const element = hint("100px");
        mount();
        await tick();
        expect(element.style.maxHeight).toBe("461px");

        harness?.dispose();
        harness = undefined;

        const later = hint("100px");
        await vi.advanceTimersByTimeAsync(10000);
        await tick();
        // 定时器已经清掉，新浮层不会被处理
        expect(later.style.maxHeight).toBe("100px");

        // 观察器已经断开，改内联值也不会被放宽
        element.style.maxHeight = "100px";
        await tick();
        expect(element.style.maxHeight).toBe("100px");
    });
});
