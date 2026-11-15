/**
 * 移动端栏体动画优化。
 *
 * 两个行为点值得守：
 * 1. **顶栏 / 面包屑只加过渡**，dock 栏多做一步「把连续进度折成 0 / 1 两档」，
 *    而且折档必须包在 `@supports` 里 —— 不支持 `clamp()` 的引擎要整块跳过、
 *    退回内核自己的连续显隐，而不是让 `opacity` 取到非法值后永远停在 1（栏体反而藏不住）。
 * 2. **时长与缓动都来自配置，非法值要回落**：时长钳到 0～600，缓动不在表里就回 `emphasized`。
 */
import {
    afterEach,
    describe,
    expect,
    it,
} from "vitest";
import type {FeatureHost} from "../../src/core/types";
import definition from "../../src/features/mobile-bar-animation";
import {mountMobileBarAnimation} from "../../src/features/mobile-bar-animation/style";
import {
    configKeysOf,
    mountFeature,
} from "../helpers/feature-host";

const EMPHASIZED = "cubic-bezier(.2, 0, 0, 1)";
const STANDARD = "cubic-bezier(.4, 0, .2, 1)";

/** 该功能注入的 `<style>` 是否唯一：重复挂载、配置变更都不该堆叠第二张。 */
const styleCount = (): number =>
    document.head.querySelectorAll('style[data-some-settings-style="mobile-bar-animation"]').length;

/** 去掉注释再检查规则本体，避免命中注释里的文字。 */
const rulesOf = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("移动端栏体动画优化", () => {
    const mounted: {dispose: () => void;}[] = [];

    const mount = (config?: Record<string, unknown>) => {
        const harness = mountFeature(definition, config ? {config} : {});
        mounted.push(harness);
        return harness;
    };

    afterEach(() => {
        mounted.splice(0).forEach((harness) => harness.dispose());
    });

    it("声明：只在移动端交出，时长默认 200ms（0～600）、缓动默认 emphasized", () => {
        expect(definition.category).toBe("appearance");
        expect(definition.frontends).toEqual(["mobile"]);
        expect(configKeysOf(definition.settings)).toEqual(["enabled", "duration", "easing"]);
        expect(definition.settings[0]).toMatchObject({kind: "switch", key: "enabled", default: false});
        expect(definition.settings[1]).toMatchObject({
            kind: "number",
            key: "duration",
            default: 200,
            min: 0,
            max: 600,
            step: 20,
        });
        expect(definition.settings[2]).toMatchObject({kind: "select", key: "easing", default: "emphasized"});
    });

    it("默认配置：三块栏体共用一条 200ms emphasized 过渡", () => {
        const css = rulesOf(mount().css());

        expect(css).toContain("#mobileTopBar,");
        expect(css).toContain("#editor > .protyle-breadcrumb,");
        expect(css).toContain("#mobileBottomBar {");
        expect(css).toContain(
            `transition: transform 200ms ${EMPHASIZED}, opacity 200ms ${EMPHASIZED};`,
        );
        // 键盘弹起 / 划选时栏体用 visibility 直接进出，加过渡会让它在动画期间残留
        expect(css).not.toContain("visibility");
        expect(styleCount()).toBe(1);
    });

    it("dock 栏把连续不透明度折成两档，且折档整块包在 @supports 里", () => {
        const css = rulesOf(mount().css());
        const [plain, supported] = css.split("@supports (opacity: clamp(0, 1, 1))");

        expect(supported).toBeDefined();
        // 顶栏与面包屑不做折档：它们仍按内核写入的连续进度淡出
        expect(plain).not.toContain("--ss-mobile-bar-visible:");
        expect(supported).toContain(
            "--ss-mobile-bar-visible: clamp(0, calc((var(--mobile-bar-opacity, 1) - 0.5) * 100), 1);",
        );
        expect(supported).toContain("opacity: var(--ss-mobile-bar-visible);");
        expect(supported).toContain("transform: translate3d(0, calc((1 - var(--ss-mobile-bar-visible)) * 100%), 0);");
        expect(supported).not.toContain("#mobileTopBar");
        // 阈值为 0.5、变量缺省按 1（内核还没写过时视为显示），两者都是观感的一部分
        expect(supported).toContain("- 0.5) * 100)");
        expect(supported).toContain("var(--mobile-bar-opacity, 1)");
    });

    it("时长按配置取值：0 与上限 600 原样可用，越界钳住，非数字回落 200", () => {
        expect(mount({duration: 0}).css()).toContain("transform 0ms");
        expect(mount({duration: 600}).css()).toContain("transform 600ms");
        expect(mount({duration: -100}).css()).toContain("transform 0ms");
        expect(mount({duration: 900}).css()).toContain("transform 600ms");
        [Number.NaN, Number.POSITIVE_INFINITY, "abc", undefined].forEach((duration) => {
            expect(mount({duration}).css()).toContain("transform 200ms");
        });
        // 数字字符串能被 Number() 吃掉；时长不取整，小数原样交给 CSS
        expect(mount({duration: "350"}).css()).toContain("transform 350ms");
        expect(mount({duration: 200.5}).css()).toContain("transform 200.5ms");
    });

    it("缓动按白名单映射，未知值回落 emphasized", () => {
        expect(mount({easing: "linear"}).css()).toContain("transform 200ms linear");
        expect(mount({easing: "standard"}).css()).toContain(`transform 200ms ${STANDARD}`);
        expect(mount({easing: "emphasized"}).css()).toContain(`transform 200ms ${EMPHASIZED}`);
        ["", "bogus", undefined, null].forEach((easing) => {
            expect(mount({easing}).css()).toContain(`transform 200ms ${EMPHASIZED}`);
        });
    });

    it("配置变更重新注入同一张样式表，不堆叠第二张", () => {
        const harness = mount();
        expect(styleCount()).toBe(1);

        harness.config.duration = 320;
        harness.config.easing = "linear";
        harness.notifyConfigChange();

        expect(styleCount()).toBe(1);
        expect(harness.records.styles).toHaveLength(2);
        const css = harness.styleElement()?.textContent ?? "";
        expect(css).toBe(harness.records.styles.at(-1));
        expect(css).toContain("transform 320ms linear");
        expect(css).not.toContain("transform 200ms");
    });

    it("mount 即应用一次，并把后续变更挂到 onConfigChange 上", () => {
        const styles: string[] = [];
        const listeners: (() => void)[] = [];
        const host = {
            config: {duration: 120, easing: "standard"},
            addStyle: (css: string) => {
                styles.push(css);
            },
            onConfigChange: (listener: () => void) => {
                listeners.push(listener);
            },
        } as unknown as FeatureHost;

        expect(mountMobileBarAnimation(host)).toEqual({});
        expect(styles).toHaveLength(1);
        expect(styles[0]).toContain(`transition: transform 120ms ${STANDARD}, opacity 120ms ${STANDARD};`);
        expect(listeners).toHaveLength(1);
    });

    it("dispose 之后 <head> 里的 <style> 与配置订阅一起收干净", () => {
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
