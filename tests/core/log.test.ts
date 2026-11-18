// @vitest-environment node
/**
 * `core/log.ts`：分级日志。
 *
 * 三件事必须守住：默认安静、打开后一行一条且头部固定、级别分别走 console 的三个方法。
 */
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import {
    createLogger,
    isDetailedLogging,
    logError,
    logInfo,
    logLoaded,
    logTag,
    logWarn,
    setDetailedLogging,
} from "../../src/core/log";

const TAG = "[some-settings-siyuan__";

afterEach(() => {
    setDetailedLogging(false);
});

describe("master switch", () => {
    it("is off by default", () => {
        expect(isDetailedLogging()).toBe(false);
    });

    it("writes no level while off", () => {
        const log = createLogger("demo");
        log.info("info");
        log.warn("warn");
        log.error("error");
        expect(vi.mocked(console.log)).not.toHaveBeenCalled();
        expect(vi.mocked(console.warn)).not.toHaveBeenCalled();
        expect(vi.mocked(console.error)).not.toHaveBeenCalled();
    });

    it("still writes the load notice while off", () => {
        logLoaded("loaded");
        expect(vi.mocked(console.log)).toHaveBeenCalledWith(`${TAG}core] loaded`);
    });
});

describe("format", () => {
    it("has the header [some-settings-siyuan__<scope>]", () => {
        expect(logTag("modal-blur")).toBe(`${TAG}modal-blur]`);
    });

    it("goes through console.log / warn / error with a level marker", () => {
        setDetailedLogging(true);
        logInfo("core", "started");
        logWarn("core", "careful");
        logError("core", "broken");
        expect(vi.mocked(console.log)).toHaveBeenCalledWith(`${TAG}core] INFO started`);
        expect(vi.mocked(console.warn)).toHaveBeenCalledWith(`${TAG}core] WARN careful`);
        expect(vi.mocked(console.error)).toHaveBeenCalledWith(`${TAG}core] ERROR broken`);
    });

    it("produces a single line per call and joins arguments as readable text", () => {
        setDetailedLogging(true);
        createLogger("demo").info("loaded", {enabled: true}, new Error("boom"), 3);
        expect(vi.mocked(console.log)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(console.log)).toHaveBeenCalledWith(
            `${TAG}demo] INFO loaded {"enabled":true} Error: boom 3`,
        );
    });

    it("leaves no trailing space without arguments", () => {
        setDetailedLogging(true);
        createLogger("demo").info();
        expect(vi.mocked(console.log)).toHaveBeenCalledWith(`${TAG}demo] INFO`);
    });

    it("never throws on a circular reference", () => {
        setDetailedLogging(true);
        const value: Record<string, unknown> = {};
        value.self = value;
        expect(() => createLogger("demo").info(value)).not.toThrow();
        expect(vi.mocked(console.log)).toHaveBeenCalledTimes(1);
    });
});

describe("logger", () => {
    it("createLogger binds its own scope", () => {
        setDetailedLogging(true);
        const log = createLogger("demo");
        expect(log.scope).toBe("demo");
        log.info("hello");
        expect(vi.mocked(console.log)).toHaveBeenCalledWith(`${TAG}demo] INFO hello`);
    });
});
