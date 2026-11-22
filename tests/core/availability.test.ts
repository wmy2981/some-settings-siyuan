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
    category: ["editor"],
    name: "demo.title",
    enabled: true,
    settings: [{kind: "switch", key: "enabled", title: "common.enabled", default: false}],
    ...extra,
});

describe("unavailableReasons", () => {
    it("no reasons when available", () => {
        mockState.frontend = "desktop";
        window.siyuan.config.system.kernelVersion = "3.8.7";
        expect(unavailableReasons(featureOf())).toEqual([]);
    });

    it("disabled by the developer", () => {
        expect(unavailableReasons(featureOf({enabled: false}))).toEqual(["disabled"]);
    });

    it("disabled by the user patch is reported separately from the developer", () => {
        // 两种「关掉」的后果一样（不装载、灰显），但原因必须分清：用户改的是自己的补丁文件
        expect(unavailableReasons(featureOf({enabled: false, fromPatch: {enabled: false}})))
            .toEqual(["userDisabled"]);
        // 开发者关掉、补丁没提它：仍是开发者禁用
        expect(unavailableReasons(featureOf({enabled: false}))).toEqual(["disabled"]);
        // 补丁把开发者撤下的功能重新打开：一条禁用原因都不剩
        expect(unavailableReasons(featureOf({enabled: true, fromPatch: {enabled: true}}))).toEqual([]);
    });

    it("not available on the current platform", () => {
        mockState.frontend = "desktop";
        expect(unavailableReasons(featureOf({frontends: ["mobile"]}))).toEqual(["frontend"]);
        mockState.frontend = "mobile";
        expect(unavailableReasons(featureOf({frontends: ["desktop"]}))).toEqual(["frontend"]);
    });

    it("host below the declared minimum version", () => {
        window.siyuan.config.system.kernelVersion = "3.8.7";
        expect(unavailableReasons(featureOf({minAppVersion: "3.8.10"}))).toEqual(["minAppVersion"]);
        window.siyuan.config.system.kernelVersion = "3.8.10";
        expect(unavailableReasons(featureOf({minAppVersion: "3.8.10"}))).toEqual([]);
    });

    it("host above the declared maximum version", () => {
        window.siyuan.config.system.kernelVersion = "3.9.0";
        expect(unavailableReasons(featureOf({maxAppVersion: "3.8.10-alpha.1"}))).toEqual(["maxAppVersion"]);
        window.siyuan.config.system.kernelVersion = "3.8.10-alpha.1";
        expect(unavailableReasons(featureOf({maxAppVersion: "3.8.10-alpha.1"}))).toEqual([]);
    });

    it("every matching reason is returned, in order disabled → platform → version", () => {
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

    it("an unreadable host version means no limit and never makes it unavailable", () => {
        window.siyuan.config.system.kernelVersion = "unreadable";
        expect(unavailableReasons(featureOf({maxAppVersion: "3.8.10"}))).toEqual([]);
    });
});

describe("show-unavailable settings flag", () => {
    it("off by default and toggles both ways", () => {
        expect(isShowUnavailable()).toBe(false);
        setShowUnavailable(true);
        expect(isShowUnavailable()).toBe(true);
        setShowUnavailable(false);
        expect(isShowUnavailable()).toBe(false);
    });
});
