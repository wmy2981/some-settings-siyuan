/**
 * 移动端悬浮 dock 栏高斯模糊。
 *
 * 这个功能只有一段 CSS，所以断言全部落在注入的文本上：模糊半径、透明度、选择器，
 * 以及「同一份样式表被就地重写」——`<head>` 里残留旧样式表是踩过的坑
 * （见 docs/development.md 的「样式」一节：重载插件不重载页面，旧 `<style>` 会留下来）。
 */
import {
    afterEach,
    describe,
    expect,
    it,
} from "vitest";
import type {FeatureHost} from "../../src/core/types";
import definition from "../../src/features/mobile-dock-blur";
import {mountMobileDockBlur} from "../../src/features/mobile-dock-blur/style";
import {mountFeature} from "../helpers/feature-host";

/** 该功能注入的 `<style>` 是否唯一（重复挂载 / 配置变更都不该堆叠）。 */
const styleCount = (): number =>
    document.head.querySelectorAll('style[data-some-settings-style="mobile-dock-blur"]').length;

describe("移动端悬浮 dock 栏高斯模糊", () => {
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

    it("声明里只在移动端交出，开关默认关闭，半径与不透明度带上下限", () => {
        expect(definition.frontends).toEqual(["mobile"]);
        expect(definition.settings[0]).toMatchObject({kind: "switch", key: "enabled", default: false});
        expect(definition.settings[1]).toMatchObject({
            kind: "number",
            key: "radius",
            default: 14,
            min: 1,
            max: 40,
        });
        expect(definition.settings[2]).toMatchObject({
            kind: "number",
            key: "opacity",
            default: 70,
            min: 0,
            max: 100,
        });
    });

    it("默认配置：胶囊底色 70% 不透明、14px 毛玻璃，且整段包在 @supports 里", () => {
        const harness = mount();

        const css = harness.css();
        // backdrop-filter 在旧版 WebView 上要带前缀，缺一条就会在移动端完全看不到模糊
        expect(css).toContain("@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))");
        expect(css).toContain(".mobile-bottom-bar {");
        expect(css).toContain("background-color: color-mix(in srgb, var(--b3-theme-background) 70%, transparent);");
        expect(css).toContain("-webkit-backdrop-filter: blur(14px);");
        expect(css).toContain("backdrop-filter: blur(14px);");
        // 只动胶囊自身：按钮自己的 hover / active 底色不能跟着被改
        expect(css).not.toContain("display:");
        expect(css).not.toContain("mobile-bottom-bar__");
        expect(styleCount()).toBe(1);
        expect(harness.styleElement()?.textContent).toBe(harness.records.styles.at(-1));
    });

    it("半径与不透明度按配置取值", () => {
        const harness = mount({radius: 24, opacity: 45});

        expect(harness.css()).toContain("backdrop-filter: blur(24px);");
        expect(harness.css()).toContain("var(--b3-theme-background) 45%, transparent");
    });

    it("半径只接受正数：0、负数、NaN、Infinity 都回落 14", () => {
        [0, -6, Number.NaN, Number.POSITIVE_INFINITY, "abc"].forEach((radius) => {
            const harness = mount({radius});
            expect(harness.css()).toContain("backdrop-filter: blur(14px);");
        });
    });

    it("不透明度钳到 0～100，非数字回落 70", () => {
        expect(mount({opacity: -20}).css()).toContain("var(--b3-theme-background) 0%, transparent");
        expect(mount({opacity: 150}).css()).toContain("var(--b3-theme-background) 100%, transparent");
        expect(mount({opacity: Number.NaN}).css()).toContain("var(--b3-theme-background) 70%, transparent");
        // 配置缺项时是 undefined：Number(undefined) 为 NaN，必须回落到默认值而不是 0
        expect(mount({opacity: undefined}).css()).toContain("var(--b3-theme-background) 70%, transparent");
        // 注意 Number("") 是 0 而不是 NaN，所以空串在这里会被钳成「完全透明」。
        // 配置层不会把字符串放进来（number 字段类型不符即回落默认值），这里如实钉住现状。
        expect(mount({opacity: ""}).css()).toContain("var(--b3-theme-background) 0%, transparent");
    });

    it("配置变更就地重写同一个 <style>，不叠加新样式表", () => {
        const harness = mount();
        expect(styleCount()).toBe(1);

        harness.config.radius = 30;
        harness.config.opacity = 40;
        harness.notifyConfigChange();

        expect(styleCount()).toBe(1);
        const css = harness.styleElement()?.textContent ?? "";
        expect(css).toContain("backdrop-filter: blur(30px);");
        expect(css).toContain("var(--b3-theme-background) 40%, transparent");
        expect(css).not.toContain("blur(14px)");
    });

    it("dispose 后样式、配置订阅与 <style> 元素全部收干净", () => {
        const harness = mount();
        const before = harness.records.styles.length;

        harness.dispose();

        expect(styleCount()).toBe(0);
        expect(harness.records.configListeners).toHaveLength(0);
        // 订阅已经退了：再广播一次也不该产生新的样式调用
        harness.notifyConfigChange();
        expect(harness.records.styles).toHaveLength(before);
    });

    it("挂载即应用一次，并把后续变更挂到 onConfigChange 上", () => {
        const styles: string[] = [];
        const listeners: (() => void)[] = [];
        const host = {
            config: {radius: 20, opacity: 80},
            addStyle: (css: string) => {
                styles.push(css);
            },
            onConfigChange: (listener: () => void) => {
                listeners.push(listener);
            },
        } as unknown as FeatureHost;

        expect(mountMobileDockBlur(host)).toEqual({});
        expect(styles).toHaveLength(1);
        expect(styles[0]).toContain("blur(20px)");
        expect(styles[0]).toContain("80%, transparent");
        expect(listeners).toHaveLength(1);
    });
});
