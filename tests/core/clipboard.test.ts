/**
 * `core/clipboard.ts`：复制纯文本。
 *
 * 顺序必须是「原生桥 → Clipboard API → textarea 兜底」，因为移动端 WebView
 * 既没有剪贴板写权限，也可能整个 `navigator.clipboard` 都不存在。
 */
import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import {copyText} from "../../src/core/clipboard";

interface TestHost {
    JSAndroid?: {writeClipboard: (text: string) => void;};
    JSHarmony?: {writeClipboard: (text: string) => unknown;};
    webkit?: {messageHandlers: {setClipboard: {postMessage: (text: string) => void;};};};
}

const host = (): TestHost => window as unknown as TestHost;

const setContainer = (container: string): void => {
    window.siyuan.config.system.container = container;
};

const setClipboard = (clipboard: unknown): void => {
    Object.defineProperty(navigator, "clipboard", {value: clipboard, configurable: true, writable: true});
};

const setExecCommand = (result: boolean | (() => boolean)): ReturnType<typeof vi.fn> => {
    const impl = typeof result === "function" ? result : () => result;
    const spy = vi.fn(impl);
    (document as unknown as {execCommand: unknown;}).execCommand = spy;
    return spy;
};

beforeEach(() => {
    setContainer("");
    setClipboard(undefined);
    delete host().JSAndroid;
    delete host().JSHarmony;
    delete host().webkit;
    setExecCommand(true);
});

describe("copyText", () => {
    it("returns false right away for empty text without trying anything", async () => {
        const writeText = vi.fn(async () => undefined);
        setClipboard({writeText});
        await expect(copyText("")).resolves.toBe(false);
        expect(writeText).not.toHaveBeenCalled();
    });

    it("uses the native bridge injected by the Android app", async () => {
        setContainer("android");
        const bridge = vi.fn();
        host().JSAndroid = {writeClipboard: bridge};
        const writeText = vi.fn(async () => undefined);
        setClipboard({writeText});

        await expect(copyText("text")).resolves.toBe(true);
        expect(bridge).toHaveBeenCalledWith("text");
        expect(writeText).not.toHaveBeenCalled();
    });

    it("uses messageHandlers on the iOS container", async () => {
        setContainer("ios");
        const postMessage = vi.fn();
        host().webkit = {messageHandlers: {setClipboard: {postMessage}}};

        await expect(copyText("text")).resolves.toBe(true);
        expect(postMessage).toHaveBeenCalledWith("text");
    });

    it("reads a false from the HarmonyOS bridge as nothing written", async () => {
        setContainer("harmony");
        host().JSHarmony = {writeClipboard: () => false};
        await expect(copyText("text")).resolves.toBe(false);
    });

    it("treats any other HarmonyOS bridge value as success", async () => {
        setContainer("harmony");
        host().JSHarmony = {writeClipboard: () => undefined};
        await expect(copyText("text")).resolves.toBe(true);
    });

    it("skips the native bridge on a container mismatch and falls through", async () => {
        setContainer("desktop");
        const bridge = vi.fn();
        host().JSAndroid = {writeClipboard: bridge};
        const writeText = vi.fn(async () => undefined);
        setClipboard({writeText});

        await expect(copyText("text")).resolves.toBe(true);
        expect(bridge).not.toHaveBeenCalled();
        expect(writeText).toHaveBeenCalledWith("text");
    });

    it("falls through on Android when the bridge is missing", async () => {
        setContainer("android");
        const writeText = vi.fn(async () => undefined);
        setClipboard({writeText});

        await expect(copyText("text")).resolves.toBe(true);
        expect(writeText).toHaveBeenCalledWith("text");
    });

    it("falls back to textarea + execCommand when the Clipboard API is rejected", async () => {
        setClipboard({
            writeText: vi.fn(async () => {
                throw new Error("denied");
            }),
        });
        const execCommand = setExecCommand(true);

        await expect(copyText("text")).resolves.toBe(true);
        expect(execCommand).toHaveBeenCalledWith("copy");
        // 兜底用的 textarea 必须收掉，不能留在页面里
        expect(document.querySelector("textarea")).toBeNull();
    });

    it("uses the same fallback when the Clipboard API is missing", async () => {
        const execCommand = setExecCommand(true);
        await expect(copyText("text")).resolves.toBe(true);
        expect(execCommand).toHaveBeenCalledWith("copy");
    });

    it("treats a missing window.siyuan as having no native bridge", async () => {
        (window as unknown as {siyuan?: unknown;}).siyuan = undefined;
        const execCommand = setExecCommand(true);
        await expect(copyText("text")).resolves.toBe(true);
        expect(execCommand).toHaveBeenCalledWith("copy");
    });

    it("reports failure honestly when execCommand returns false", async () => {
        setExecCommand(false);
        await expect(copyText("text")).resolves.toBe(false);
    });

    it("treats a throwing execCommand as failure and never rethrows to the caller", async () => {
        setExecCommand(() => {
            throw new Error("blocked");
        });
        await expect(copyText("text")).resolves.toBe(false);
    });

    it("makes the fallback textarea invisible, readonly and selected, holding the right text", async () => {
        setExecCommand(() => {
            const area = document.querySelector("textarea") as HTMLTextAreaElement;
            expect(area.value).toBe("line one\nline two");
            expect(area.getAttribute("readonly")).toBe("true");
            expect(area.style.opacity).toBe("0");
            expect(area.style.position).toBe("fixed");
            expect(area.selectionStart).toBe(0);
            expect(area.selectionEnd).toBe("line one\nline two".length);
            return true;
        });
        await expect(copyText("line one\nline two")).resolves.toBe(true);
    });
});
