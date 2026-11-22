/**
 * 移动端抽屉高度按内容自适应（`mobile-sheet-auto-height`）的单元测试。
 *
 * 宿主把高度写成**内联** `height` / `max-height`（半屏或整屏），所以这个功能是
 * 「看到内联值变了就改回 auto + 56% 封顶」。测试要覆盖四层：
 * 目标值怎么算（完整视口高、可用高度、安全区）、两条必须放手的边界（拖到全屏、抽屉正在关闭）、
 * 面板的发现方式（挂载时扫描、插入时发现、每 2 秒兜底），以及卸载后的干净退出。
 *
 * jsdom 的 `getBoundingClientRect()` 恒为 0、也没有 `window.siyuan`，
 * 所以需要真实几何的用例都自己补桩。
 */
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import mobileSheetAutoHeight from "../../src/features/mobile-sheet-auto-height/index";
import {mountFeature} from "../helpers/feature-host";
import type {HostHarness} from "../helpers/feature-host";

/** jsdom 默认视口高度；所有期望值都按它算。 */
const VIEWPORT = 768;

const tick = async (rounds = 5): Promise<void> => {
    for (let index = 0; index < rounds; index++) {
        await Promise.resolve();
    }
};

const rect = (height: number): DOMRect =>
    ({
        top: 0,
        bottom: height,
        left: 0,
        right: 0,
        width: 0,
        height,
        x: 0,
        y: 0,
        toJSON: () => ({}),
    }) as DOMRect;

interface SheetFixture {
    /** 宿主的对话框外层，`data-dialog-closing` 挂在这里。 */
    dialog: HTMLElement;
    /** 面板外层，宿主在它身上写 top / bottom / 高度。 */
    overlay: HTMLElement;
    /** 抽屉本体。 */
    sheet: HTMLElement;
}

/**
 * 造一个宿主刚摆好的抽屉：高度与上限都是宿主算出来的半屏。
 * `height` 是面板外层的实际高度（可用高度减去内边距），`padding` 模拟安全区。
 */
const sheet = (options: {height?: number; padding?: number; hostHeight?: number;} = {}): SheetFixture => {
    const height = options.height ?? VIEWPORT;
    const hostHeight = options.hostHeight ?? VIEWPORT / 2;
    const dialog = document.createElement("div");
    const overlay = document.createElement("div");
    overlay.className = "b3-dialog mobile-sheet-layout";
    const padding = options.padding ?? 0;
    overlay.style.paddingTop = `${padding}px`;
    overlay.style.paddingBottom = `${padding}px`;
    Object.defineProperty(overlay, "getBoundingClientRect", {configurable: true, value: () => rect(height)});
    const body = document.createElement("div");
    body.className = "b3-dialog__container mobile-sheet-panel";
    body.style.height = `${hostHeight}px`;
    body.style.maxHeight = `${hostHeight}px`;
    overlay.append(body);
    dialog.append(overlay);
    document.body.append(dialog);
    return {dialog, overlay, sheet: body};
};

const stubMobileSize = (
    size: {isLandscape?: boolean; landscape?: {height1: number;}; portrait?: {height1: number;};},
): void => {
    Object.defineProperty(window, "siyuan", {configurable: true, writable: true, value: {mobile: {size}}});
};

describe("Drawers fit their content on mobile", () => {
    let harness: HostHarness | undefined;

    beforeEach(() => {
        vi.useFakeTimers();
        expect(window.innerHeight).toBe(VIEWPORT);
    });

    afterEach(() => {
        harness?.dispose();
        harness = undefined;
        document.body.innerHTML = "";
        vi.useRealTimers();
        delete (window as unknown as {siyuan?: unknown;}).siyuan;
    });

    const mount = (): HostHarness => {
        harness = mountFeature(mobileSheetAutoHeight);
        return harness;
    };

    it("Fits an already open drawer to its content with a 56% cap", () => {
        const {sheet: panel} = sheet();
        mount();

        // 768 * 0.56 = 430.08，取整到 430
        expect(panel.style.height).toBe("auto");
        expect(panel.style.maxHeight).toBe("430px");
    });

    it("Fits a drawer that is opened after mounting", async () => {
        mount();
        const {sheet: panel} = sheet();
        await tick();

        expect(panel.style.height).toBe("auto");
        expect(panel.style.maxHeight).toBe("430px");
    });

    it("Caps at the available height when the drawer sits in a short viewport", () => {
        const {sheet: panel} = sheet({height: 300});
        mount();

        expect(panel.style.height).toBe("auto");
        expect(panel.style.maxHeight).toBe("300px");
    });

    it("Leaves the safe area out of the available height", () => {
        const {sheet: panel} = sheet({height: 400, padding: 50});
        mount();

        // 400 - 100 = 300，比 56% 的 430 更小
        expect(panel.style.maxHeight).toBe("300px");
    });

    it("Uses the recorded orientation height so a raised keyboard does not shrink the cap", () => {
        stubMobileSize({portrait: {height1: 1000}});
        const {sheet: panel} = sheet({height: 700});
        mount();

        // 完整视口高按 1000 算：min(700, 560) = 560，而不是 768 * 0.56 = 430
        expect(panel.style.maxHeight).toBe("560px");
    });

    it("Keeps the height the user dragged to full screen", () => {
        const {sheet: panel} = sheet({hostHeight: VIEWPORT});
        mount();

        expect(panel.style.height).toBe("768px");
        expect(panel.style.maxHeight).toBe("768px");
    });

    it("Keeps the frozen height while the drawer is closing", () => {
        const {dialog, sheet: panel} = sheet();
        dialog.dataset.dialogClosing = "true";
        mount();

        expect(panel.style.height).toBe("384px");
        expect(panel.style.maxHeight).toBe("384px");
    });

    it("Fits again after the host rewrites the inline height", async () => {
        const {sheet: panel} = sheet();
        mount();

        // 宿主每次重算都写回半屏
        panel.style.height = "384px";
        panel.style.maxHeight = "384px";
        await tick();

        expect(panel.style.height).toBe("auto");
        expect(panel.style.maxHeight).toBe("430px");
    });

    it("Does not rewrite anything while the drag animation only moves the panel", async () => {
        const {sheet: panel} = sheet();
        mount();
        const first = panel.style.maxHeight;

        for (let round = 0; round < 3; round++) {
            panel.style.transform = `translateY(${round}px)`;
            await tick();
        }

        expect(panel.style.height).toBe("auto");
        expect(panel.style.maxHeight).toBe(first);
    });

    it("Fits several drawers at once", () => {
        const first = sheet();
        const second = sheet();
        mount();

        [first, second].forEach(({sheet: panel}) => {
            expect(panel.style.height).toBe("auto");
            expect(panel.style.maxHeight).toBe("430px");
        });
    });

    it("Touches no panel that the host did not bind as a drawer", () => {
        const overlay = document.createElement("div");
        overlay.className = "b3-dialog";
        const container = document.createElement("div");
        container.className = "b3-dialog__container";
        container.style.height = "300px";
        overlay.append(container);
        document.body.append(overlay);
        mount();

        expect(container.style.height).toBe("300px");
        expect(container.style.maxHeight).toBe("");
    });

    it("Finds a drawer whose panel class is added long after mounting", async () => {
        mount();
        const dialog = document.createElement("div");
        const overlay = document.createElement("div");
        overlay.className = "b3-dialog mobile-sheet-layout";
        Object.defineProperty(overlay, "getBoundingClientRect", {configurable: true, value: () => rect(VIEWPORT)});
        const panel = document.createElement("div");
        panel.className = "b3-dialog__container";
        panel.style.height = "384px";
        panel.style.maxHeight = "384px";
        overlay.append(panel);
        dialog.append(overlay);
        document.body.append(dialog);
        await tick();

        expect(panel.style.height).toBe("384px");

        // 宿主稍后才把面板绑成抽屉
        panel.classList.add("mobile-sheet-panel");
        await vi.advanceTimersByTimeAsync(2000);
        await tick();

        expect(panel.style.height).toBe("auto");
        expect(panel.style.maxHeight).toBe("430px");
    });

    it("Stops fitting drawers after unmount", async () => {
        const {sheet: panel} = sheet();
        mount();
        await tick();
        expect(panel.style.height).toBe("auto");

        harness?.dispose();
        harness = undefined;

        const later = sheet();
        await vi.advanceTimersByTimeAsync(10000);
        await tick();

        // 观察器与定时器都已拆掉：新抽屉保持宿主的高度，旧抽屉被改写也不再管
        expect(later.sheet.style.height).toBe("384px");
        panel.style.height = "384px";
        panel.style.maxHeight = "384px";
        await tick();
        expect(panel.style.height).toBe("384px");
    });
});
