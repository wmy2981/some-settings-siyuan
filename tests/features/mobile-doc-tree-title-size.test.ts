/**
 * 移动端文档树标题字号回归 3.8.9。
 *
 * 这个功能**只回退字号**：两版之间移动端侧栏列表只有 `font-size` 这一处不同，
 * 照抄整块样式只会在宿主下次微调时变成一堆过期值。断言因此同时守两头：
 * 一是字号必须是 3.8.9 的比例（14 / 16 = 0.875）并跟随思源字号设置，
 * 二是除了 `font-size` 之外不能有任何声明（图标、箭头、计数器一个字都不动）。
 *
 * 选择器比内核那条多一个 `body`：两者 id 与类名数量相同，只有多出来的元素选择器
 * 能让它不以样式表先后顺序取胜。
 */
import {
    afterEach,
    describe,
    expect,
    it,
} from "vitest";
import type {FeatureHost} from "../../src/core/types";
import definition from "../../src/features/mobile-doc-tree-title-size";
import {mountMobileDocTreeTitleSize} from "../../src/features/mobile-doc-tree-title-size/style";
import {
    configKeysOf,
    mountFeature,
} from "../helpers/feature-host";

/** 该功能注入的 `<style>` 是否唯一：重复挂载不该堆叠第二张。 */
const styleCount = (): number =>
    document.head.querySelectorAll('style[data-some-settings-style="mobile-doc-tree-title-size"]').length;

/** 去掉注释再检查规则本体，避免命中注释里的 14px / 16px。 */
const rulesOf = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("移动端文档树标题字号回归 3.8.9", () => {
    const mounted: {dispose: () => void;}[] = [];

    const mount = () => {
        const harness = mountFeature(definition);
        mounted.push(harness);
        return harness;
    };

    afterEach(() => {
        mounted.splice(0).forEach((harness) => harness.dispose());
    });

    it("声明：属于文档树分类，只在移动端交出，只有一个默认关闭的开关", () => {
        expect(definition.category).toBe("doc-tree");
        expect(definition.frontends).toEqual(["mobile"]);
        expect(configKeysOf(definition.settings)).toEqual(["enabled"]);
        expect(definition.settings[0]).toMatchObject({kind: "switch", key: "enabled", default: false});
    });

    it("两条选择器都带 body 前缀：靠特异性压过内核那条，不靠样式表顺序", () => {
        const css = rulesOf(mount().css());

        expect(css).toContain("body #sidebar .b3-list--mobile .b3-list-item,");
        expect(css).toContain("body #sidebarRight .b3-list--mobile .b3-list-item {");
        // 去掉 body 就和内核那条同特异性了，谁后加载谁赢 —— 这正是要避免的不确定性
        expect(css).not.toMatch(/(^|\n)#sidebar \.b3-list--mobile/);
        expect(css).not.toContain("!important");
    });

    it("字号是 0.875 倍（默认 16px 即 3.8.9 的 14px），并跟随思源字号设置", () => {
        const css = rulesOf(mount().css());

        expect(css).toContain("font-size: calc(var(--b3-font-size-editor, 16px) * 0.875);");
        // 比例就是 14 / 16：写死 14px 会让调大字号时标题不再跟着长
        expect(css).toContain(`* ${14 / 16}`);
        expect(css).toContain("var(--b3-font-size-editor, 16px)");
        expect(css).not.toContain("font-size: 14px");
        expect(css).not.toContain("font-size: 16px");
    });

    it("除了 font-size 一条声明，其它尺寸一律不碰", () => {
        const css = rulesOf(mount().css());

        // 数声明而不是数「font-size」这个词：变量名 --b3-font-size-editor 里也有它
        expect(css.match(/font-size:/g)).toHaveLength(1);
        ["width", "height", "margin", "padding", "line-height", "transform", "gap"].forEach((property) => {
            expect(css).not.toContain(`${property}:`);
        });
    });

    it("静态 CSS 不订阅配置变化：广播保存不会重复注入", () => {
        const harness = mount();
        expect(harness.records.styles).toHaveLength(1);
        expect(harness.records.configListeners).toHaveLength(0);

        harness.notifyConfigChange();

        expect(harness.records.styles).toHaveLength(1);
        expect(styleCount()).toBe(1);
    });

    it("重复挂载共用同一个 <style>", () => {
        mount();
        mount();

        expect(styleCount()).toBe(1);
    });

    it("mount 只调一次 addStyle，不改 DOM", () => {
        const styles: string[] = [];
        const host = {
            addStyle: (css: string) => {
                styles.push(css);
            },
        } as unknown as FeatureHost;
        const before = document.body.innerHTML;

        expect(mountMobileDocTreeTitleSize(host)).toEqual({});
        expect(styles).toHaveLength(1);
        expect(styles[0]).toContain("* 0.875");
        expect(document.body.innerHTML).toBe(before);
    });

    it("dispose 之后 <head> 里的 <style> 被移除", () => {
        const harness = mount();
        expect(styleCount()).toBe(1);

        harness.dispose();

        expect(styleCount()).toBe(0);
        expect(harness.styleElement()).toBeNull();
    });
});
