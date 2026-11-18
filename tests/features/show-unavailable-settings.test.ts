/**
 * 显示不可用的设置（show-unavailable-settings）。
 *
 * 这个功能没有自己的界面：它唯一的职责是把 `core/availability.ts` 里那个标记跟自己的
 * 挂载状态绑在一起，设置面板据此把不可用的设置灰显出来。因此断言只有两条 ——
 * 挂载即打开、卸载即关闭；声明层面（plugin 分类、默认关闭）由 declarations.test.ts 统一覆盖。
 */
import {
    afterEach,
    describe,
    expect,
    it,
} from "vitest";
import {
    isShowUnavailable,
    setShowUnavailable,
} from "../../src/core/availability";
import definition from "../../src/features/show-unavailable-settings/index";
import {
    mountFeature,
    type HostHarness,
} from "../helpers/feature-host";

const mounted: HostHarness[] = [];

afterEach(() => {
    mounted.splice(0).forEach((harness) => harness.dispose());
    setShowUnavailable(false);
});

describe("show unavailable settings", () => {
    it("off by default", () => {
        expect(isShowUnavailable()).toBe(false);
    });

    it("mounting turns it on and unmounting turns it back off", () => {
        const harness = mountFeature(definition, {config: {enabled: true}});
        mounted.push(harness);

        expect(isShowUnavailable()).toBe(true);

        harness.dispose();
        expect(isShowUnavailable()).toBe(false);
    });

    it("mount and unmount each leave one log entry of their own", () => {
        const harness = mountFeature(definition, {config: {enabled: true}});
        mounted.push(harness);
        harness.dispose();

        const messages = harness.records.logs.map((entry) => String(entry[0]));
        expect(messages).toEqual([
            "unavailable settings are shown in the panel",
            "unavailable settings are hidden in the panel",
        ]);
        expect(harness.records.logLevels).toEqual(["info", "info"]);
    });
});
