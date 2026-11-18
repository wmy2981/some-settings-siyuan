/**
 * 桌面端命令面板瘦身。
 *
 * 内核把命令面板的宽度写死在容器的**内联样式**里（`width: 80vw`），插件不能改内核 DOM，
 * 所以实现只有一条覆盖面极窄的 CSS：`!important` 压过内联样式，并按 80vw 等比缩放。
 * 断言要守住三件事：缩到多少、`!important` 还在不在、选择器有没有误伤别���弹窗。
 */
import {
    afterEach,
    describe,
    expect,
    it,
} from "vitest";
import type {FeatureHost} from "../../src/core/types";
import definition from "../../src/features/desktop-command-panel-slim";
import {mountCommandPanelSlim} from "../../src/features/desktop-command-panel-slim/slim";
import {mountFeature} from "../helpers/feature-host";

const styleCount = (): number =>
    document.head.querySelectorAll('style[data-some-settings-style="desktop-command-panel-slim"]').length;

/** 从注入的 CSS 里取出宽度声明，省得每个用例都拼一遍上下文。 */
const widthOf = (css: string): string | undefined => /width: ([^;]+);/.exec(css)?.[1];

describe("desktop command panel slimming", () => {
    const mounted: {dispose: () => void;}[] = [];

    const mount = (config?: Record<string, unknown>) => {
        const harness = mountFeature(definition, config ? {config} : {});
        mounted.push(harness);
        return harness;
    };

    afterEach(() => {
        mounted.splice(0).forEach((harness) => harness.dispose());
    });

    it("declares desktop-only delivery with width defaulting to 50% and ranging 20%-100%", () => {
        expect(definition.frontends).toEqual(["desktop"]);
        expect(definition.settings[0]).toMatchObject({kind: "switch", key: "enabled", default: false});
        expect(definition.settings[1]).toMatchObject({
            kind: "number",
            key: "width",
            default: 50,
            min: 20,
            max: 100,
            step: 5,
        });
    });

    it("default 50%: 40vw, and !important is required to beat the kernel inline width", () => {
        const harness = mount();

        const css = harness.css();
        expect(css).toContain('[data-key="dialog-commandpanel"] .b3-dialog__container {');
        expect(widthOf(css)).toBe("40vw !important");
        // 选择器只能有一层落在这个通用类上：多写一处就会连带别的弹窗一起变窄
        expect(css.match(/\.b3-dialog__container/g)).toHaveLength(1);
        expect(css).not.toContain("b3-dialog__body");
        expect(css).not.toContain('data-key="dialog-settings"');
        expect(styleCount()).toBe(1);
    });

    it("width scales proportionally to the native 80vw and never exceeds the native size", () => {
        expect(widthOf(mount({width: 20}).css())).toBe("16vw !important");
        expect(widthOf(mount({width: 60}).css())).toBe("48vw !important");
        expect(widthOf(mount({width: 100}).css())).toBe("80vw !important");
    });

    it("values are rounded first then clamped to 20-100: 22.5% becomes 23%, i.e. 18.4vw", () => {
        expect(widthOf(mount({width: 22.5}).css())).toBe("18.4vw !important");
        // 22.4 舍到 22% → 17.6vw，说明取的是整数百分比而不是原始小数
        expect(widthOf(mount({width: 22.4}).css())).toBe("17.6vw !important");
        expect(widthOf(mount({width: 33.6}).css())).toBe("27.2vw !important");
        // 19.6 四舍五入是 20，正好落在下限上
        expect(widthOf(mount({width: 19.6}).css())).toBe("16vw !important");
        expect(widthOf(mount({width: 100.4}).css())).toBe("80vw !important");
        expect(widthOf(mount({width: 5}).css())).toBe("16vw !important");
    });

    it("invalid values fall back to 50%", () => {
        [Number.NaN, Number.POSITIVE_INFINITY, undefined, "abc"].forEach((width) => {
            expect(widthOf(mount({width}).css())).toBe("40vw !important");
        });
    });

    it("a config change rewrites the same <style> in place without stacking a new sheet", () => {
        const harness = mount();
        expect(styleCount()).toBe(1);

        harness.config.width = 75;
        harness.notifyConfigChange();

        expect(styleCount()).toBe(1);
        expect(widthOf(harness.styleElement()?.textContent ?? "")).toBe("60vw !important");
    });

    it("dispose removes the style and the config subscription", () => {
        const harness = mount();

        harness.dispose();

        expect(styleCount()).toBe(0);
        expect(harness.records.configListeners).toHaveLength(0);
    });

    it("applies once on mount and wires later changes to onConfigChange", () => {
        const styles: string[] = [];
        const listeners: (() => void)[] = [];
        const host = {
            config: {width: 30},
            log: {info: () => undefined, warn: () => undefined, error: () => undefined},
            addStyle: (css: string) => {
                styles.push(css);
            },
            onConfigChange: (listener: () => void) => {
                listeners.push(listener);
            },
        } as unknown as FeatureHost;

        expect(mountCommandPanelSlim(host)).toEqual({});
        expect(styles).toHaveLength(1);
        expect(widthOf(styles[0])).toBe("24vw !important");
        expect(listeners).toHaveLength(1);
    });
});
