/**
 * Modal 遮罩模糊。
 *
 * 这个功能只有一段 CSS，所以断言全部落在注入的文本上：半径怎么取值与回落、哪些遮罩被排除。
 * 其中最重要的两条是踩过的坑：
 * 1. **生成的 CSS 永远要非空**。`core/style.ts` 的 `addStyle` 收到空串会直接返回，
 *    旧样式表留在 `<head>` 里清不掉 —— 用户把半径调回默认值时看起来「没生效」
 *    （docs/development.md 的「样式」一节）。所以每个非法值都必须落到 `blur(10px)`，而不是空样式。
 * 2. **进度遮罩要排除，不能用 `revert` 补救**。宿主的导入 / 重建索引进度遮罩自己写了毛玻璃与底色，
 *    `revert` 回滚到的是浏览器默认值而不是宿主那条规则（docs/development.md 的「样式」一节）。
 */
import {
    afterEach,
    describe,
    expect,
    it,
} from "vitest";
import type {FeatureHost} from "../../src/core/types";
import definition from "../../src/features/modal-blur";
import {mountModalBlur} from "../../src/features/modal-blur/style";
import {
    configKeysOf,
    mountFeature,
} from "../helpers/feature-host";

/** 该功能注入的 `<style>` 是否唯一：重复挂载、配置变更都不该堆叠第二张。 */
const styleCount = (): number => document.head.querySelectorAll('style[data-some-settings-style="modal-blur"]').length;

/**
 * 去掉注释再检查「有没有某条声明」。
 *
 * CSS 里那段注释本身就在讲「不能用 revert 补救」，直接全文搜索会命中注释本身，
 * 断言就成了假阳性。
 */
const rulesOf = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("Modal scrim blur", () => {
    const mounted: {dispose: () => void;}[] = [];

    const mount = (config?: Record<string, unknown>) => {
        const harness = mountFeature(definition, config ? {config} : {});
        mounted.push(harness);
        return harness;
    };

    // 功能会往 <head> 插样式、往宿主登记配置订阅，每个用例结束都要还原，
    // 否则后面的用例会读到上一份 CSS，或者被上一个功能的订阅串改
    afterEach(() => {
        mounted.splice(0).forEach((harness) => harness.dispose());
    });

    it("Declaration: both frontends, only a switch and a radius, radius defaults to 10 and is capped at 1-40", () => {
        expect(definition.frontends).toBeUndefined();
        expect(configKeysOf(definition.settings)).toEqual(["enabled", "radius"]);
        expect(definition.settings[0]).toMatchObject({kind: "switch", key: "enabled", default: false});
        expect(definition.settings[1]).toMatchObject({
            kind: "number",
            key: "radius",
            default: 10,
            min: 1,
            max: 40,
            step: 1,
            unit: "px",
        });
    });

    it("Default config: blurs the scrim itself by 10px and leaves the dialog alone", () => {
        const harness = mount();

        const css = harness.css();
        // 排除进度遮罩与后面几条覆盖必须落在同一个选择器块里，
        // 否则「排除了进度遮罩」这条意图会落空
        expect(css).toMatch(
            /\.b3-dialog__scrim:not\(\.b3-dialog__scrim--progress\)\s*\{[^}]*-webkit-backdrop-filter: blur\(10px\);[^}]*backdrop-filter: blur\(10px\);/,
        );
        // 旧版 WebView 只认带前缀的那条，缺一条就是纯视觉上「什么都没发生」
        expect(css).toContain("-webkit-backdrop-filter: blur(10px);");
        // 弹窗容器本身不能被糊：内容必须保持清晰
        expect(css).not.toContain(".b3-dialog__container");
        expect(css).not.toContain(".b3-dialog__content");
        expect(styleCount()).toBe(1);
        expect(harness.styleElement()?.textContent).toBe(harness.records.styles.at(-1));
    });

    it("Excludes the three scrims the host already handles and never hands styling back via revert", () => {
        const css = mount().css();

        // 属性视图面板复用了同一个遮罩类名，但它不是 modal
        expect(css).toMatch(/\.av__panel > \.b3-dialog__scrim\s*\{[^}]*backdrop-filter: none;/);
        // 非模态浮层（emoji / 图标面板、发布权限浮层）的遮罩是内联透明底色
        expect(css).toMatch(/\.b3-dialog__scrim\[style\*="transparent"\]\s*\{[^}]*backdrop-filter: none;/);
        // 移动端底部弹层整块排除，而不是逐个列 data-key（用它的地方还会增加）
        expect(css).toMatch(/\.mobile-bottom-sheet-dialog \.b3-dialog__scrim\s*\{[^}]*backdrop-filter: none;/);
        // revert 回滚不到宿主那条规则，只会得到 none（「样式」一节）
        expect(rulesOf(css)).not.toContain("revert");
    });

    it("Uses the configured radius and accepts numeric strings (the mount layer only does Number())", () => {
        expect(mount({radius: 24}).css()).toContain("backdrop-filter: blur(24px);");
        expect(mount({radius: "18"}).css()).toContain("backdrop-filter: blur(18px);");
        // 不取整：小数原样交给 CSS，行为上等同于 CSS 自己处理
        expect(mount({radius: 12.5}).css()).toContain("backdrop-filter: blur(12.5px);");
    });

    it("Accepts only positive finite radii: 0, negatives, NaN, Infinity, string noise and empty values fall back to 10", () => {
        [0, -3, -0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "abc", "", null, undefined]
            .forEach((radius) => {
                const css = mount({radius}).css();
                expect(css).toContain("backdrop-filter: blur(10px);");
                expect(css).not.toContain("blur(0px)");
                expect(css).not.toContain("blur(-");
                expect(css).not.toContain("blur(NaN");
            });
    });

    it("Generated CSS is never empty for any radius: an empty string makes addStyle return and keeps the old sheet", () => {
        // 这条是核心守则：一旦某个非法值生成空串，`<head>` 里会继续留着上一份样式，
        // 用户看到的就是「改了没反应」，而且重载插件也无效（只有整页刷新才恢复）
        [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "abc"].forEach((radius) => {
            const harness = mount({radius});
            expect(harness.css().trim().length).toBeGreaterThan(0);
            expect(harness.styleElement()?.textContent?.trim().length).toBeGreaterThan(0);
            expect(styleCount()).toBe(1);
        });
    });

    it("Rewrites in place when a large radius turns invalid and keeps the old radius out of the sheet", () => {
        const harness = mount({radius: 30});
        expect(harness.styleElement()?.textContent).toContain("blur(30px)");

        harness.config.radius = 0;
        harness.notifyConfigChange();

        const css = harness.styleElement()?.textContent ?? "";
        expect(css).toContain("blur(10px)");
        expect(css).not.toContain("blur(30px)");
        expect(styleCount()).toBe(1);
    });

    it("A config change reinjects the same stylesheet instead of stacking a second one", () => {
        const harness = mount();
        expect(styleCount()).toBe(1);

        harness.config.radius = 6;
        harness.notifyConfigChange();

        expect(styleCount()).toBe(1);
        expect(harness.records.styles).toHaveLength(2);
        expect(harness.styleElement()?.textContent).toBe(harness.records.styles.at(-1));
        expect(harness.styleElement()?.textContent).toContain("blur(6px)");
        expect(harness.styleElement()?.textContent).not.toContain("blur(10px)");
    });

    it("mount applies once and wires later changes to onConfigChange", () => {
        const styles: string[] = [];
        const listeners: (() => void)[] = [];
        const host = {
            config: {radius: 20},
            addStyle: (css: string) => {
                styles.push(css);
            },
            onConfigChange: (listener: () => void) => {
                listeners.push(listener);
            },
        } as unknown as FeatureHost;

        expect(mountModalBlur(host)).toEqual({});
        expect(styles).toHaveLength(1);
        expect(styles[0]).toContain("blur(20px)");
        expect(listeners).toHaveLength(1);
    });

    it("dispose removes the <style> from <head> together with the config subscription", () => {
        const harness = mount();
        const injected = harness.records.styles.length;
        expect(styleCount()).toBe(1);

        harness.dispose();

        expect(styleCount()).toBe(0);
        expect(harness.styleElement()).toBeNull();
        expect(harness.records.configListeners).toHaveLength(0);
        // 订阅已经退了：再广播一次也不该产生新的样式调用
        harness.notifyConfigChange();
        expect(harness.records.styles).toHaveLength(injected);
    });
});
