/**
 * `core/link.ts`：打开外链。
 *
 * 顺序必须是「先问插件、没人拦才交给浏览器」：本插件自己的「外链跳转前确认」
 * 正是靠 `open-link` 事件拦下跳转的，先 open 再问就拦不住了。
 */
import {
    describe,
    expect,
    it,
    vi,
} from "vitest";
import {openExternalLink} from "../../src/core/link";

const pluginWith = (emit: () => boolean | void): unknown => ({eventBus: {emit}});

describe("openExternalLink", () => {
    it("emits open-link first and opens only when nothing cancels", () => {
        const emit = vi.fn(() => undefined);
        window.siyuan.ws.app.plugins = [pluginWith(emit)] as never;
        openExternalLink("https://example.com");

        expect(emit).toHaveBeenCalledWith("open-link", expect.objectContaining({href: "https://example.com"}));
        expect(window.open).toHaveBeenCalledWith("https://example.com", "_blank");
    });

    it("does not open when any plugin cancels", () => {
        window.siyuan.ws.app.plugins = [pluginWith(() => false)] as never;
        openExternalLink("https://example.com");
        expect(window.open).not.toHaveBeenCalled();
    });

    it("passes the triggering event to plugins", () => {
        const emit = vi.fn(() => undefined);
        window.siyuan.ws.app.plugins = [pluginWith(emit)] as never;
        const event = new MouseEvent("click");
        openExternalLink("https://example.com", event);
        expect(emit).toHaveBeenCalledWith("open-link", expect.objectContaining({event}));
    });

    it("does not propagate window.open errors to the caller", () => {
        window.siyuan.ws.app.plugins = [] as never;
        const original = window.open;
        window.open = (() => {
            throw new Error("blocked by the host");
        }) as unknown as typeof window.open;
        try {
            expect(() => openExternalLink("https://example.com")).not.toThrow();
        } finally {
            window.open = original;
        }
    });
});
