/**
 * 详细日志输出（log-output）。
 *
 * 这个功能没有界面：它唯一的职责是把 `core/log.ts` 的总开关跟自己的挂载状态绑在一起。
 * 因此断言只有两条 —— 挂载即打开、卸载即关闭；声明层面（plugin 分类、默认关闭）由
 * declarations.test.ts 统一覆盖。
 */
import {
    afterEach,
    describe,
    expect,
    it,
} from "vitest";
import {isDetailedLogging} from "../../src/core/log";
import definition from "../../src/features/log-output/index";
import {
    mountFeature,
    type HostHarness,
} from "../helpers/feature-host";

const mounted: HostHarness[] = [];

afterEach(() => {
    mounted.splice(0).forEach((harness) => harness.dispose());
});

describe("Detailed log output", () => {
    it("Off by default", () => {
        expect(isDetailedLogging()).toBe(false);
    });

    it("Mounting turns detailed logging on, unmounting turns it back off", () => {
        const harness = mountFeature(definition, {config: {enabled: true}});
        mounted.push(harness);

        expect(isDetailedLogging()).toBe(true);

        harness.dispose();
        expect(isDetailedLogging()).toBe(false);
    });

    it("Mount and unmount each leave one log line", () => {
        const harness = mountFeature(definition, {config: {enabled: true}});
        mounted.push(harness);
        harness.dispose();

        const messages = harness.records.logs.map((entry) => String(entry[0]));
        expect(messages).toEqual(["detailed logging enabled", "detailed logging disabled"]);
        expect(harness.records.logLevels).toEqual(["info", "info"]);
    });
});
