/**
 * `core/layer.ts`：弹窗入场前的图层预热。
 *
 * 两条坑：样式内容必须每次重写（不然重载插件后配的是旧样式表），
 * 预热只加 `will-change`，不许动宿主的过渡与时序。
 */
import {
    describe,
    expect,
    it,
} from "vitest";
import {
    LAYER_CLASS,
    preheatDialogLayer,
} from "../../src/core/layer";
import {PANEL_CLASS} from "../../src/core/ui";
import {Dialog as MockDialog} from "../mocks/siyuan";

/** 预热函数只碰 `dialog.element`，其余成员由宿主提供，测试里用最小替身。 */
const dialog = (): Parameters<typeof preheatDialogLayer>[0] =>
    new MockDialog() as unknown as Parameters<
        typeof preheatDialogLayer
    >[0];

const LAYER_CSS_ID = `${LAYER_CLASS}-local-css`;
const cssElement = (): HTMLStyleElement | null => document.getElementById(LAYER_CSS_ID) as HTMLStyleElement | null;

describe("preheatDialogLayer", () => {
    it("adds the preheat class to the animation container", () => {
        const target = dialog();
        preheatDialogLayer(target);
        expect(target.element.querySelector(".b3-dialog__container")?.classList.contains(LAYER_CLASS)).toBe(true);
    });

    it("injects styles with only will-change and leaves the host transitions alone", () => {
        preheatDialogLayer(dialog());
        const css = cssElement()?.textContent ?? "";
        expect(css).toContain("will-change: transform");
        expect(css).not.toContain("transition");
        expect(css).not.toContain("opacity");
    });

    it("the preheat scope is the animation container, the content area and the scrollable tab content on desktop", () => {
        preheatDialogLayer(dialog());
        const css = cssElement()?.textContent ?? "";
        expect(css).toContain(`.${LAYER_CLASS}.b3-dialog__container`);
        expect(css).toContain(`.${LAYER_CLASS} .b3-dialog__content`);
        // 移动端的页签内容不是滚动区，不建层
        expect(css).toContain(`.${PANEL_CLASS}:not(.${PANEL_CLASS}--mobile)`);
        expect(css).toContain(`.${PANEL_CLASS}__view:not(.fn__none)`);
    });

    it("repeated calls keep a single stylesheet and stay idempotent", () => {
        const target = dialog();
        preheatDialogLayer(target);
        preheatDialogLayer(target);
        expect(document.querySelectorAll(`#${LAYER_CSS_ID}`)).toHaveLength(1);
        expect(target.element.querySelectorAll(`.${LAYER_CLASS}`)).toHaveLength(1);
    });

    it("tampered style content is rewritten to the current one instead of keeping the old stylesheet", () => {
        preheatDialogLayer(dialog());
        const element = cssElement();
        element!.textContent = "/* old stylesheet */";
        preheatDialogLayer(dialog());
        expect(cssElement()?.textContent).toContain("will-change: transform");
        expect(document.querySelectorAll(`#${LAYER_CSS_ID}`)).toHaveLength(1);
    });

    it("a dialog without an animation container does not throw and the styles are still injected", () => {
        const wrapper = document.createElement("div");
        wrapper.innerHTML = '<div class="b3-dialog"></div>';
        const broken = {element: wrapper.firstElementChild as HTMLElement} as unknown as Parameters<
            typeof preheatDialogLayer
        >[0];
        expect(() => preheatDialogLayer(broken)).not.toThrow();
        expect(cssElement()).not.toBeNull();
    });
});
