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

describe("总开关", () => {
    it("默认关闭", () => {
        expect(isDetailedLogging()).toBe(false);
    });

    it("关闭时所有级别都不输出", () => {
        const log = createLogger("demo");
        log.info("info");
        log.warn("warn");
        log.error("error");
        expect(vi.mocked(console.log)).not.toHaveBeenCalled();
        expect(vi.mocked(console.warn)).not.toHaveBeenCalled();
        expect(vi.mocked(console.error)).not.toHaveBeenCalled();
    });

    it("关闭时加载提示仍然输出", () => {
        logLoaded("已加载");
        expect(vi.mocked(console.log)).toHaveBeenCalledWith(`${TAG}core] 已加载`);
    });
});

describe("格式", () => {
    it("头部是 [some-settings-siyuan__<scope>]", () => {
        expect(logTag("modal-blur")).toBe(`${TAG}modal-blur]`);
    });

    it("分别走 console.log / warn / error，并带级别", () => {
        setDetailedLogging(true);
        logInfo("core", "started");
        logWarn("core", "careful");
        logError("core", "broken");
        expect(vi.mocked(console.log)).toHaveBeenCalledWith(`${TAG}core] INFO started`);
        expect(vi.mocked(console.warn)).toHaveBeenCalledWith(`${TAG}core] WARN careful`);
        expect(vi.mocked(console.error)).toHaveBeenCalledWith(`${TAG}core] ERROR broken`);
    });

    it("一次调用只产出一行，参数按可读文本拼接", () => {
        setDetailedLogging(true);
        createLogger("demo").info("loaded", {enabled: true}, new Error("boom"), 3);
        expect(vi.mocked(console.log)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(console.log)).toHaveBeenCalledWith(
            `${TAG}demo] INFO loaded {"enabled":true} Error: boom 3`,
        );
    });

    it("没有参数时不留尾随空格", () => {
        setDetailedLogging(true);
        createLogger("demo").info();
        expect(vi.mocked(console.log)).toHaveBeenCalledWith(`${TAG}demo] INFO`);
    });

    it("循环引用不会让日志抛错", () => {
        setDetailedLogging(true);
        const value: Record<string, unknown> = {};
        value.self = value;
        expect(() => createLogger("demo").info(value)).not.toThrow();
        expect(vi.mocked(console.log)).toHaveBeenCalledTimes(1);
    });
});

describe("日志器", () => {
    it("createLogger 绑定自己的 scope", () => {
        setDetailedLogging(true);
        const log = createLogger("demo");
        expect(log.scope).toBe("demo");
        log.info("hello");
        expect(vi.mocked(console.log)).toHaveBeenCalledWith(`${TAG}demo] INFO hello`);
    });
});
