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
    it("给动画容器挂上预热类", () => {
        const target = dialog();
        preheatDialogLayer(target);
        expect(target.element.querySelector(".b3-dialog__container")?.classList.contains(LAYER_CLASS)).toBe(true);
    });

    it("注入只含 will-change 的样式，不动宿主的过渡", () => {
        preheatDialogLayer(dialog());
        const css = cssElement()?.textContent ?? "";
        expect(css).toContain("will-change: transform");
        expect(css).not.toContain("transition");
        expect(css).not.toContain("opacity");
    });

    it("预热范围是动画容器、内容区与桌面端真正滚动的页签内容", () => {
        preheatDialogLayer(dialog());
        const css = cssElement()?.textContent ?? "";
        expect(css).toContain(`.${LAYER_CLASS}.b3-dialog__container`);
        expect(css).toContain(`.${LAYER_CLASS} .b3-dialog__content`);
        // 移动端的页签内容不是滚动区，不建层
        expect(css).toContain(`.${PANEL_CLASS}:not(.${PANEL_CLASS}--mobile)`);
        expect(css).toContain(`.${PANEL_CLASS}__view:not(.fn__none)`);
    });

    it("重复调用只有一份样式表，且幂等", () => {
        const target = dialog();
        preheatDialogLayer(target);
        preheatDialogLayer(target);
        expect(document.querySelectorAll(`#${LAYER_CSS_ID}`)).toHaveLength(1);
        expect(target.element.querySelectorAll(`.${LAYER_CLASS}`)).toHaveLength(1);
    });

    it("样式内容被改过时重写成当前这份，不会配上旧样式表", () => {
        preheatDialogLayer(dialog());
        const element = cssElement();
        element!.textContent = "/* 旧版本的样式 */";
        preheatDialogLayer(dialog());
        expect(cssElement()?.textContent).toContain("will-change: transform");
        expect(document.querySelectorAll(`#${LAYER_CSS_ID}`)).toHaveLength(1);
    });

    it("对话框里没有动画容器时不抛错，样式照常注入", () => {
        const wrapper = document.createElement("div");
        wrapper.innerHTML = '<div class="b3-dialog"></div>';
        const broken = {element: wrapper.firstElementChild as HTMLElement} as unknown as Parameters<
            typeof preheatDialogLayer
        >[0];
        expect(() => preheatDialogLayer(broken)).not.toThrow();
        expect(cssElement()).not.toBeNull();
    });
});
