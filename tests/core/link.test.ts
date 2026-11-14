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
    it("先发 open-link 事件，没人取消才打开", () => {
        const emit = vi.fn(() => undefined);
        window.siyuan.ws.app.plugins = [pluginWith(emit)] as never;
        openExternalLink("https://example.com");

        expect(emit).toHaveBeenCalledWith("open-link", expect.objectContaining({href: "https://example.com"}));
        expect(window.open).toHaveBeenCalledWith("https://example.com", "_blank");
    });

    it("任一插件取消时不打开", () => {
        window.siyuan.ws.app.plugins = [pluginWith(() => false)] as never;
        openExternalLink("https://example.com");
        expect(window.open).not.toHaveBeenCalled();
    });

    it("把触发事件一并交给插件", () => {
        const emit = vi.fn(() => undefined);
        window.siyuan.ws.app.plugins = [pluginWith(emit)] as never;
        const event = new MouseEvent("click");
        openExternalLink("https://example.com", event);
        expect(emit).toHaveBeenCalledWith("open-link", expect.objectContaining({event}));
    });

    it("window.open 抛错时不冒泡到调用方", () => {
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
