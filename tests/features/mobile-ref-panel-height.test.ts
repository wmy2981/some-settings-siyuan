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

describe("Enlarged candidate popup height on mobile", () => {
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

    it("Widens an existing popup to 60% of the viewport by default", () => {
        const element = hint("256px");
        mount();

        // 768 * 0.6 = 460.8，取整到 461
        expect(element.style.maxHeight).toBe("461px");
    });

    it("Widens a popup that has no inline height yet, as the kernel just built it", () => {
        const element = hint();
        mount();

        expect(element.style.maxHeight).toBe("461px");
    });

    it("Clamps a low ratio to 20%, never below the readable 160px", () => {
        const element = hint();
        mount({maxHeight: 20});

        // 768 * 0.2 = 153.6 → 被 160 的下限托住
        expect(element.style.maxHeight).toBe("160px");
    });

    it("Stops at the viewport bottom with an 8px gap even at 100%", () => {
        const element = hint();
        mount({maxHeight: 100});

        // 768 - 0(顶) - 8(空隙) = 760
        expect(element.style.maxHeight).toBe("760px");
    });

    it("Clamps an out-of-range setting to 20-100 and a non-number to 60", () => {
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

    it("Never shrinks a popup that is already taller than the target", () => {
        const element = hint("800px");
        mount({maxHeight: 60});

        expect(element.style.maxHeight).toBe("800px");
    });

    it("Leaves a non-pixel inline value such as max-content untouched", async () => {
        // jsdom 不接受 max-height: auto，这里用同样「不带你数字」的关键字代替
        const element = hint("max-content");
        mount();

        expect(element.style.maxHeight).toBe("max-content");
    });

    it("Narrows to the remaining space so a low popup stays on screen", () => {
        const element = hint("100px");
        placeAt(element, 500);
        mount({maxHeight: 100});

        // 768 - 500 - 8 = 260
        expect(element.style.maxHeight).toBe("260px");
    });

    it("Measures the visible bottom through visualViewport when the keyboard opens", () => {
        // 键盘把可视区压到 100~500 这一段，innerHeight 仍然是 768
        stubVisualViewport({offsetTop: 100, height: 400});
        const element = hint("100px");
        mount({maxHeight: 100});

        // 底部 500 - 0 - 8 = 492，小于按整窗算出来的 768
        expect(element.style.maxHeight).toBe("492px");
    });

    it("Falls back to window.innerHeight when visualViewport lacks fields", () => {
        stubVisualViewport({});
        const element = hint("100px");
        mount({maxHeight: 100});

        expect(element.style.maxHeight).toBe("760px");
    });

    it("Widens again after the kernel rewrites the inline height", async () => {
        const element = hint("256px");
        mount();

        // 内核每次算完位置都会重写这个值，写回「视口高 / 3」
        element.style.maxHeight = "256px";
        await tick();

        expect(element.style.maxHeight).toBe("461px");
    });

    it("Does not self-trigger the observer, one write settles it", async () => {
        const element = hint("256px");
        mount();
        const first = element.style.maxHeight;

        for (let round = 0; round < 3; round++) {
            await tick();
        }

        expect(first).toBe("461px");
        expect(element.style.maxHeight).toBe("461px");
    });

    it("Touches only the candidate popup and no other element", () => {
        const other = document.createElement("div");
        other.className = "protyle-wysiwyg";
        other.style.maxHeight = "100px";
        document.body.append(other);
        mount();

        expect(other.style.maxHeight).toBe("100px");
    });

    it("Handles several popups in the same scan", () => {
        const first = hint("100px");
        const second = hint("300px");
        mount();

        expect(first.style.maxHeight).toBe("461px");
        // 300 已经比 461 小，按目标放宽
        expect(second.style.maxHeight).toBe("461px");
    });

    it("Scans newly appeared popups on loaded-protyle-static", async () => {
        mount();
        const element = hint("100px");
        await tick();
        // 还没扫到：只靠 2 秒一次的兜底，这里时间没走
        expect(element.style.maxHeight).toBe("100px");

        harness?.emitBus("loaded-protyle-static", {});
        await tick();

        expect(element.style.maxHeight).toBe("461px");
    });

    it("Rescans every 2 seconds to cover missing event notifications", async () => {
        mount();
        const element = hint("100px");

        await vi.advanceTimersByTimeAsync(1999);
        expect(element.style.maxHeight).toBe("100px");

        await vi.advanceTimersByTimeAsync(1);
        await tick();
        expect(element.style.maxHeight).toBe("461px");
    });

    it("Keeps a handled element stable on rescans without rewriting its value", async () => {
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

    it("Widens new popups by the new ratio after a config change", async () => {
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

    it("Stops the rescan timer and the inline value observer after unmount", async () => {
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
