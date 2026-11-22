/**
 * 大纲显示层级。
 *
 * 断言的重点有三个：
 * 1. **`li` 后面紧跟的 `ul` 必须一起隐藏**。思源的大纲树是 `<li>…</li><ul>…</ul>` 平铺，
 *    只隐藏 `li` 会把子级标题留在原地，缩进和层级全错。
 * 2. **搜索期间整段停用**。宿主的搜索靠行内 `display` 生效，但层级过滤还开着的话深层标题
 *    就永远搜不出来，所以要按搜索框的实际内容给面板根元素加 / 摘一个类。
 * 3. **卸载无残留**：监听、类名、样式表都要收干净，关掉功能后所有行原样回来。
 */
import {
    afterEach,
    describe,
    expect,
    it,
} from "vitest";
import definition from "../../src/features/outline-level-filter";
import {mountOutlineLevelFilter} from "../../src/features/outline-level-filter/style";
import {
    configKeysOf,
    mountFeature,
} from "../helpers/feature-host";

const SEARCHING_CLASS = "ss-outline-searching";

/** 该功能注入的 `<style>` 数量：重复挂载、配置变更都不该堆叠第二张。 */
const styleCount = (): number =>
    document.head.querySelectorAll('style[data-some-settings-style="outline-level-filter"]').length;

/** 去掉注释再检查「有没有某条声明」，避免命中注释里的同名文字。 */
const rulesOf = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** 造一个桌面端大纲面板：页签容器是 `.sy__outline`，搜索框在头部，树在下面。 */
const desktopOutline = (): {root: HTMLElement; input: HTMLInputElement;} => {
    const root = document.createElement("div");
    root.className = "fn__flex-column file-tree sy__outline dockPanel";
    root.innerHTML = `<div class="block__icons">
    <input class="b3-text-field search__label fn__none fn__size200" />
</div>
<div class="fn__flex-1">
    <ul class="b3-list b3-list--background">
        <li class="b3-list-item" data-subtype="h1">A</li>
        <ul><li class="b3-list-item" data-subtype="h2">B</li></ul>
    </ul>
</div>`;
    document.body.append(root);
    return {root, input: root.querySelector("input") as HTMLInputElement};
};

/** 造一个移动端侧栏大纲：根元素是模板里的 `[data-type="sidebar-outline"]`。 */
const mobileOutline = (): {root: HTMLElement; input: HTMLInputElement;} => {
    const root = document.createElement("div");
    root.className = "fn__flex-column";
    root.dataset.type = "sidebar-outline";
    root.innerHTML = `<div class="toolbar">
    <input class="b3-text-field search__label fn__none fn__size200" />
</div>
<div class="fn__flex-1"><ul class="b3-list"></ul></div>`;
    document.body.append(root);
    return {root, input: root.querySelector("input") as HTMLInputElement};
};

const typeInto = (input: HTMLInputElement, value: string): void => {
    input.value = value;
    input.dispatchEvent(new Event("input", {bubbles: true}));
};

describe("Outline heading levels", () => {
    const mounted: {dispose: () => void;}[] = [];

    const mount = (config?: Record<string, unknown>) => {
        const harness = mountFeature(definition, config ? {config} : {});
        mounted.push(harness);
        return harness;
    };

    afterEach(() => {
        mounted.splice(0).forEach((harness) => harness.dispose());
        document.body.replaceChildren();
    });

    it("declaration: doc tree category, select as the switch, all by default", () => {
        expect(definition.category).toEqual(["doc-tree"]);
        expect(definition.frontends).toBeUndefined();
        expect(configKeysOf(definition.settings)).toEqual(["level"]);
        expect(definition.settings[0]).toMatchObject({kind: "select", key: "level", default: "all"});
        expect(definition.isEnabled?.({level: "all"})).toBe(false);
        ["h2", "h3", "h4", "h5"].forEach((level) => {
            expect(definition.isEnabled?.({level})).toBe(true);
        });
    });

    it("H1–H3 hides H4/H5/H6 rows, child heading lists and child block lists on both panel roots", () => {
        const css = rulesOf(mount({level: "h3"}).css());

        [".sy__outline", '[data-type="sidebar-outline"]'].forEach((root) => {
            [4, 5, 6].forEach((depth) => {
                const item = `${root}:not(.${SEARCHING_CLASS}) li[data-subtype="h${depth}"]`;
                expect(css).toContain(item);
                // 子标题列表与子块列表是 `li` 的兄弟节点，必须一起隐藏
                expect(css).toContain(`${item} + ul`);
                expect(css).toContain(`${item} + ul + ul`);
            });
            // 允许保留的层级一条规则都不许出现
            [1, 2, 3].forEach((depth) => {
                expect(css).not.toContain(`li[data-subtype="h${depth}"]`);
            });
        });
        expect(css).toContain("display: none;");
    });

    it("hides shallower levels for each option, so H1–H5 hides only H6", () => {
        expect(rulesOf(mount({level: "h2"}).css())).toContain('li[data-subtype="h3"]');
        const h4 = rulesOf(mount({level: "h4"}).css());
        expect(h4).toContain('li[data-subtype="h5"]');
        expect(h4).not.toContain('li[data-subtype="h4"]');
        const h5 = rulesOf(mount({level: "h5"}).css());
        expect(h5).toContain('li[data-subtype="h6"]');
        expect(h5).not.toContain('li[data-subtype="h5"]');
    });

    it("all injects no hiding rule and only a comment that flushes the old ones", () => {
        const css = mount({level: "all"}).css();
        expect(rulesOf(css)).not.toContain("display: none");
        expect(styleCount()).toBe(1);
    });

    it("reinjects the same stylesheet on a config change instead of stacking a second one", () => {
        const harness = mount({level: "h3"});
        expect(styleCount()).toBe(1);

        harness.config.level = "h4";
        harness.notifyConfigChange();

        expect(styleCount()).toBe(1);
        expect(harness.records.styles).toHaveLength(2);
        expect(harness.styleElement()?.textContent).toBe(harness.records.styles.at(-1));
        expect(rulesOf(harness.records.styles.at(-1) ?? "")).not.toContain('li[data-subtype="h4"]');
    });

    it("temporarily lifts the limit while searching on the desktop outline and restores it when cleared", () => {
        mount({level: "h3"});
        const {root, input} = desktopOutline();

        typeInto(input, "chapter");
        expect(root.classList.contains(SEARCHING_CLASS)).toBe(true);

        typeInto(input, "");
        expect(root.classList.contains(SEARCHING_CLASS)).toBe(false);
    });

    it("works the same on the mobile sidebar outline", () => {
        mount({level: "h3"});
        const {root, input} = mobileOutline();

        typeInto(input, "chapter");
        expect(root.classList.contains(SEARCHING_CLASS)).toBe(true);

        typeInto(input, "");
        expect(root.classList.contains(SEARCHING_CLASS)).toBe(false);
    });

    it("counts whitespace alone as searching: the host uses trim: false, so it is a valid query", () => {
        mount({level: "h3"});
        const {root, input} = desktopOutline();

        typeInto(input, "   ");
        expect(root.classList.contains(SEARCHING_CLASS)).toBe(true);
    });

    it("leaves search boxes of other panels unaffected", () => {
        mount({level: "h3"});
        const bookmark = document.createElement("div");
        bookmark.className = "sy__bookmark";
        bookmark.innerHTML = '<input class="b3-text-field search__label" />';
        document.body.append(bookmark);

        typeInto(bookmark.querySelector("input") as HTMLInputElement, "chapter");
        expect(bookmark.classList.contains(SEARCHING_CLASS)).toBe(false);
    });

    it("syncs an existing search value once on mount", () => {
        const {root, input} = desktopOutline();
        input.value = "chapter";

        mount({level: "h3"});
        expect(root.classList.contains(SEARCHING_CLASS)).toBe(true);
    });

    it("does not log the same state twice", () => {
        const harness = mount({level: "h3"});
        const {input} = desktopOutline();

        typeInto(input, "a");
        const first = harness.records.logs.length;
        typeInto(input, "ab");
        expect(harness.records.logs.length).toBe(first);
    });

    it("dispose cleans up the listeners, class names and stylesheet together", () => {
        const harness = mount({level: "h3"});
        const {root, input} = desktopOutline();
        typeInto(input, "chapter");
        expect(root.classList.contains(SEARCHING_CLASS)).toBe(true);

        harness.dispose();

        expect(styleCount()).toBe(0);
        expect(root.classList.contains(SEARCHING_CLASS)).toBe(false);
        // 监听也拆了：再输入不会再挂类
        typeInto(input, "chapter");
        expect(root.classList.contains(SEARCHING_CLASS)).toBe(false);
    });

    it("applies once on mount and hooks later changes to onConfigChange", () => {
        const styles: string[] = [];
        const listeners: (() => void)[] = [];
        const host = {
            config: {level: "h2"},
            addStyle: (css: string) => {
                styles.push(css);
            },
            onConfigChange: (listener: () => void) => {
                listeners.push(listener);
            },
            log: {scope: "test", info: () => undefined, warn: () => undefined, error: () => undefined},
        } as unknown as Parameters<typeof mountOutlineLevelFilter>[0];

        const instance = mountOutlineLevelFilter(host);
        expect(styles).toHaveLength(1);
        expect(styles[0]).toContain('li[data-subtype="h3"]');
        expect(listeners).toHaveLength(1);
        instance.destroy?.();
    });
});
