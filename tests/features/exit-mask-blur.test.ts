/**
 * 退出应用遮罩始终模糊。
 *
 * 宿主给退出遮罩挂的是 5 秒渐入动画（blur(0) → blur(8px)），动画会压过元素自身的静态声明；
 * 这里只停掉动画。断言因此守两头：一是确实只写了 `animation: none`，
 * 二是没有重写 `backdrop-filter` —— 减少透明度 / 强制颜色模式下的无模糊回退由宿主的媒体查询负责。
 */
import {
    afterEach,
    describe,
    expect,
    it,
} from "vitest";
import type {FeatureHost} from "../../src/core/types";
import definition from "../../src/features/exit-mask-blur";
import {mountExitMaskBlur} from "../../src/features/exit-mask-blur/style";
import {
    configKeysOf,
    mountFeature,
} from "../helpers/feature-host";

/** 该功能注入的 `<style>` 是否唯一：重复挂载不该堆叠第二张。 */
const styleCount = (): number =>
    document.head.querySelectorAll('style[data-some-settings-style="exit-mask-blur"]').length;

/** 去掉注释再检查规则本体，避免命中注释里的选择器与属性名。 */
const rulesOf = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("Exit mask stays blurred", () => {
    const mounted: {dispose: () => void;}[] = [];

    const mount = () => {
        const harness = mountFeature(definition);
        mounted.push(harness);
        return harness;
    };

    afterEach(() => {
        mounted.splice(0).forEach((harness) => harness.dispose());
    });

    it("declaration: appearance category, loaded from 3.8.10, a single switch that is off by default", () => {
        expect(definition.category).toBe("appearance");
        expect(definition.minAppVersion).toBe("3.8.10");
        // 桌面端与移动端共用同一套进度遮罩，不该只对一端交出
        expect(definition.frontends).toBeUndefined();
        expect(configKeysOf(definition.settings)).toEqual(["enabled"]);
        expect(definition.settings[0]).toMatchObject({kind: "switch", key: "enabled", default: false});
    });

    it("only stops the animation: one extra body level over the host rule, no !important", () => {
        const css = rulesOf(mount().css());

        expect(css).toContain("body #exitProgress .b3-dialog__scrim--progress {");
        expect(css).toMatch(/animation:\s*none;/);
        // 少一级 body 就和宿主那条同特异性，谁后加载谁赢 —— 这正是要避免的不确定性
        expect(css).not.toMatch(/(^|\n)#exitProgress/);
        expect(css).not.toContain("!important");
    });

    it("does not rewrite the blur or the background: the host media queries keep the accessible fallback", () => {
        const css = rulesOf(mount().css());

        expect(css).not.toContain("backdrop-filter");
        expect(css).not.toContain("background");
    });

    it("static CSS does not subscribe to config changes, so a broadcast save does not reinject", () => {
        const harness = mount();
        expect(harness.records.styles).toHaveLength(1);
        expect(harness.records.configListeners).toHaveLength(0);

        harness.notifyConfigChange();

        expect(harness.records.styles).toHaveLength(1);
    });

    it("repeated mounts share one <style>", () => {
        mount();
        mount();

        expect(styleCount()).toBe(1);
    });

    it("mount calls addStyle once and logs both mount and unmount", () => {
        const styles: string[] = [];
        const logs: unknown[][] = [];
        const host = {
            addStyle: (css: string) => {
                styles.push(css);
            },
            log: {
                info: (...args: unknown[]) => logs.push(args),
            },
        } as unknown as FeatureHost;

        const instance = mountExitMaskBlur(host);

        expect(styles).toHaveLength(1);
        expect(styles[0]).toContain("#exitProgress .b3-dialog__scrim--progress");
        expect(logs).toHaveLength(1);

        instance.destroy?.();

        expect(logs).toHaveLength(2);
    });

    it("dispose removes the <style> from <head>", () => {
        const harness = mount();
        expect(styleCount()).toBe(1);

        harness.dispose();

        expect(styleCount()).toBe(0);
        expect(harness.styleElement()).toBeNull();
    });
});
