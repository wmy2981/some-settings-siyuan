/**
 * 隐藏选中文字工具条。
 *
 * 纯 CSS 功能：不读配置、不订阅配置变化、不动 DOM。断言围绕三件事：
 * 1. 只压 `.protyle-toolbar` 一个类，字体 / 字号二级面板与思维导图工具栏不能被误伤；
 * 2. 开关只决定挂不挂载（由核心负责），功能自身不订阅配置变化；
 * 3. 卸载后样式收干净，挂载 / 卸载各留一条 INFO 日志。
 */
import {
    afterEach,
    describe,
    expect,
    it,
} from "vitest";
import type {FeatureHost} from "../../src/core/types";
import definition from "../../src/features/hide-selection-toolbar";
import {mountHideSelectionToolbar} from "../../src/features/hide-selection-toolbar/style";
import {
    configKeysOf,
    mountFeature,
    noopLogger,
} from "../helpers/feature-host";

/** 该功能注入的 `<style>` 是否唯一：重复挂载不该堆叠第二张。 */
const styleCount = (): number =>
    document.head.querySelectorAll('style[data-some-settings-style="hide-selection-toolbar"]').length;

/** 去掉注释再检查规则本体，避免命中注释里的同名文字。 */
const rulesOf = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("隐藏选中文字工具条", () => {
    const mounted: {dispose: () => void;}[] = [];

    const mount = () => {
        const harness = mountFeature(definition);
        mounted.push(harness);
        return harness;
    };

    afterEach(() => {
        mounted.splice(0).forEach((harness) => harness.dispose());
    });

    it("声明：编辑器分类、只适用桌面端、只有一个默认关闭的开关", () => {
        expect(definition.category).toBe("editor");
        expect(definition.frontends).toEqual(["desktop"]);
        expect(configKeysOf(definition.settings)).toEqual(["enabled"]);
        expect(definition.settings[0]).toMatchObject({kind: "switch", key: "enabled", default: false});
    });

    it("只隐藏 .protyle-toolbar：display: none !important，不碰二级面板与思维导图工具栏", () => {
        const css = rulesOf(mount().css());

        expect(css).toContain(".protyle-toolbar {");
        // 宿主样式表里也有同特异性的 display 声明，靠 !important 稳压
        expect(css).toMatch(/display:\s*none\s*!important/);
        // 只藏这一个类：字体 / 字号面板和思维导图工具栏是各自独立的浮层
        expect(css).not.toContain(".protyle-util");
        expect(css).not.toContain(".mindmap-view__toolbar");
        expect(css.match(/display:\s*none/g)).toHaveLength(1);
    });

    it("挂载注入一张样式表并记一条 INFO，不改任何 DOM", () => {
        const before = document.body.innerHTML;
        const harness = mount();

        expect(document.body.innerHTML).toBe(before);
        expect(styleCount()).toBe(1);
        expect(harness.styleElement()?.textContent).toContain(".protyle-toolbar");
        expect(harness.records.logLevels).toContain("info");
        expect(harness.records.logs.some((args) => String(args[0]).includes("mounted"))).toBe(true);
    });

    it("静态 CSS 不订阅配置变化：广播保存不会重复注入", () => {
        const harness = mount();
        expect(harness.records.configListeners).toHaveLength(0);

        harness.config.enabled = false;
        harness.notifyConfigChange();

        // 没有监听器：CSS 与配置无关，开关只决定要不要挂载（由核心负责）
        expect(harness.records.styles).toHaveLength(1);
        expect(styleCount()).toBe(1);
    });

    it("重复挂载共用同一个 <style>，不会堆出第二张样式表", () => {
        mount();
        mount();

        expect(styleCount()).toBe(1);
    });

    it("mount 只调一次 addStyle，并返回带 destroy 的实例", () => {
        const styles: string[] = [];
        const host = {
            addStyle: (css: string) => {
                styles.push(css);
            },
            log: noopLogger,
        } as unknown as FeatureHost;

        const instance = mountHideSelectionToolbar(host);

        expect(styles).toHaveLength(1);
        expect(styles[0]).toContain(".protyle-toolbar");
        expect(typeof instance.destroy).toBe("function");
    });

    it("dispose 移除样式、记一条卸载日志，且幂等", () => {
        const harness = mount();
        expect(styleCount()).toBe(1);

        harness.dispose();

        expect(styleCount()).toBe(0);
        expect(harness.styleElement()).toBeNull();
        expect(harness.records.logs.some((args) => String(args[0]).includes("unmounted"))).toBe(true);
        expect(() => harness.dispose()).not.toThrow();
    });
});
