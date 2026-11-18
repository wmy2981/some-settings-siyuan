/**
 * 文档树已打开笔记强调色。
 *
 * 色值与宽度都是直接拼进样式表的，所以断言的重点有两个：
 * 1. **色值白名单**。非法输入必须回落到主题主色，而不是把任意字符串（可能带 `;` 或 `{}`）
 *    拼进 CSS —— 那等于让用户输入能改到别的规则上。
 * 2. **用 `box-shadow: inset` 而不是 `border-left`**：前者不参与布局，加不加都不会让树里的
 *    文字横向位移，也不会在圆角处留下缺口。
 */
import {
    afterEach,
    describe,
    expect,
    it,
} from "vitest";
import type {FeatureHost} from "../../src/core/types";
import definition from "../../src/features/doc-tree-opened-accent";
import {mountDocTreeOpenedAccent} from "../../src/features/doc-tree-opened-accent/style";
import {
    configKeysOf,
    mountFeature,
} from "../helpers/feature-host";

const FALLBACK = "var(--b3-theme-primary)";

/** 该功能注入的 `<style>` 是否唯一：重复挂载、配置变更都不该堆叠第二张。 */
const styleCount = (): number =>
    document.head.querySelectorAll('style[data-some-settings-style="doc-tree-opened-accent"]').length;

/** 去掉注释再检查「有没有某条声明」，避免命中注释里的同名文字。 */
const rulesOf = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("accent color for the opened note in the document tree", () => {
    const mounted: {dispose: () => void;}[] = [];

    const mount = (config?: Record<string, unknown>) => {
        const harness = mountFeature(definition, config ? {config} : {});
        mounted.push(harness);
        return harness;
    };

    afterEach(() => {
        mounted.splice(0).forEach((harness) => harness.dispose());
    });

    it("declaration: the category is the document tree, the switch defaults to off, the color follows SiYuan and the width defaults to 3px within 1-10", () => {
        expect(definition.category).toBe("doc-tree");
        expect(definition.frontends).toBeUndefined();
        expect(configKeysOf(definition.settings)).toEqual(["enabled", "color", "width"]);
        expect(definition.settings[0]).toMatchObject({kind: "switch", key: "enabled", default: false});
        expect(definition.settings[1]).toMatchObject({kind: "text", key: "color", default: ""});
        expect(definition.settings[2]).toMatchObject({
            kind: "number",
            key: "width",
            default: 3,
            min: 1,
            max: 10,
        });
    });

    it("default config: both the desktop and mobile selectors match, the color follows the theme primary and the width is 3px", () => {
        const harness = mount();
        const css = harness.css();

        // 桌面端在 .sy__file 面板，移动端在侧栏的 [data-type="sidebar-file"] 里，两处都要覆盖
        expect(css).toContain(".sy__file .b3-list--background .b3-list-item--focus");
        expect(css).toContain('#sidebar .b3-list--mobile [data-type="sidebar-file"] .b3-list-item--focus');
        expect(css).toContain(`box-shadow: inset 3px 0 0 0 ${FALLBACK};`);
        // 不参与布局：用 box-shadow 而不是 border-left，否则树里的文字会横向位移
        expect(rulesOf(css)).not.toContain("border-left");
        expect(styleCount()).toBe(1);
    });

    it("valid colors go into the stylesheet as is: hex, color functions, named colors and CSS variables are all supported", () => {
        [
            "#fff",
            "#ff0000",
            "#12345678",
            "red",
            "oklch(0.7 0.1 200)",
            "var(--b3-theme-primary)",
            "rgb(1, 2, 3)",
            "rgba(0, 0, 0, .5)",
            "hsl(120, 50%, 50%)",
            "color-mix(in srgb, red 50%, blue)",
        ].forEach((color) => {
            const css = rulesOf(mount({color}).css());
            // 取声明里的色值本身来比：`var(--b3-theme-primary)` 恰好就是回落值，
            // 单看「包含回落值」区分不出「原样写进去了」和「被替换成回落值」
            const declaration = /box-shadow: inset 3px 0 0 0 ([^;]+);/.exec(css)?.[1];
            expect(declaration).toBe(color);
        });
    });

    it("surrounding whitespace is trimmed before the whitelist check", () => {
        expect(mount({color: "  #08f  "}).css()).toContain("box-shadow: inset 3px 0 0 0 #08f;");
        // 只有空白等同于空串，走「跟随思源」那条路
        expect(mount({color: "   "}).css()).toContain(`box-shadow: inset 3px 0 0 0 ${FALLBACK};`);
    });

    it("an invalid color always falls back to the theme primary and user input never rewrites other rules", () => {
        [
            "red; background: url(x)",
            "url(x)",
            "javascript:alert(1)",
            "#ggg",
            "a{b}",
            'var(--x)"',
            "rgb(1,2,3);}",
            "expression(alert(1))",
        ].forEach((color) => {
            const css = mount({color}).css();
            expect(css).toContain(`box-shadow: inset 3px 0 0 0 ${FALLBACK};`);
            // 注入的文本里不能出现用户那段原样内容
            expect(css).not.toContain(color);
        });
    });

    it("the width is rounded and clamped to 1-10, non-numbers fall back to 3", () => {
        [
            [0, 1],
            [-5, 1],
            [1.4, 1],
            [2.6, 3],
            [9.5, 10],
            [20, 10],
            [5, 5],
        ].forEach(([input, expected]) => {
            expect(mount({width: input}).css()).toContain(`box-shadow: inset ${expected}px 0 0 0 ${FALLBACK};`);
        });
        [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "abc", undefined].forEach((width) => {
            expect(mount({width}).css()).toContain(`box-shadow: inset 3px 0 0 0 ${FALLBACK};`);
        });
    });

    it("a config change reinjects the same stylesheet without stacking a second one", () => {
        const harness = mount();
        expect(styleCount()).toBe(1);

        harness.config.color = "#e91e63";
        harness.config.width = 6;
        harness.notifyConfigChange();

        expect(styleCount()).toBe(1);
        expect(harness.records.styles).toHaveLength(2);
        const css = harness.styleElement()?.textContent ?? "";
        expect(css).toBe(harness.records.styles.at(-1));
        expect(css).toContain("box-shadow: inset 6px 0 0 0 #e91e63;");
        expect(css).not.toContain(FALLBACK);
    });

    it("mount applies once and subscribes later changes to onConfigChange", () => {
        const styles: string[] = [];
        const listeners: (() => void)[] = [];
        const host = {
            config: {color: "#0f0", width: 2},
            addStyle: (css: string) => {
                styles.push(css);
            },
            onConfigChange: (listener: () => void) => {
                listeners.push(listener);
            },
        } as unknown as FeatureHost;

        expect(mountDocTreeOpenedAccent(host)).toEqual({});
        expect(styles).toHaveLength(1);
        expect(styles[0]).toContain("box-shadow: inset 2px 0 0 0 #0f0;");
        expect(listeners).toHaveLength(1);
    });

    it("dispose removes the <style> from <head> along with the config subscription", () => {
        const harness = mount();
        const injected = harness.records.styles.length;

        harness.dispose();

        expect(styleCount()).toBe(0);
        expect(harness.styleElement()).toBeNull();
        expect(harness.records.configListeners).toHaveLength(0);
        harness.notifyConfigChange();
        expect(harness.records.styles).toHaveLength(injected);
    });
});
