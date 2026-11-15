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

describe("页签标题渲染行级 Markdown", () => {
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

    it("声明：用 scope 选项当开关，默认「禁用」，版本上限与文档树那份一致", () => {
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

    it("默认（禁用）时三处文字层都不碰", () => {
        const bar = createBar();
        const desktop = addDesktopTab(bar, "**粗体**");
        const menu = createTabList();
        const label = addTabListItem(menu, "**粗体**");
        const tabs = createMobileTabs();
        const mobile = addMobileItem(tabs, "**粗体**");

        const harness = mount({});

        expect(harness.records.styles[0]).toBe(INLINE_MARKDOWN_CSS);
        expect(desktop.querySelector(`[${MARK_ATTR}]`)).toBeNull();
        expect(label.querySelector(`[${MARK_ATTR}]`)).toBeNull();
        expect(mobile.querySelector(`[${MARK_ATTR}]`)).toBeNull();
    });

    it("scope=desktop 只渲染页签条与页签下拉列表", () => {
        const bar = createBar();
        const desktop = addDesktopTab(bar, "**粗体**");
        const menu = createTabList();
        const label = addTabListItem(menu, "==高亮==");
        const tabs = createMobileTabs();
        const mobile = addMobileItem(tabs, "**粗体**");

        mount({scope: "desktop"});

        expect(desktop.querySelector(`[${MARK_ATTR}="strong"]`)?.textContent).toBe("粗体");
        expect(label.querySelector(`[${MARK_ATTR}="mark"]`)?.textContent).toBe("高亮");
        expect(mobile.querySelector(`[${MARK_ATTR}]`)).toBeNull();
        // textContent 仍是原文：document.title、拖拽载荷都从这里取
        expect(desktop.textContent).toBe("**粗体**");
        expect(label.textContent).toBe("==高亮==");
    });

    it("scope=mobile 只渲染移动端页签概览", () => {
        const bar = createBar();
        const desktop = addDesktopTab(bar, "**粗体**");
        const tabs = createMobileTabs();
        const mobile = addMobileItem(tabs, "^上标^");

        mount({scope: "mobile"});

        expect(mobile.querySelector(`[${MARK_ATTR}="sup"]`)?.textContent).toBe("上标");
        expect(desktop.querySelector(`[${MARK_ATTR}]`)).toBeNull();
    });

    it("scope=both 三处都渲染", () => {
        const bar = createBar();
        const desktop = addDesktopTab(bar, "*斜体*");
        const menu = createTabList();
        const label = addTabListItem(menu, "*斜体*");
        const tabs = createMobileTabs();
        const mobile = addMobileItem(tabs, "*斜体*");

        mount({scope: "both"});

        for (const element of [desktop, label, mobile]) {
            expect(element.querySelector(`[${MARK_ATTR}="em"]`)?.textContent).toBe("斜体");
        }
    });

    it("非法 scope 值按「禁用」处理，不会退化成随便渲染", () => {
        const bar = createBar();
        const desktop = addDesktopTab(bar, "**粗体**");

        mount({scope: "weird"});

        expect(desktop.querySelector(`[${MARK_ATTR}]`)).toBeNull();
    });

    it("没有语法字符的页签标题不动", () => {
        const bar = createBar();
        const desktop = addDesktopTab(bar, "普通笔记");
        mount({scope: "desktop"});

        expect(desktop.childNodes).toHaveLength(1);
        expect(desktop.textContent).toBe("普通笔记");
    });

    it("宿主投影的富标题整块跳过", () => {
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

    it("设置 / 数据历史 / 集市里同样类名的小页签不受影响", () => {
        const bar = createBar();
        const desktop = addDesktopTab(bar, "**粗体**");
        // 结构不同（缺 data-type），不是页签条
        const otherLi = document.createElement("li");
        otherLi.className = "item";
        const otherTitle = document.createElement("div");
        otherTitle.className = "item__text";
        otherTitle.textContent = "**粗体**";
        otherLi.append(otherTitle);
        bar.append(otherLi);
        // 连容器都不是 ul.layout-tab-bar
        const fakeBar = document.createElement("div");
        fakeBar.className = "layout-tab-bar";
        fakeBar.innerHTML = '<div class="item__text">**粗体**</div>';
        document.body.append(fakeBar);

        mount({scope: "desktop"});

        expect(desktop.querySelector(`[${MARK_ATTR}]`)).not.toBeNull();
        expect(otherTitle.querySelector(`[${MARK_ATTR}]`)).toBeNull();
        expect(fakeBar.querySelector(`[${MARK_ATTR}]`)).toBeNull();
    });

    it("宿主用同一份原文重写 innerHTML 之后必须重新渲染", async () => {
        const bar = createBar();
        const title = addDesktopTab(bar, "**粗体**");
        mount({scope: "desktop"});
        expect(title.querySelector(`[${MARK_ATTR}="strong"]`)).not.toBeNull();

        // 内核打开文档时再写一次 Tab.updateTitle：节点被整片冲掉，原文没变
        title.innerHTML = "**粗体**";
        await settle();
        await frames.flush();

        expect(title.querySelector(`[${MARK_ATTR}="strong"]`)?.textContent).toBe("粗体");
        expect(title.textContent).toBe("**粗体**");
    });

    it("原文与标记都还在时不重复包装", async () => {
        const bar = createBar();
        const title = addDesktopTab(bar, "**粗体**");
        mount({scope: "desktop"});
        const before = title.innerHTML;
        const markCount = title.querySelectorAll(`[${MARK_ATTR}]`).length;

        // 页签条里多一个页签 → 重扫
        addDesktopTab(bar, "另一个");
        await settle();
        await frames.flush();

        expect(title.innerHTML).toBe(before);
        expect(title.querySelectorAll(`[${MARK_ATTR}]`).length).toBe(markCount);
    });

    it("切换 scope：旧位置还原成纯文本，新位置开始渲染", async () => {
        const bar = createBar();
        const desktop = addDesktopTab(bar, "**粗体**");
        const tabs = createMobileTabs();
        const mobile = addMobileItem(tabs, "**粗体**");

        const harness = mount({scope: "desktop"});
        expect(desktop.querySelector(`[${MARK_ATTR}="strong"]`)).not.toBeNull();

        harness.config.scope = "mobile";
        harness.notifyConfigChange();
        await settle();
        await frames.flush();

        expect(desktop.textContent).toBe("**粗体**");
        expect(desktop.querySelector(`[${MARK_ATTR}]`)).toBeNull();
        expect(mobile.querySelector(`[${MARK_ATTR}="strong"]`)?.textContent).toBe("粗体");
    });

    it("切回原 scope 时能重新渲染（还原时一并清掉「已渲染」记录）", async () => {
        const bar = createBar();
        const desktop = addDesktopTab(bar, "**粗体**");
        const tabs = createMobileTabs();
        addMobileItem(tabs, "**粗体**");

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

        expect(desktop.querySelector(`[${MARK_ATTR}="strong"]`)?.textContent).toBe("粗体");
    });

    it("无关突变不触发扫描", async () => {
        createBar();
        mount({scope: "desktop"});
        expect(frames.pendingCount()).toBe(0);

        const editor = document.createElement("div");
        editor.className = "protyle-wysiwyg";
        editor.innerHTML = "<div>**正文**</div>";
        document.body.append(editor);
        await settle();

        expect(frames.pendingCount()).toBe(0);
    });

    it("卸载把三处都还原成纯文本并撤掉样式", () => {
        const bar = createBar();
        const desktop = addDesktopTab(bar, "**粗体**");
        const menu = createTabList();
        const label = addTabListItem(menu, "**粗体**");
        const tabs = createMobileTabs();
        const mobile = addMobileItem(tabs, "**粗体**");

        const harness = mount({scope: "both"});

        harness.dispose();

        for (const element of [desktop, label, mobile]) {
            expect(element.textContent).toBe("**粗体**");
            expect(element.querySelector(`[${MARK_ATTR}]`)).toBeNull();
        }
        expect(harness.styleElement()).toBeNull();
    });

    it("卸载会取消已排队的帧，之后的突变不再渲染", async () => {
        const bar = createBar();
        const harness = mount({scope: "desktop"});

        addDesktopTab(bar, "**粗体**");
        await settle();
        expect(frames.pendingCount()).toBe(1);

        harness.dispose();
        expect(frames.pendingCount()).toBe(0);

        const later = addDesktopTab(bar, "*斜体*");
        await settle();
        await frames.flush();

        expect(later.querySelector(`[${MARK_ATTR}]`)).toBeNull();
    });

    it("destroy 幂等：连调两次不抛错", () => {
        createBar();
        const harness = mount({scope: "desktop"});

        expect(() => {
            harness.instance?.destroy?.();
            harness.instance?.destroy?.();
        }).not.toThrow();
    });
});
