/**
 * 设置面板搜索（settings-search）。
 *
 * 这个功能没有自己的界面：它唯一的职责是把 `core/search.ts` 里那个标记跟自己的挂载状态
 * 绑在一起，设置面板据此显隐搜索框。核心断言是「挂载即打开、卸载即关闭」；
 * 声明层面（plugin 分类、默认开启）由 declarations.test.ts 统一覆盖。
 */
import {
    afterEach,
    describe,
    expect,
    it,
} from "vitest";
import {
    isSearchEnabled,
    setSearchEnabled,
} from "../../src/core/search";
import definition from "../../src/features/settings-search/index";
import {
    mountFeature,
    type HostHarness,
} from "../helpers/feature-host";

const mounted: HostHarness[] = [];

afterEach(() => {
    mounted.splice(0).forEach((harness) => harness.dispose());
    setSearchEnabled(false);
});

describe("settings panel search", () => {
    it("the core flag starts off until the feature mounts", () => {
        expect(isSearchEnabled()).toBe(false);
    });

    it("mounting turns it on and unmounting turns it back off", () => {
        const harness = mountFeature(definition, {config: {enabled: true}});
        mounted.push(harness);

        expect(isSearchEnabled()).toBe(true);

        harness.dispose();
        expect(isSearchEnabled()).toBe(false);
    });

    it("its switch is on by default", () => {
        const toggle = definition.settings.find((field) => field.kind === "switch" && field.key === "enabled");
        expect(toggle).toMatchObject({default: true});
    });

    it("mount and unmount each leave one log entry of their own", () => {
        const harness = mountFeature(definition, {config: {enabled: true}});
        mounted.push(harness);
        harness.dispose();

        const messages = harness.records.logs.map((entry) => String(entry[0]));
        expect(messages).toEqual([
            "settings panel search enabled",
            "settings panel search disabled",
        ]);
        expect(harness.records.logLevels).toEqual(["info", "info"]);
    });
});
