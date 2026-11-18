/**
 * 页签标题渲染行级 Markdown。
 *
 * 与文档树标题共用同一个渲染器，所以这里不重复穷举语法，只守这条功能自己的三件事：
 *
 * 1. **三处文字层各自由 scope 决定**（桌面页签条、桌面页签下拉列表、移动端页签概览），
 *    切换 scope 时要先把上一次渲染过的地方还原；
 * 2. **宿主用同一份原文重写 `innerHTML` 之后必须重新渲染** —— 内核打开文档时会再写一次
 *    `Tab.updateTitle`，它把我们的节点整片冲掉而 `textContent` 一字未变，只比原文就会
 *    永远停在纯文本上（docs/development.md 里专门记了这条）；
 * 3. 选择器要带足限定：思源里 `.layout-tab-bar + .item__text` 的地方不止页签条一处。
 */
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import {
    INLINE_MARKDOWN_CSS,
    MARK_ATTR,
} from "../../src/core/inline-markdown";
import definition from "../../src/features/tab-title-markdown";
import {mountFeature} from "../helpers/feature-host";
import type {HostHarness} from "../helpers/feature-host";

/** 与文档树那份测试同一个思路：rAF 由测试驱动，避免断言依赖真实帧间隔。 */
const stubFrames = () => {
    const pending = new Map<number, FrameRequestCallback>();
    let nextId = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback): number => {
        nextId += 1;
        pending.set(nextId, callback);
        return nextId;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((handle: number): void => {
        pending.delete(handle);
    });
    return {
        pendingCount: () => pending.size,
        flush: async (): Promise<void> => {
            const callbacks = [...pending.values()];
            pending.clear();
            callbacks.forEach((callback) => callback(0));
            await Promise.resolve();
        },
    };
};

const settle = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
};

/** 桌面端页签条：`ul.layout-tab-bar > li.item[data-type="tab-header"] > .item__text`。 */
const createBar = (): HTMLElement => {
    const bar = document.createElement("ul");
    bar.className = "layout-tab-bar";
    document.body.append(bar);
    return bar;
};

const addDesktopTab = (bar: HTMLElement, text: string): HTMLElement => {
    const li = document.createElement("li");
    li.className = "item";
    li.dataset.type = "tab-header";
    const title = document.createElement("div");
    title.className = "item__text";
    title.textContent = text;
    li.append(title);
    bar.append(li);
    return title;
};

/** 桌面端页签下拉列表：文字在菜单构建时从页签条抄过来，所以是独立一处。 */
const createTabList = (): HTMLElement => {
    const menu = document.createElement("div");
    menu.className = "b3-menu";
    menu.dataset.name = "tabList";
    document.body.append(menu);
    return menu;
};

const addTabListItem = (menu: HTMLElement, text: string): HTMLElement => {
    const label = document.createElement("div");
    label.className = "b3-menu__label";
    label.textContent = text;
    menu.append(label);
    return label;
};

/** 移动端页签概览（底部抽屉）。 */
const createMobileTabs = (): HTMLElement => {
    const tabs = document.createElement("div");
    tabs.className = "mobile-tabs";
    document.body.append(tabs);
    return tabs;
};

const addMobileItem = (tabs: HTMLElement, text: string): HTMLElement => {
    const item = document.createElement("div");
    item.className = "mobile-tabs__item";
    const title = document.createElement("div");
    title.className = "mobile-tabs__item-title";
    title.textContent = text;
    item.append(title);
    tabs.append(item);
    return title;
};

describe("tab title renders inline Markdown", () => {
    const mounted: HostHarness[] = [];
    let frames: ReturnType<typeof stubFrames>;

    const mount = (config: Record<string, unknown> = {scope: "desktop"}): HostHarness => {
        frames = stubFrames();
        const harness = mountFeature(definition, {config});
        mounted.push(harness);
        return harness;
    };

    afterEach(() => {
        mounted.splice(0).forEach((harness) => harness.dispose());
    });

    it("declaration: the scope option is the switch, disabled by default, version cap matches the doc-tree one", () => {
        expect(definition.id).toBe("tab-title-markdown");
        expect(definition.category).toBe("doc-tree");
        expect(definition.enabled).toBe(true);
        expect(definition.maxAppVersion).toBe("3.8.10-alpha.1");
        expect(definition.isEnabled?.({scope: "disabled"})).toBe(false);
        for (const scope of ["desktop", "mobile", "both"]) {
            expect(definition.isEnabled?.({scope})).toBe(true);
        }
        // 缺省值（老配置里没有这个 key）不能被当成「关」
        expect(definition.isEnabled?.({})).toBe(true);
        expect(definition.settings[0]).toMatchObject({kind: "select", key: "scope", default: "disabled"});
    });

    it("leaves all three text layers alone when disabled by default", () => {
        const bar = createBar();
        const desktop = addDesktopTab(bar, "**bold**");
        const menu = createTabList();
        const label = addTabListItem(menu, "**bold**");
        const tabs = createMobileTabs();
        const mobile = addMobileItem(tabs, "**bold**");

        const harness = mount({});

        expect(harness.records.styles[0]).toBe(INLINE_MARKDOWN_CSS);
        expect(desktop.querySelector(`[${MARK_ATTR}]`)).toBeNull();
        expect(label.querySelector(`[${MARK_ATTR}]`)).toBeNull();
        expect(mobile.querySelector(`[${MARK_ATTR}]`)).toBeNull();
    });

    it("scope=desktop renders only the tab bar and the tab dropdown list", () => {
        const bar = createBar();
        const desktop = addDesktopTab(bar, "**bold**");
        const menu = createTabList();
        const label = addTabListItem(menu, "==highlight==");
        const tabs = createMobileTabs();
        const mobile = addMobileItem(tabs, "**bold**");

        mount({scope: "desktop"});

        expect(desktop.querySelector(`[${MARK_ATTR}="strong"]`)?.textContent).toBe("bold");
        expect(label.querySelector(`[${MARK_ATTR}="mark"]`)?.textContent).toBe("highlight");
        expect(mobile.querySelector(`[${MARK_ATTR}]`)).toBeNull();
        // textContent 仍是原文：document.title、拖拽载荷都从这里取
        expect(desktop.textContent).toBe("**bold**");
        expect(label.textContent).toBe("==highlight==");
    });

    it("scope=mobile renders only the mobile tab overview", () => {
        const bar = createBar();
        const desktop = addDesktopTab(bar, "**bold**");
        const tabs = createMobileTabs();
        const mobile = addMobileItem(tabs, "^superscript^");

        mount({scope: "mobile"});

        expect(mobile.querySelector(`[${MARK_ATTR}="sup"]`)?.textContent).toBe("superscript");
        expect(desktop.querySelector(`[${MARK_ATTR}]`)).toBeNull();
    });

    it("scope=both renders all three places", () => {
        const bar = createBar();
        const desktop = addDesktopTab(bar, "*italic*");
        const menu = createTabList();
        const label = addTabListItem(menu, "*italic*");
        const tabs = createMobileTabs();
        const mobile = addMobileItem(tabs, "*italic*");

        mount({scope: "both"});

        for (const element of [desktop, label, mobile]) {
            expect(element.querySelector(`[${MARK_ATTR}="em"]`)?.textContent).toBe("italic");
        }
    });

    it("an invalid scope value is treated as disabled and never falls back to rendering anywhere", () => {
        const bar = createBar();
        const desktop = addDesktopTab(bar, "**bold**");

        mount({scope: "weird"});

        expect(desktop.querySelector(`[${MARK_ATTR}]`)).toBeNull();
    });

    it("a tab title without syntax characters is left untouched", () => {
        const bar = createBar();
        const desktop = addDesktopTab(bar, "Plain note");
        mount({scope: "desktop"});

        expect(desktop.childNodes).toHaveLength(1);
        expect(desktop.textContent).toBe("Plain note");
    });

    it("the host-projected rich title is skipped entirely", () => {
        const bar = createBar();
        const li = document.createElement("li");
        li.className = "item";
        li.dataset.type = "tab-header";
        const title = document.createElement("div");
        title.className = "item__text document-title-preview b3-typography";
        title.innerHTML = 'a_b<span data-type="code">1*2</span>';
        li.append(title);
        bar.append(li);

        mount({scope: "desktop"});

        expect(title.querySelector(`[${MARK_ATTR}]`)).toBeNull();
        expect(title.innerHTML).toBe('a_b<span data-type="code">1*2</span>');
    });

    it("small tabs with the same class in settings / data history / bazaar are unaffected", () => {
        const bar = createBar();
        const desktop = addDesktopTab(bar, "**bold**");
        // 结构不同（缺 data-type），不是页签条
        const otherLi = document.createElement("li");
        otherLi.className = "item";
        const otherTitle = document.createElement("div");
        otherTitle.className = "item__text";
        otherTitle.textContent = "**bold**";
        otherLi.append(otherTitle);
        bar.append(otherLi);
        // 连容器都不是 ul.layout-tab-bar
        const fakeBar = document.createElement("div");
        fakeBar.className = "layout-tab-bar";
        fakeBar.innerHTML = '<div class="item__text">**bold**</div>';
        document.body.append(fakeBar);

        mount({scope: "desktop"});

        expect(desktop.querySelector(`[${MARK_ATTR}]`)).not.toBeNull();
        expect(otherTitle.querySelector(`[${MARK_ATTR}]`)).toBeNull();
        expect(fakeBar.querySelector(`[${MARK_ATTR}]`)).toBeNull();
    });

    it("must re-render after the host rewrites innerHTML with the same source text", async () => {
        const bar = createBar();
        const title = addDesktopTab(bar, "**bold**");
        mount({scope: "desktop"});
        expect(title.querySelector(`[${MARK_ATTR}="strong"]`)).not.toBeNull();

        // 内核打开文档时再写一次 Tab.updateTitle：节点被整片冲掉，原文没变
        title.innerHTML = "**bold**";
        await settle();
        await frames.flush();

        expect(title.querySelector(`[${MARK_ATTR}="strong"]`)?.textContent).toBe("bold");
        expect(title.textContent).toBe("**bold**");
    });

    it("does not wrap twice while both the source text and the marks remain", async () => {
        const bar = createBar();
        const title = addDesktopTab(bar, "**bold**");
        mount({scope: "desktop"});
        const before = title.innerHTML;
        const markCount = title.querySelectorAll(`[${MARK_ATTR}]`).length;

        // 页签条里多一个页签 → 重扫
        addDesktopTab(bar, "another one");
        await settle();
        await frames.flush();

        expect(title.innerHTML).toBe(before);
        expect(title.querySelectorAll(`[${MARK_ATTR}]`).length).toBe(markCount);
    });

    it("switching scope: the old position reverts to plain text and the new one starts rendering", async () => {
        const bar = createBar();
        const desktop = addDesktopTab(bar, "**bold**");
        const tabs = createMobileTabs();
        const mobile = addMobileItem(tabs, "**bold**");

        const harness = mount({scope: "desktop"});
        expect(desktop.querySelector(`[${MARK_ATTR}="strong"]`)).not.toBeNull();

        harness.config.scope = "mobile";
        harness.notifyConfigChange();
        await settle();
        await frames.flush();

        expect(desktop.textContent).toBe("**bold**");
        expect(desktop.querySelector(`[${MARK_ATTR}]`)).toBeNull();
        expect(mobile.querySelector(`[${MARK_ATTR}="strong"]`)?.textContent).toBe("bold");
    });

    it("re-renders when switching back to the original scope (reverting also clears the rendered record)", async () => {
        const bar = createBar();
        const desktop = addDesktopTab(bar, "**bold**");
        const tabs = createMobileTabs();
        addMobileItem(tabs, "**bold**");

        const harness = mount({scope: "desktop"});

        harness.config.scope = "mobile";
        harness.notifyConfigChange();
        await settle();
        await frames.flush();
        expect(desktop.querySelector(`[${MARK_ATTR}]`)).toBeNull();

        harness.config.scope = "desktop";
        harness.notifyConfigChange();
        await settle();
        await frames.flush();

        expect(desktop.querySelector(`[${MARK_ATTR}="strong"]`)?.textContent).toBe("bold");
    });

    it("unrelated mutations do not trigger a scan", async () => {
        createBar();
        mount({scope: "desktop"});
        expect(frames.pendingCount()).toBe(0);

        const editor = document.createElement("div");
        editor.className = "protyle-wysiwyg";
        editor.innerHTML = "<div>**body**</div>";
        document.body.append(editor);
        await settle();

        expect(frames.pendingCount()).toBe(0);
    });

    it("unmount reverts all three places to plain text and removes the style", () => {
        const bar = createBar();
        const desktop = addDesktopTab(bar, "**bold**");
        const menu = createTabList();
        const label = addTabListItem(menu, "**bold**");
        const tabs = createMobileTabs();
        const mobile = addMobileItem(tabs, "**bold**");

        const harness = mount({scope: "both"});

        harness.dispose();

        for (const element of [desktop, label, mobile]) {
            expect(element.textContent).toBe("**bold**");
            expect(element.querySelector(`[${MARK_ATTR}]`)).toBeNull();
        }
        expect(harness.styleElement()).toBeNull();
    });

    it("unmount cancels queued frames and later mutations no longer render", async () => {
        const bar = createBar();
        const harness = mount({scope: "desktop"});

        addDesktopTab(bar, "**bold**");
        await settle();
        expect(frames.pendingCount()).toBe(1);

        harness.dispose();
        expect(frames.pendingCount()).toBe(0);

        const later = addDesktopTab(bar, "*italic*");
        await settle();
        await frames.flush();

        expect(later.querySelector(`[${MARK_ATTR}]`)).toBeNull();
    });

    it("destroy is idempotent: calling it twice does not throw", () => {
        createBar();
        const harness = mount({scope: "desktop"});

        expect(() => {
            harness.instance?.destroy?.();
            harness.instance?.destroy?.();
        }).not.toThrow();
    });
});
