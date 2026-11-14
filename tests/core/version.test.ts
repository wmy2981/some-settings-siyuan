/**
 * `core/version.ts`：版本号解析、比较与「该功能在本宿主上还适用吗」的判定。
 */
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import type {FeatureDefinition} from "../../src/core/types";
import {
    compareVersion,
    hostVersion,
    parseVersion,
    supportsCurrentHost,
} from "../../src/core/version";

/**
 * 重新加载版本模块：告警去重表在模块作用域，要观察「只告警一次」只能拿一份新的。
 * 同时把那份新模块自己的日志开关打开 —— 它和顶部导入的不是同一个实例。
 */
const freshVersion = async (): Promise<typeof import("../../src/core/version")> => {
    vi.resetModules();
    const [version, log] = await Promise.all([
        import("../../src/core/version"),
        import("../../src/core/log"),
    ]);
    log.setDetailedLogging(true);
    return version;
};

/** 只带版本区间的功能声明；其余字段判定用不到。 */
const definitionWith = (range: {minAppVersion?: string; maxAppVersion?: string;}): FeatureDefinition => ({
    id: "demo",
    category: "editor",
    name: "demo.name",
    enabled: true,
    settings: [],
    ...range,
});

describe("parseVersion", () => {
    it("解析正式版", () => {
        expect(parseVersion("3.8.7")).toEqual({major: 3, minor: 8, patch: 7, prerelease: []});
    });

    it("接受前缀 v 与构建号", () => {
        expect(parseVersion("v3.8.7")).toEqual({major: 3, minor: 8, patch: 7, prerelease: []});
        expect(parseVersion("3.8.7+build.5")).toEqual({major: 3, minor: 8, patch: 7, prerelease: []});
    });

    it("解析预发布号", () => {
        expect(parseVersion("3.8.7-alpha.2")?.prerelease).toEqual(["alpha", "2"]);
        expect(parseVersion("3.8.7-rc.1+build")?.prerelease).toEqual(["rc", "1"]);
    });

    it("忽略首尾空白", () => {
        expect(parseVersion("  3.8.7  ")).toEqual({major: 3, minor: 8, patch: 7, prerelease: []});
    });

    it("认不出时返回 undefined", () => {
        expect(parseVersion("")).toBeUndefined();
        expect(parseVersion("3.8")).toBeUndefined();
        expect(parseVersion("siyuan")).toBeUndefined();
        expect(parseVersion("3.8.7.1")).toBeUndefined();
    });
});

describe("compareVersion", () => {
    const cmp = (left: string, right: string): number => {
        const a = parseVersion(left);
        const b = parseVersion(right);
        if (!a || !b) {
            throw new Error(`unparsable version: ${left} / ${right}`);
        }
        return Math.sign(compareVersion(a, b));
    };

    it("按 major / minor / patch 依次比较", () => {
        expect(cmp("3.8.7", "3.8.7")).toBe(0);
        expect(cmp("4.0.0", "3.9.9")).toBe(1);
        expect(cmp("3.9.0", "3.8.9")).toBe(1);
        expect(cmp("3.8.6", "3.8.7")).toBe(-1);
    });

    it("预发布版小于同号正式版", () => {
        expect(cmp("3.8.7-alpha.2", "3.8.7")).toBe(-1);
        expect(cmp("3.8.7", "3.8.7-alpha.2")).toBe(1);
        expect(cmp("3.8.7-alpha.2", "3.8.7-alpha.2")).toBe(0);
    });

    it("按 alpha < beta < rc 的顺序比较预发布", () => {
        expect(cmp("3.8.7-alpha.9", "3.8.7-beta.1")).toBe(-1);
        expect(cmp("3.8.7-beta.9", "3.8.7-rc.1")).toBe(-1);
        expect(cmp("3.8.7-rc.1", "3.8.7-rc.2")).toBe(-1);
        expect(cmp("3.8.7-rc.1", "3.8.7-alpha.1")).toBe(1);
    });

    it("同一段预发布里的数字按数值比，不是按字符串比", () => {
        expect(cmp("3.8.7-alpha.2", "3.8.7-alpha.10")).toBe(-1);
        expect(cmp("3.8.7-alpha.10", "3.8.7-alpha.2")).toBe(1);
    });

    it("数字段小于非数字段", () => {
        expect(cmp("3.8.7-1", "3.8.7-alpha")).toBe(-1);
        expect(cmp("3.8.7-alpha", "3.8.7-1")).toBe(1);
    });

    it("前缀相同的预发布里，段数少的更小", () => {
        expect(cmp("3.8.7-alpha", "3.8.7-alpha.1")).toBe(-1);
        expect(cmp("3.8.7-alpha.1", "3.8.7-alpha")).toBe(1);
    });
});

describe("hostVersion", () => {
    it("读 window.siyuan.config.system.kernelVersion", () => {
        window.siyuan.config.system.kernelVersion = "3.9.3";
        expect(hostVersion()).toEqual({major: 3, minor: 9, patch: 3, prerelease: []});
    });

    it("读不到或认不出时返回 undefined", () => {
        window.siyuan.config.system.kernelVersion = "";
        expect(hostVersion()).toBeUndefined();
        window.siyuan.config.system.kernelVersion = "unknown";
        expect(hostVersion()).toBeUndefined();
        window.siyuan.config.system.kernelVersion = 3 as unknown as string;
        expect(hostVersion()).toBeUndefined();
        window.siyuan.config.system = undefined as never;
        expect(hostVersion()).toBeUndefined();
    });
});

describe("supportsCurrentHost", () => {
    it("没写区间时永远适用，且不读宿主版本", () => {
        window.siyuan.config.system = undefined as never;
        expect(supportsCurrentHost(definitionWith({}))).toBe(true);
    });

    it("两端都是闭区间", () => {
        window.siyuan.config.system.kernelVersion = "3.8.7";
        expect(supportsCurrentHost(definitionWith({minAppVersion: "3.8.7"}))).toBe(true);
        expect(supportsCurrentHost(definitionWith({maxAppVersion: "3.8.7"}))).toBe(true);
        expect(supportsCurrentHost(definitionWith({minAppVersion: "3.8.8"}))).toBe(false);
        expect(supportsCurrentHost(definitionWith({maxAppVersion: "3.8.6"}))).toBe(false);
    });

    it("区间内部返回 true", () => {
        window.siyuan.config.system.kernelVersion = "3.8.7";
        expect(supportsCurrentHost(definitionWith({minAppVersion: "3.8.0", maxAppVersion: "3.9.0"}))).toBe(true);
    });

    it("预发布宿主与正式版边界的比较", () => {
        window.siyuan.config.system.kernelVersion = "3.8.10-alpha.1";
        expect(supportsCurrentHost(definitionWith({maxAppVersion: "3.8.10-alpha.1"}))).toBe(true);
        expect(supportsCurrentHost(definitionWith({maxAppVersion: "3.8.9"}))).toBe(false);
        window.siyuan.config.system.kernelVersion = "3.8.10-alpha.2";
        expect(supportsCurrentHost(definitionWith({maxAppVersion: "3.8.10-alpha.1"}))).toBe(false);
    });

    it("只给一侧时另一侧不限", () => {
        window.siyuan.config.system.kernelVersion = "3.8.7";
        expect(supportsCurrentHost(definitionWith({minAppVersion: "3.0.0"}))).toBe(true);
        expect(supportsCurrentHost(definitionWith({maxAppVersion: "9.0.0"}))).toBe(true);
    });

    it("宿主版本读不到时按「不限」处理，并只告警一次", async () => {
        const fresh = await freshVersion();
        window.siyuan.config.system = undefined as never;
        expect(fresh.supportsCurrentHost(definitionWith({minAppVersion: "9.9.9"}))).toBe(true);
        expect(fresh.supportsCurrentHost(definitionWith({minAppVersion: "9.9.9"}))).toBe(true);
        expect(vi.mocked(console.warn)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(console.warn).mock.calls[0][0]).toContain('cannot tell whether "demo" fits this host');
    });

    it("边界写法认不出时忽略该侧，并只告警一次", async () => {
        const fresh = await freshVersion();
        window.siyuan.config.system.kernelVersion = "3.8.7";
        expect(fresh.supportsCurrentHost(definitionWith({minAppVersion: "newest"}))).toBe(true);
        expect(fresh.supportsCurrentHost(definitionWith({minAppVersion: "newest"}))).toBe(true);
        expect(vi.mocked(console.warn)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(console.warn).mock.calls[0][0]).toContain("unreadable minAppVersion");
    });

    it("上限写法认不出时同样忽略，并只告警一次", async () => {
        const fresh = await freshVersion();
        window.siyuan.config.system.kernelVersion = "3.8.7";
        expect(fresh.supportsCurrentHost(definitionWith({maxAppVersion: "3.8.x"}))).toBe(true);
        expect(fresh.supportsCurrentHost(definitionWith({maxAppVersion: "3.8.x"}))).toBe(true);
        expect(vi.mocked(console.warn)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(console.warn).mock.calls[0][0]).toContain("unreadable maxAppVersion");
    });
});

describe("告警去重表按功能隔离", () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        vi.resetModules();
    });

    it("两个功能各告警一次，互不影响", async () => {
        const fresh = await freshVersion();
        window.siyuan.config.system = undefined as never;
        fresh.supportsCurrentHost({...definitionWith({minAppVersion: "9.9.9"}), id: "alpha"});
        fresh.supportsCurrentHost({...definitionWith({minAppVersion: "9.9.9"}), id: "beta"});
        fresh.supportsCurrentHost({...definitionWith({minAppVersion: "9.9.9"}), id: "alpha"});
        expect(vi.mocked(console.warn)).toHaveBeenCalledTimes(2);
    });
});
