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
    category: ["editor"],
    name: "demo.name",
    enabled: true,
    settings: [],
    ...range,
});

describe("parseVersion", () => {
    it("Parses a release version", () => {
        expect(parseVersion("3.8.7")).toEqual({major: 3, minor: 8, patch: 7, prerelease: []});
    });

    it("Accepts a leading v and a build number", () => {
        expect(parseVersion("v3.8.7")).toEqual({major: 3, minor: 8, patch: 7, prerelease: []});
        expect(parseVersion("3.8.7+build.5")).toEqual({major: 3, minor: 8, patch: 7, prerelease: []});
    });

    it("Parses a prerelease suffix", () => {
        expect(parseVersion("3.8.7-alpha.2")?.prerelease).toEqual(["alpha", "2"]);
        expect(parseVersion("3.8.7-rc.1+build")?.prerelease).toEqual(["rc", "1"]);
    });

    it("Ignores leading and trailing whitespace", () => {
        expect(parseVersion("  3.8.7  ")).toEqual({major: 3, minor: 8, patch: 7, prerelease: []});
    });

    it("Returns undefined when unrecognisable", () => {
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

    it("Compares major, then minor, then patch", () => {
        expect(cmp("3.8.7", "3.8.7")).toBe(0);
        expect(cmp("4.0.0", "3.9.9")).toBe(1);
        expect(cmp("3.9.0", "3.8.9")).toBe(1);
        expect(cmp("3.8.6", "3.8.7")).toBe(-1);
    });

    it("A prerelease sorts below the release with the same numbers", () => {
        expect(cmp("3.8.7-alpha.2", "3.8.7")).toBe(-1);
        expect(cmp("3.8.7", "3.8.7-alpha.2")).toBe(1);
        expect(cmp("3.8.7-alpha.2", "3.8.7-alpha.2")).toBe(0);
    });

    it("Orders prereleases alpha < beta < rc", () => {
        expect(cmp("3.8.7-alpha.9", "3.8.7-beta.1")).toBe(-1);
        expect(cmp("3.8.7-beta.9", "3.8.7-rc.1")).toBe(-1);
        expect(cmp("3.8.7-rc.1", "3.8.7-rc.2")).toBe(-1);
        expect(cmp("3.8.7-rc.1", "3.8.7-alpha.1")).toBe(1);
    });

    it("Compares numbers inside a prerelease numerically, not as strings", () => {
        expect(cmp("3.8.7-alpha.2", "3.8.7-alpha.10")).toBe(-1);
        expect(cmp("3.8.7-alpha.10", "3.8.7-alpha.2")).toBe(1);
    });

    it("A numeric segment sorts below a non-numeric one", () => {
        expect(cmp("3.8.7-1", "3.8.7-alpha")).toBe(-1);
        expect(cmp("3.8.7-alpha", "3.8.7-1")).toBe(1);
    });

    it("Among prereleases with the same prefix, fewer segments sort lower", () => {
        expect(cmp("3.8.7-alpha", "3.8.7-alpha.1")).toBe(-1);
        expect(cmp("3.8.7-alpha.1", "3.8.7-alpha")).toBe(1);
    });
});

describe("hostVersion", () => {
    it("Reads window.siyuan.config.system.kernelVersion", () => {
        window.siyuan.config.system.kernelVersion = "3.9.3";
        expect(hostVersion()).toEqual({major: 3, minor: 9, patch: 3, prerelease: []});
    });

    it("Returns undefined when the value is missing or unrecognisable", () => {
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
    it("Always applies when no range is declared and never reads the host version", () => {
        window.siyuan.config.system = undefined as never;
        expect(supportsCurrentHost(definitionWith({}))).toBe(true);
    });

    it("Both bounds are inclusive", () => {
        window.siyuan.config.system.kernelVersion = "3.8.7";
        expect(supportsCurrentHost(definitionWith({minAppVersion: "3.8.7"}))).toBe(true);
        expect(supportsCurrentHost(definitionWith({maxAppVersion: "3.8.7"}))).toBe(true);
        expect(supportsCurrentHost(definitionWith({minAppVersion: "3.8.8"}))).toBe(false);
        expect(supportsCurrentHost(definitionWith({maxAppVersion: "3.8.6"}))).toBe(false);
    });

    it("Returns true inside the range", () => {
        window.siyuan.config.system.kernelVersion = "3.8.7";
        expect(supportsCurrentHost(definitionWith({minAppVersion: "3.8.0", maxAppVersion: "3.9.0"}))).toBe(true);
    });

    it("Compares a prerelease host against release bounds", () => {
        window.siyuan.config.system.kernelVersion = "3.8.10-alpha.1";
        expect(supportsCurrentHost(definitionWith({maxAppVersion: "3.8.10-alpha.1"}))).toBe(true);
        expect(supportsCurrentHost(definitionWith({maxAppVersion: "3.8.9"}))).toBe(false);
        window.siyuan.config.system.kernelVersion = "3.8.10-alpha.2";
        expect(supportsCurrentHost(definitionWith({maxAppVersion: "3.8.10-alpha.1"}))).toBe(false);
    });

    it("A single bound leaves the other side open", () => {
        window.siyuan.config.system.kernelVersion = "3.8.7";
        expect(supportsCurrentHost(definitionWith({minAppVersion: "3.0.0"}))).toBe(true);
        expect(supportsCurrentHost(definitionWith({maxAppVersion: "9.0.0"}))).toBe(true);
    });

    it("Treats an unreadable host version as unbounded and warns only once", async () => {
        const fresh = await freshVersion();
        window.siyuan.config.system = undefined as never;
        expect(fresh.supportsCurrentHost(definitionWith({minAppVersion: "9.9.9"}))).toBe(true);
        expect(fresh.supportsCurrentHost(definitionWith({minAppVersion: "9.9.9"}))).toBe(true);
        expect(vi.mocked(console.warn)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(console.warn).mock.calls[0][0]).toContain('cannot tell whether "demo" fits this host');
    });

    it("Ignores an unreadable lower bound and warns only once", async () => {
        const fresh = await freshVersion();
        window.siyuan.config.system.kernelVersion = "3.8.7";
        expect(fresh.supportsCurrentHost(definitionWith({minAppVersion: "newest"}))).toBe(true);
        expect(fresh.supportsCurrentHost(definitionWith({minAppVersion: "newest"}))).toBe(true);
        expect(vi.mocked(console.warn)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(console.warn).mock.calls[0][0]).toContain("unreadable minAppVersion");
    });

    it("Ignores an unreadable upper bound and warns only once", async () => {
        const fresh = await freshVersion();
        window.siyuan.config.system.kernelVersion = "3.8.7";
        expect(fresh.supportsCurrentHost(definitionWith({maxAppVersion: "3.8.x"}))).toBe(true);
        expect(fresh.supportsCurrentHost(definitionWith({maxAppVersion: "3.8.x"}))).toBe(true);
        expect(vi.mocked(console.warn)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(console.warn).mock.calls[0][0]).toContain("unreadable maxAppVersion");
    });
});

describe("The warn-once table is isolated per feature", () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        vi.resetModules();
    });

    it("Two features warn once each without interfering", async () => {
        const fresh = await freshVersion();
        window.siyuan.config.system = undefined as never;
        fresh.supportsCurrentHost({...definitionWith({minAppVersion: "9.9.9"}), id: "alpha"});
        fresh.supportsCurrentHost({...definitionWith({minAppVersion: "9.9.9"}), id: "beta"});
        fresh.supportsCurrentHost({...definitionWith({minAppVersion: "9.9.9"}), id: "alpha"});
        expect(vi.mocked(console.warn)).toHaveBeenCalledTimes(2);
    });
});
