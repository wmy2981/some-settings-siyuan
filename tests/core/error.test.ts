// @vitest-environment node
/**
 * `core/error.ts`：错误隔离与上报。
 *
 * 这里的约定是「任何功能的异常都不许冒泡」，所以每个入口都要同时验证
 * 「异常被吞掉」与「用户/控制台确实看得见」两件事。
 *
 * 记录走 `core/log.ts` 的分级日志：头部是 `[some-settings-siyuan__<作用域>]`，
 * 详细日志关着时控制台安静，但给用户的提示照旧弹出。
 */
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import {
    guard,
    guardAsync,
    guardSilent,
    reportError,
} from "../../src/core/error";
import {setDetailedLogging} from "../../src/core/log";
import {mockState} from "../mocks/siyuan";

const TAG = "[some-settings-siyuan__";
/** 用户提示仍然带上插件名，方便在思源的提示条里认出是谁发的。 */
const PREFIX = "[some-settings-siyuan]";

beforeEach(() => {
    setDetailedLogging(true);
});

afterEach(() => {
    setDetailedLogging(false);
});

describe("reportError", () => {
    it("记录到控制台并提示用户", () => {
        const error = new Error("boom");
        reportError("feature.mount", error);
        expect(vi.mocked(console.error)).toHaveBeenCalledWith(
            expect.stringContaining(`${TAG}feature.mount] ERROR Error: boom`),
        );
        expect(mockState.messages).toEqual([
            {text: `${PREFIX} [feature.mount] boom`, timeout: 6000, type: "error"},
        ]);
    });

    it("非 Error 的值按字符串上报", () => {
        reportError("feature.mount", "plain text");
        expect(vi.mocked(console.error)).toHaveBeenCalledWith(`${TAG}feature.mount] ERROR plain text`);
        expect(mockState.messages[0].text).toBe(`${PREFIX} [feature.mount] plain text`);
    });

    it("通知失败时不再抛错", () => {
        mockState.showMessageError = new Error("no toast");
        expect(() => reportError("feature.mount", new Error("boom"))).not.toThrow();
        expect(vi.mocked(console.error)).toHaveBeenCalled();
    });

    it("notifyUser 为 false 时只记日志", () => {
        reportError("onunload", new Error("boom"), false);
        expect(vi.mocked(console.error)).toHaveBeenCalled();
        expect(mockState.messages).toHaveLength(0);
    });

    it("详细日志关着时控制台留白，但提示仍然弹出", () => {
        setDetailedLogging(false);
        reportError("feature.mount", new Error("boom"));
        expect(vi.mocked(console.error)).not.toHaveBeenCalled();
        expect(mockState.messages[0].text).toContain("boom");
    });
});

describe("guard", () => {
    it("成功返回 true", () => {
        expect(guard("scope", () => undefined)).toBe(true);
        expect(mockState.messages).toHaveLength(0);
    });

    it("异常被隔离，返回 false 并上报", () => {
        expect(guard("scope", () => {
            throw new Error("bad");
        })).toBe(false);
        expect(vi.mocked(console.error)).toHaveBeenCalledWith(
            expect.stringContaining(`${TAG}scope] ERROR Error: bad`),
        );
        expect(mockState.messages).toHaveLength(1);
    });

    it("notifyUser 为 false 时不提示", () => {
        expect(guard("scope", () => {
            throw new Error("bad");
        }, false)).toBe(false);
        expect(mockState.messages).toHaveLength(0);
    });
});

describe("guardAsync", () => {
    it("成功后不产生任何上报", async () => {
        const action = vi.fn(async () => undefined);
        await guardAsync("scope", action);
        expect(action).toHaveBeenCalledTimes(1);
        expect(vi.mocked(console.error)).not.toHaveBeenCalled();
    });

    it("异步异常被吞掉并上报", async () => {
        await expect(guardAsync("scope", async () => {
            throw new Error("rejected");
        })).resolves.toBeUndefined();
        expect(vi.mocked(console.error)).toHaveBeenCalledWith(
            expect.stringContaining(`${TAG}scope] ERROR Error: rejected`),
        );
        expect(mockState.messages[0].text).toContain("rejected");
    });

    it("notifyUser 为 false 时只记日志", async () => {
        await guardAsync("scope", async () => {
            throw new Error("rejected");
        }, false);
        expect(mockState.messages).toHaveLength(0);
    });
});

describe("guardSilent", () => {
    it("成功时不留下任何记录", () => {
        guardSilent("scope", () => undefined);
        expect(vi.mocked(console.error)).not.toHaveBeenCalled();
    });

    it("失败时只记日志，既不提示也不抛错", () => {
        expect(() =>
            guardSilent("scope", () => {
                throw new Error("cleanup failed");
            })
        ).not.toThrow();
        expect(vi.mocked(console.error)).toHaveBeenCalledWith(
            expect.stringContaining(`${TAG}scope] ERROR cleanup failed Error: cleanup failed`),
        );
        expect(mockState.messages).toHaveLength(0);
    });
});
