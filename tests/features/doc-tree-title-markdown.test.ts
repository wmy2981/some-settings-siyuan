/**
 * 文档树标题渲染行级 Markdown。
 *
 * 这里要守两层东西：
 *
 * 1. **渲染规则本身**（`core/inline-markdown.ts`）：合法写法、长度不支持的定界符、未闭合、
 *    反斜杠转义、嵌套、行级代码，以及最关键的一条不变量 —— 渲染结果的 `textContent`
 *    必须与原文逐字相同。定界符只是被 CSS 隐藏的 `<span>`，宿主要读 `textContent`
 *    的地方（拖拽载荷、`data-name`、下拉列表文字）才不会跟着变。
 * 2. **挂载层**：只碰 `.b3-list-item__text` 的子节点、整块跳过宿主投影的富标题、
 *    树外突变不触发扫描、卸载后原样还原。
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
    MARKDOWN_CHARS,
    renderInlineMarkdown,
} from "../../src/core/inline-markdown";
import definition from "../../src/features/doc-tree-title-markdown";
import {mountFeature} from "../helpers/feature-host";
import type {HostHarness} from "../helpers/feature-host";

/**
 * 把 `requestAnimationFrame` 换成测试可驱动的队列。
 *
 * 源码里所有 DOM 同步都排在帧回调里，用真实的 16ms 帧只会让断言变成「猜时间」；
 * 这里让测试显式决定「这一帧什么时候跑」。
 */
const stubFrames = () => {
    const pending = new Map<number, FrameRequestCallback>();
    let nextId = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback): number => {
        nextId += 1;
        pending.set(nextId, callback);
        return nextId;
    });
    // 取消要按句柄精确删掉：源码在 destroy 里取消「还没跑的那一帧」，
    // 如果这里整体清空，就测不出「取消的是自己那一帧」
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

/** MutationObserver 的回调排在微任务里，让出一轮就够（见 tests 里的实测）。 */
const settle = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
};

const render = (source: string) => {
    const nodes = renderInlineMarkdown(source);
    const wrapper = document.createElement("span");
    wrapper.append(...nodes);
    return {
        nodes,
        wrapper,
        /** 真正带样式的元素（不含隐藏的定界符）。 */
        styled: (): HTMLElement[] =>
            Array.from(wrapper.querySelectorAll<HTMLElement>(`[${MARK_ATTR}]:not([${MARK_ATTR}="marker"])`)),
        markers: (): number => wrapper.querySelectorAll(`[${MARK_ATTR}="marker"]`).length,
        text: (): string => wrapper.textContent ?? "",
    };
};

describe("inline Markdown renderer", () => {
    it("produces a single text node with no wrapper when there are no syntax characters", () => {
        const result = render("plain title 2024");

        expect(result.nodes).toHaveLength(1);
        expect(result.nodes[0].nodeType).toBe(Node.TEXT_NODE);
        expect(result.styled()).toHaveLength(0);
        expect(result.markers()).toBe(0);
        expect(result.text()).toBe("plain title 2024");
    });

    it("an empty string produces an empty node list (not an empty text node)", () => {
        expect(renderInlineMarkdown("")).toEqual([]);
    });

    it("MARKDOWN_CHARS treats only these seven syntax characters as a render signal", () => {
        for (const char of ["*", "_", "~", "^", "=", "`", "\\"]) {
            expect(MARKDOWN_CHARS.test(char)).toBe(true);
        }
        // 常见标题里的符号不能触发渲染，否则每一条笔记都要被 replaceChildren 一遍
        for (const source of ["plain title", "a b", "-", "!", "[link](https://x.y)"]) {
            expect(MARKDOWN_CHARS.test(source)).toBe(false);
        }
    });

    it("bold: a strong element plus two hidden delimiters, textContent still matches the source", () => {
        const result = render("**bold**");

        expect(result.styled()).toHaveLength(1);
        expect(result.styled()[0].tagName).toBe("SPAN");
        expect(result.styled()[0].getAttribute(MARK_ATTR)).toBe("strong");
        // 沿用思源自己的行级标记写法，样式变量才生效
        expect(result.styled()[0].getAttribute("data-type")).toBe("strong");
        expect(result.styled()[0].textContent).toBe("bold");
        expect(result.markers()).toBe(2);
        expect(result.text()).toBe("**bold**");
    });

    const INLINE_CASES: [string, string, string][] = [
        ["*italic*", "em", "italic"],
        ["_italic_", "em", "italic"],
        ["~~deleted~~", "s", "deleted"],
        ["~subscript~", "sub", "subscript"],
        ["==highlight==", "mark", "highlight"],
        ["^superscript^", "sup", "superscript"],
    ];
    it.each(INLINE_CASES)("%s renders as %s", (source, kind, content) => {
        const result = render(source);

        expect(result.styled()).toHaveLength(1);
        expect(result.styled()[0].getAttribute(MARK_ATTR)).toBe(kind);
        expect(result.styled()[0].getAttribute("data-type")).toBe(kind);
        expect(result.styled()[0].textContent).toBe(content);
        expect(result.text()).toBe(source);
    });

    it("three asterisks produce two layers, strong outside and em inside", () => {
        const result = render("***bold italic***");
        const [strong, em] = result.styled();

        expect(result.styled()).toHaveLength(2);
        expect(strong.getAttribute("data-type")).toBe("strong");
        expect(em.getAttribute("data-type")).toBe("em");
        expect(strong.contains(em)).toBe(true);
        expect(strong.textContent).toBe("bold italic");
        expect(result.text()).toBe("***bold italic***");
    });

    it("underscores inside a word are not syntax: snake_case / a_b_c / 2024_01_01", () => {
        for (const source of ["snake_case", "a_b_c", "2024_01_01"]) {
            const result = render(source);

            expect(result.styled()).toHaveLength(0);
            expect(result.text()).toBe(source);
        }
    });

    it("unsupported delimiter lengths are emitted literally (four asterisks, three tildes, a single equals sign)", () => {
        for (const source of ["****x****", "~~~x~~~", "a = b"]) {
            const result = render(source);

            expect(result.styled()).toHaveLength(0);
            expect(result.markers()).toBe(0);
            expect(result.text()).toBe(source);
        }
    });

    it("an unclosed delimiter falls back to the raw text without producing empty elements", () => {
        for (const source of ["**unclosed", "~~also unclosed", "*single asterisk"]) {
            const result = render(source);

            expect(result.styled()).toHaveLength(0);
            expect(result.markers()).toBe(0);
            expect(result.text()).toBe(source);
        }
    });

    it("whitespace right after an opening delimiter is not syntax (`** leading space`)", () => {
        const result = render("** leading space**");

        expect(result.styled()).toHaveLength(0);
        expect(result.text()).toBe("** leading space**");
    });

    it("a backslash escapes the next character: it no longer pairs, and the backslash itself is hidden", () => {
        const result = render("\\*not italic\\*");

        expect(result.styled()).toHaveLength(0);
        expect(result.markers()).toBe(2);
        expect(result.text()).toBe("\\*not italic\\*");
    });

    it("a trailing backslash is emitted literally (there is no following character to escape)", () => {
        const result = render("abc\\");

        expect(result.styled()).toHaveLength(0);
        expect(result.markers()).toBe(0);
        expect(result.text()).toBe("abc\\");
    });

    it("inline code: content kept as-is, no parsing inside, using SiYuan's own fn__code", () => {
        const result = render("`a*b*`");

        expect(result.styled()).toHaveLength(1);
        expect(result.styled()[0].className).toBe("fn__code");
        // 行级代码只用工具类上色，不写 data-type（写了会被正文样式当成语义标记）
        expect(result.styled()[0].getAttribute("data-type")).toBeNull();
        expect(result.styled()[0].textContent).toBe("a*b*");
        expect(result.text()).toBe("`a*b*`");
    });

    it("empty inline code / an unclosed backtick is emitted literally", () => {
        for (const source of ["``", "`", "a`b"]) {
            const result = render(source);

            expect(result.styled()).toHaveLength(0);
            expect(result.text()).toBe(source);
        }
    });

    it("bold inside italic still pairs: *italic **bold** italic*", () => {
        const result = render("*italic **bold** italic*");

        expect(result.styled().map((element) => element.getAttribute("data-type"))).toEqual(["em", "strong"]);
        expect(result.text()).toBe("*italic **bold** italic*");
    });

    it("textContent invariant: any input renders back to exactly the same text", () => {
        const sources = [
            "plain title",
            "**bold**",
            "*italic* and _italic_",
            "***bold italic***",
            "~~deleted~~ ~subscript~ ^superscript^ ==highlight==",
            "`inline code`",
            "`code with **asterisks**`",
            "**unclosed",
            "\\*escaped\\*",
            "2*3*4",
            "a = b",
            "mixed **bold** text 🎉",
        ];

        for (const source of sources) {
            expect(render(source).text()).toBe(source);
        }
    });

    it("the injected CSS only hides delimiters; emphasis styles all use SiYuan's own theme variables", () => {
        expect(INLINE_MARKDOWN_CSS).toContain(`[${MARK_ATTR}="marker"] {`);
        expect(INLINE_MARKDOWN_CSS).toContain("display: none;");
        // .fn__code 自带 white-space: pre-wrap，会把单行标题折成多行，必须还原成继承
        expect(INLINE_MARKDOWN_CSS).toContain("white-space: inherit;");
        expect(INLINE_MARKDOWN_CSS).toContain("word-break: inherit;");
        expect(INLINE_MARKDOWN_CSS).toContain("var(--b3-protyle-inline-strong-color)");
        expect(INLINE_MARKDOWN_CSS).toContain("var(--b3-protyle-inline-em-color)");
        expect(INLINE_MARKDOWN_CSS).toContain("var(--b3-protyle-inline-s-color)");
        expect(INLINE_MARKDOWN_CSS).toContain("var(--b3-protyle-inline-mark-background)");
    });
});

describe("doc tree titles render inline Markdown", () => {
    const mounted: HostHarness[] = [];
    let frames: ReturnType<typeof stubFrames>;

    const mount = (config: Record<string, unknown> = {}): HostHarness => {
        frames = stubFrames();
        const harness = mountFeature(definition, {config: {enabled: true, ...config}});
        mounted.push(harness);
        return harness;
    };

    /** 文档树面板：桌面端是 `.sy__file`，移动端侧栏是 `[data-type="sidebar-file"]`。 */
    const createTree = (mobile = false): HTMLElement => {
        const tree = document.createElement("div");
        if (mobile) {
            tree.setAttribute("data-type", "sidebar-file");
        } else {
            tree.className = "sy__file";
        }
        return tree;
    };

    /** 往树里挂一条笔记，返回它的标题层（`.b3-list-item__text`）。 */
    const appendTitle = (tree: HTMLElement, text: string): HTMLElement => {
        const item = document.createElement("div");
        item.className = "b3-list-item";
        item.setAttribute("role", "treeitem");
        const title = document.createElement("span");
        title.className = "b3-list-item__text";
        title.textContent = text;
        item.append(title);
        tree.append(item);
        return title;
    };

    afterEach(() => {
        // 每个用例都要按宿主的卸载顺序收干净，否则订阅与样式会串到下一个用例
        mounted.splice(0).forEach((harness) => harness.dispose());
    });

    it("declaration: the version cap lands before the host projects rich titles, and the switch is off by default", () => {
        expect(definition.id).toBe("doc-tree-title-markdown");
        expect(definition.category).toBe("doc-tree");
        expect(definition.enabled).toBe(true);
        // 3.8.10-alpha.2 起标题里的行内格式由宿主负责，再往后这份补丁必须退场
        expect(definition.maxAppVersion).toBe("3.8.10-alpha.1");
        expect(definition.settings).toEqual([
            {kind: "switch", key: "enabled", title: "common.enabled", default: false},
        ]);
    });

    it("mounting injects the shared CSS and renders the titles already in the tree", () => {
        const tree = createTree();
        const title = appendTitle(tree, "**bold** and `code`");
        document.body.append(tree);

        const harness = mount();

        expect(harness.records.styles[0]).toBe(INLINE_MARKDOWN_CSS);
        expect(harness.styleElement()?.textContent).toBe(INLINE_MARKDOWN_CSS);
        expect(title.querySelector(`[${MARK_ATTR}="strong"]`)?.textContent).toBe("bold");
        expect(title.querySelector(".fn__code")?.textContent).toBe("code");
        // 宿主读 textContent 的地方（拖拽载荷、下拉文字）看到的仍是原文
        expect(title.textContent).toBe("**bold** and `code`");
    });

    it("a title without syntax characters is left untouched", () => {
        const tree = createTree();
        const title = appendTitle(tree, "plain note 2024");
        document.body.append(tree);

        mount();

        expect(title.childNodes).toHaveLength(1);
        expect(title.firstChild?.nodeType).toBe(Node.TEXT_NODE);
        expect(title.textContent).toBe("plain note 2024");
    });

    it("the mobile sidebar ([data-type=sidebar-file]) is in scope too", () => {
        const tree = createTree(true);
        const title = appendTitle(tree, "==highlight==");
        document.body.append(tree);

        mount();

        expect(title.querySelector(`[${MARK_ATTR}="mark"]`)?.textContent).toBe("highlight");
    });

    it("a host-projected rich title (.document-title-preview) is skipped entirely, with no replaceChildren", () => {
        const tree = createTree();
        const title = document.createElement("span");
        title.className = "b3-list-item__text document-title-preview b3-typography";
        // a_b / 1*2 这种普通标题就会命中语法字符；一旦被换掉，内核那份行级 AST 就没了
        title.innerHTML = '<span data-type="strong">a_b</span>1*2';
        tree.append(title);
        document.body.append(tree);

        mount();

        expect(title.querySelector(`[${MARK_ATTR}]`)).toBeNull();
        expect(title.innerHTML).toBe('<span data-type="strong">a_b</span>1*2');
    });

    it("renders as usual in read-only / publish mode: those only block saving settings, not display", () => {
        const config = window.siyuan.config as unknown as {readonly: boolean;};
        config.readonly = true;
        window.siyuan.isPublish = true;

        const tree = createTree();
        const title = appendTitle(tree, "^superscript^");
        document.body.append(tree);

        mount();

        expect(title.querySelector(`[${MARK_ATTR}="sup"]`)?.textContent).toBe("superscript");
    });

    it("rescanning does not wrap the same source twice", async () => {
        const tree = createTree();
        const title = appendTitle(tree, "**bold**");
        document.body.append(tree);

        mount();
        const before = title.innerHTML;
        const markers = title.querySelectorAll(`[${MARK_ATTR}]`).length;
        const styled = title.querySelectorAll(`[${MARK_ATTR}="strong"]`).length;

        // 树里多一条笔记：这是「值得扫描」的突变，会重扫整棵树
        appendTitle(tree, "new note");
        await settle();
        await frames.flush();

        expect(title.innerHTML).toBe(before);
        expect(title.querySelectorAll(`[${MARK_ATTR}]`).length).toBe(markers);
        expect(title.querySelectorAll(`[${MARK_ATTR}="strong"]`).length).toBe(styled);
    });

    it("a rename re-renders from the new source (nodes are rebuilt only when the source changes)", async () => {
        const tree = createTree();
        const title = appendTitle(tree, "**bold**");
        document.body.append(tree);

        mount();

        title.textContent = "*italic*";
        await settle();
        await frames.flush();

        expect(title.querySelector(`[${MARK_ATTR}="em"]`)?.textContent).toBe("italic");
        expect(title.querySelector(`[${MARK_ATTR}="strong"]`)).toBeNull();
        expect(title.textContent).toBe("*italic*");
    });

    it("titles of notes added to the tree are rendered too", async () => {
        const tree = createTree();
        document.body.append(tree);
        mount();

        const title = appendTitle(tree, "~~deleted~~");
        await settle();
        await frames.flush();

        expect(title.querySelector(`[${MARK_ATTR}="s"]`)?.textContent).toBe("deleted");
    });

    it("a doc tree panel created after the feature mounts is rendered too (decided by addedNodes)", async () => {
        mount();

        const tree = createTree();
        const title = appendTitle(tree, "*italic*");
        document.body.append(tree);
        await settle();
        await frames.flush();

        expect(title.querySelector(`[${MARK_ATTR}="em"]`)?.textContent).toBe("italic");
    });

    it("mutations outside the tree do not trigger a scan (the childList flood from typing must be rejected first)", async () => {
        const tree = createTree();
        appendTitle(tree, "**bold**");
        document.body.append(tree);
        mount();
        expect(frames.pendingCount()).toBe(0);

        const editor = document.createElement("div");
        editor.className = "protyle-wysiwyg";
        editor.innerHTML = "<div>an **asterisk** in the body is not a title</div>";
        document.body.append(editor);
        await settle();

        expect(frames.pendingCount()).toBe(0);
        expect(editor.querySelector(`[${MARK_ATTR}]`)).toBeNull();
    });

    it("disposing restores the plain text of titles and removes the injected CSS", () => {
        const tree = createTree();
        const title = appendTitle(tree, "**bold**");
        const plain = appendTitle(tree, "plain title");
        document.body.append(tree);

        const harness = mount();
        expect(title.querySelector(`[${MARK_ATTR}]`)).not.toBeNull();

        harness.dispose();

        expect(title.textContent).toBe("**bold**");
        expect(title.querySelector(`[${MARK_ATTR}]`)).toBeNull();
        // 没渲染过的标题完全不受影响
        expect(plain.textContent).toBe("plain title");
        expect(harness.styleElement()).toBeNull();
    });

    it("disposing cancels the queued frame, and mutations arriving afterwards are not rendered", async () => {
        const tree = createTree();
        document.body.append(tree);
        const harness = mount();

        appendTitle(tree, "**bold**");
        await settle();
        expect(frames.pendingCount()).toBe(1);

        harness.dispose();
        expect(frames.pendingCount()).toBe(0);

        const later = appendTitle(tree, "*italic*");
        await settle();
        await frames.flush();

        expect(later.querySelector(`[${MARK_ATTR}]`)).toBeNull();
        expect(later.textContent).toBe("*italic*");
    });

    it("destroy is idempotent: calling it twice does not throw", () => {
        const tree = createTree();
        appendTitle(tree, "**bold**");
        document.body.append(tree);
        const harness = mount();

        expect(() => {
            harness.instance?.destroy?.();
            harness.instance?.destroy?.();
        }).not.toThrow();
    });
});
