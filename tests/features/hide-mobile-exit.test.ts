/**
 * 隐藏移动端退出应用按钮。
 *
 * 模块本体在移动端会把这个按钮重新显示出来（`classList.remove("fn__none")`），
 * 所以只能靠 CSS 压住；按钮**必须留在 DOM 里**，插件卸载后立刻恢复，
 * 这也是「只用 CSS、不改核心 DOM」的直观证据。
 *
 * 选择器写成 `#sidebarRight > .toolbar > #sidebarRightExit`：带两级父元素提高优先级，
 * 避免和面板布局规则打架；不用 `!important`。
 */
import {
    afterEach,
    describe,
    expect,
    it,
} from "vitest";
import type {FeatureHost} from "../../src/core/types";
import definition from "../../src/features/hide-mobile-exit";
import {mountHideMobileExit} from "../../src/features/hide-mobile-exit/style";
import {
    configKeysOf,
    mountFeature,
} from "../helpers/feature-host";

/** 该功能注入的 `<style>` 是否唯一：重复挂载不该堆叠第二张。 */
const styleCount = (): number =>
    document.head.querySelectorAll('style[data-some-settings-style="hide-mobile-exit"]').length;

/** 去掉注释再检查规则本体，避免命中注释里的同名文字。 */
const rulesOf = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("隐藏移动端退出应用按钮", () => {
    const mounted: {dispose: () => void;}[] = [];

    const mount = () => {
        const harness = mountFeature(definition);
        mounted.push(harness);
        return harness;
    };

    afterEach(() => {
        mounted.splice(0).forEach((harness) => harness.dispose());
    });

    it("声明：属于界面分类，只在移动端交出，只有一个默认关闭的开关", () => {
        expect(definition.category).toBe("appearance");
        expect(definition.frontends).toEqual(["mobile"]);
        expect(configKeysOf(definition.settings)).toEqual(["enabled"]);
        expect(definition.settings[0]).toMatchObject({kind: "switch", key: "enabled", default: false});
    });

    it("选择器逐级限定到那个按钮，不波及整个工具栏或右侧面板", () => {
        const css = rulesOf(mount().css());

        expect(css).toContain("#sidebarRight > .toolbar > #sidebarRightExit {");
        expect(css.match(/display:\s*none/g)).toHaveLength(1);
        // 少写一级选择器就会把整条工具栏 / 整个面板一起藏掉
        expect(css).not.toMatch(/#sidebarRight\s*\{/);
        expect(css).not.toMatch(/\.toolbar\s*\{/);
        expect(css).not.toContain("!important");
    });

    it("按钮留在 DOM 里：功能只加样式，不动核心 DOM", () => {
        document.body.innerHTML = `<div id="sidebarRight">
            <div class="toolbar"><button id="sidebarRightExit" class="fn__none"></button></div>
        </div>`;
        const button = document.getElementById("sidebarRightExit");

        mount();

        // 同一个节点、类名都没被改过：模块把 fn__none 去掉后，样式表仍旧压着它
        expect(document.getElementById("sidebarRightExit")).toBe(button);
        expect(button?.className).toBe("fn__none");
        expect(styleCount()).toBe(1);
    });

    it("静态 CSS 不订阅配置变化：广播保存不会重复注入", () => {
        const harness = mount();
        expect(harness.records.styles).toHaveLength(1);
        expect(harness.records.configListeners).toHaveLength(0);

        harness.notifyConfigChange();

        expect(harness.records.styles).toHaveLength(1);
    });

    it("重复挂载共用同一个 <style>", () => {
        mount();
        mount();

        expect(styleCount()).toBe(1);
    });

    it("mount 只调一次 addStyle", () => {
        const styles: string[] = [];
        const host = {
            addStyle: (css: string) => {
                styles.push(css);
            },
        } as unknown as FeatureHost;

        expect(mountHideMobileExit(host)).toEqual({});
        expect(styles).toHaveLength(1);
        expect(styles[0]).toContain("#sidebarRightExit");
    });

    it("dispose 之后 <head> 里的 <style> 被移除", () => {
        const harness = mount();
        expect(styleCount()).toBe(1);

        harness.dispose();

        expect(styleCount()).toBe(0);
        expect(harness.styleElement()).toBeNull();
    });
});
