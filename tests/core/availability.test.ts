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
    unavailableReasons,
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

describe("unavailableReasons", () => {
    it("可用时没有原因", () => {
        mockState.frontend = "desktop";
        window.siyuan.config.system.kernelVersion = "3.8.7";
        expect(unavailableReasons(featureOf())).toEqual([]);
    });

    it("开发者禁用", () => {
        expect(unavailableReasons(featureOf({enabled: false}))).toEqual(["disabled"]);
    });

    it("当前平台不适用", () => {
        mockState.frontend = "desktop";
        expect(unavailableReasons(featureOf({frontends: ["mobile"]}))).toEqual(["frontend"]);
        mockState.frontend = "mobile";
        expect(unavailableReasons(featureOf({frontends: ["desktop"]}))).toEqual(["frontend"]);
    });

    it("宿主低于声明的最低版本", () => {
        window.siyuan.config.system.kernelVersion = "3.8.7";
        expect(unavailableReasons(featureOf({minAppVersion: "3.8.10"}))).toEqual(["minAppVersion"]);
        window.siyuan.config.system.kernelVersion = "3.8.10";
        expect(unavailableReasons(featureOf({minAppVersion: "3.8.10"}))).toEqual([]);
    });

    it("宿主高于声明的最高版本", () => {
        window.siyuan.config.system.kernelVersion = "3.9.0";
        expect(unavailableReasons(featureOf({maxAppVersion: "3.8.10-alpha.1"}))).toEqual(["maxAppVersion"]);
        window.siyuan.config.system.kernelVersion = "3.8.10-alpha.1";
        expect(unavailableReasons(featureOf({maxAppVersion: "3.8.10-alpha.1"}))).toEqual([]);
    });

    it("命中的原因全部返回，顺序是 禁用 → 平台 → 版本", () => {
        mockState.frontend = "desktop";
        window.siyuan.config.system.kernelVersion = "3.9.0";
        expect(unavailableReasons(featureOf({
            enabled: false,
            frontends: ["mobile"],
            maxAppVersion: "3.8.10-alpha.1",
        }))).toEqual(["disabled", "frontend", "maxAppVersion"]);
        // 只命中平台与版本时，两条都在
        expect(unavailableReasons(featureOf({
            frontends: ["mobile"],
            maxAppVersion: "3.8.10-alpha.1",
        }))).toEqual(["frontend", "maxAppVersion"]);
        // 只命中版本时只有一条
        expect(unavailableReasons(featureOf({maxAppVersion: "3.8.10-alpha.1"}))).toEqual(["maxAppVersion"]);
    });

    it("宿主版本读不到时按不限处理，不把功能判成不可用", () => {
        window.siyuan.config.system.kernelVersion = "unreadable";
        expect(unavailableReasons(featureOf({maxAppVersion: "3.8.10"}))).toEqual([]);
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
