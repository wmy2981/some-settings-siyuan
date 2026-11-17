/**
 * `core/availability.ts`：一个功能为什么不可用。
 *
 * 判定顺序即原因的重要程度：先看这个功能还要不要（`enabled: false`），再看当前这台设备
 * 有没有这块界面，最后才看版本区间。设置面板按这个结论把不可用的设置灰显出来。
 */
import {
    describe,
    expect,
    it,
} from "vitest";
import {
    isShowUnavailable,
    setShowUnavailable,
    unavailableReason,
} from "../../src/core/availability";
import type {FeatureDefinition} from "../../src/core/types";
import {mockState} from "../mocks/siyuan";

const featureOf = (extra: Partial<FeatureDefinition> = {}): FeatureDefinition => ({
    id: "demo",
    category: "editor",
    name: "demo.title",
    enabled: true,
    settings: [{kind: "switch", key: "enabled", title: "common.enabled", default: false}],
    ...extra,
});

describe("unavailableReason", () => {
    it("可用时没有原因", () => {
        mockState.frontend = "desktop";
        window.siyuan.config.system.kernelVersion = "3.8.7";
        expect(unavailableReason(featureOf())).toBeUndefined();
    });

    it("开发者禁用", () => {
        expect(unavailableReason(featureOf({enabled: false}))).toBe("disabled");
    });

    it("当前平台不适用", () => {
        mockState.frontend = "desktop";
        expect(unavailableReason(featureOf({frontends: ["mobile"]}))).toBe("frontend");
        mockState.frontend = "mobile";
        expect(unavailableReason(featureOf({frontends: ["desktop"]}))).toBe("frontend");
    });

    it("宿主低于声明的最低版本", () => {
        window.siyuan.config.system.kernelVersion = "3.8.7";
        expect(unavailableReason(featureOf({minAppVersion: "3.8.10"}))).toBe("minAppVersion");
        window.siyuan.config.system.kernelVersion = "3.8.10";
        expect(unavailableReason(featureOf({minAppVersion: "3.8.10"}))).toBeUndefined();
    });

    it("宿主高于声明的最高版本", () => {
        window.siyuan.config.system.kernelVersion = "3.9.0";
        expect(unavailableReason(featureOf({maxAppVersion: "3.8.10-alpha.1"}))).toBe("maxAppVersion");
        window.siyuan.config.system.kernelVersion = "3.8.10-alpha.1";
        expect(unavailableReason(featureOf({maxAppVersion: "3.8.10-alpha.1"}))).toBeUndefined();
    });

    it("原因按重要程度取第一个：禁用 > 平台 > 版本", () => {
        mockState.frontend = "desktop";
        window.siyuan.config.system.kernelVersion = "3.9.0";
        expect(unavailableReason(featureOf({
            enabled: false,
            frontends: ["mobile"],
            maxAppVersion: "3.8.10-alpha.1",
        }))).toBe("disabled");
        expect(unavailableReason(featureOf({
            frontends: ["mobile"],
            maxAppVersion: "3.8.10-alpha.1",
        }))).toBe("frontend");
    });

    it("宿主版本读不到时按不限处理，不把功能判成不可用", () => {
        window.siyuan.config.system.kernelVersion = "unreadable";
        expect(unavailableReason(featureOf({maxAppVersion: "3.8.10"}))).toBeUndefined();
    });
});

describe("显示不可用的设置标记", () => {
    it("默认关闭，可以来回翻转", () => {
        expect(isShowUnavailable()).toBe(false);
        setShowUnavailable(true);
        expect(isShowUnavailable()).toBe(true);
        setShowUnavailable(false);
        expect(isShowUnavailable()).toBe(false);
    });
});
