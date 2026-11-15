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

describe("行级 Markdown 渲染器", () => {
    it("没有语法字符时只产出一个文本节点，不做任何包装", () => {
        const result = render("普通标题 2024");

        expect(result.nodes).toHaveLength(1);
        expect(result.nodes[0].nodeType).toBe(Node.TEXT_NODE);
        expect(result.styled()).toHaveLength(0);
        expect(result.markers()).toBe(0);
        expect(result.text()).toBe("普通标题 2024");
    });

    it("空字符串产出空节点列表（不是空文本节点）", () => {
        expect(renderInlineMarkdown("")).toEqual([]);
    });

    it("MARKDOWN_CHARS 只把这七种语法字符当成「值得渲染」的信号", () => {
        for (const char of ["*", "_", "~", "^", "=", "`", "\\"]) {
            expect(MARKDOWN_CHARS.test(char)).toBe(true);
        }
        // 常见标题里的符号不能触发渲染，否则每一条笔记都要被 replaceChildren 一遍
        for (const source of ["普通标题", "a b", "-", "!", "[链接](https://x.y)"]) {
            expect(MARKDOWN_CHARS.test(source)).toBe(false);
        }
    });

    it("加粗：strong 元素 + 两个隐藏定界符，textContent 仍是原文", () => {
        const result = render("**粗体**");

        expect(result.styled()).toHaveLength(1);
        expect(result.styled()[0].tagName).toBe("SPAN");
        expect(result.styled()[0].getAttribute(MARK_ATTR)).toBe("strong");
        // 沿用思源自己的行级标记写法，样式变量才生效
        expect(result.styled()[0].getAttribute("data-type")).toBe("strong");
        expect(result.styled()[0].textContent).toBe("粗体");
        expect(result.markers()).toBe(2);
        expect(result.text()).toBe("**粗体**");
    });

    const INLINE_CASES: [string, string, string][] = [
        ["*斜体*", "em", "斜体"],
        ["_斜体_", "em", "斜体"],
        ["~~删除~~", "s", "删除"],
        ["~下标~", "sub", "下标"],
        ["==高亮==", "mark", "高亮"],
        ["^上标^", "sup", "上标"],
    ];
    it.each(INLINE_CASES)("%s 渲染成 %s", (source, kind, content) => {
        const result = render(source);

        expect(result.styled()).toHaveLength(1);
        expect(result.styled()[0].getAttribute(MARK_ATTR)).toBe(kind);
        expect(result.styled()[0].getAttribute("data-type")).toBe(kind);
        expect(result.styled()[0].textContent).toBe(content);
        expect(result.text()).toBe(source);
    });

    it("三星号是「粗 + 斜」两层，strong 在外、em 在内", () => {
        const result = render("***粗斜***");
        const [strong, em] = result.styled();

        expect(result.styled()).toHaveLength(2);
        expect(strong.getAttribute("data-type")).toBe("strong");
        expect(em.getAttribute("data-type")).toBe("em");
        expect(strong.contains(em)).toBe(true);
        expect(strong.textContent).toBe("粗斜");
        expect(result.text()).toBe("***粗斜***");
    });

    it("词内下划线不当语法：snake_case / a_b_c / 2024_01_01", () => {
        for (const source of ["snake_case", "a_b_c", "2024_01_01"]) {
            const result = render(source);

            expect(result.styled()).toHaveLength(0);
            expect(result.text()).toBe(source);
        }
    });

    it("不支持的定界符长度按字面输出（四个星号、三个波浪线、单个等号）", () => {
        for (const source of ["****x****", "~~~x~~~", "a = b"]) {
            const result = render(source);

            expect(result.styled()).toHaveLength(0);
            expect(result.markers()).toBe(0);
            expect(result.text()).toBe(source);
        }
    });

    it("未闭合的定界符整段回落成原文，不产生空元素", () => {
        for (const source of ["**未闭合", "~~也没闭合", "*单独一个星号"]) {
            const result = render(source);

            expect(result.styled()).toHaveLength(0);
            expect(result.markers()).toBe(0);
            expect(result.text()).toBe(source);
        }
    });

    it("开定界符后紧跟空白不算语法（`** 前面有空格`）", () => {
        const result = render("** 空格开头**");

        expect(result.styled()).toHaveLength(0);
        expect(result.text()).toBe("** 空格开头**");
    });

    it("反斜杠转义下一个字符：不再参与配对，反斜杠本身被隐藏", () => {
        const result = render("\\*不是斜体\\*");

        expect(result.styled()).toHaveLength(0);
        expect(result.markers()).toBe(2);
        expect(result.text()).toBe("\\*不是斜体\\*");
    });

    it("结尾单独一个反斜杠输出字面反斜杠（后面没有字符可转义）", () => {
        const result = render("abc\\");

        expect(result.styled()).toHaveLength(0);
        expect(result.markers()).toBe(0);
        expect(result.text()).toBe("abc\\");
    });

    it("行级代码：内容原样、内部不再解析，挂思源自己的 fn__code", () => {
        const result = render("`a*b*`");

        expect(result.styled()).toHaveLength(1);
        expect(result.styled()[0].className).toBe("fn__code");
        // 行级代码只用工具类上色，不写 data-type（写了会被正文样式当成语义标记）
        expect(result.styled()[0].getAttribute("data-type")).toBeNull();
        expect(result.styled()[0].textContent).toBe("a*b*");
        expect(result.text()).toBe("`a*b*`");
    });

    it("空行级代码 / 未闭合反引号按字面输出", () => {
        for (const source of ["``", "`", "a`b"]) {
            const result = render(source);

            expect(result.styled()).toHaveLength(0);
            expect(result.text()).toBe(source);
        }
    });

    it("斜体里的粗体照常配对：*斜 **粗** 斜*", () => {
        const result = render("*斜 **粗** 斜*");

        expect(result.styled().map((element) => element.getAttribute("data-type"))).toEqual(["em", "strong"]);
        expect(result.text()).toBe("*斜 **粗** 斜*");
    });

    it("textContent 不变量：任何输入的渲染结果都与原文逐字相同", () => {
        const sources = [
            "普通标题",
            "**粗体**",
            "*斜*与_斜_",
            "***粗斜***",
            "~~删除~~ ~下标~ ^上标^ ==高亮==",
            "`行级代码`",
            "`含 **星号** 的代码`",
            "**未闭合",
            "\\*转义\\*",
            "2*3*4",
            "a = b",
            "中文 **粗体** 混排 🎉",
        ];

        for (const source of sources) {
            expect(render(source).text()).toBe(source);
        }
    });

    it("注入的样式只隐藏定界符，强调样式全部取思源自己的主题变量", () => {
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

describe("文档树标题渲染行级 Markdown", () => {
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

    it("声明：版本上限卡在宿主自己投影富标题之前，开关默认关闭", () => {
        expect(definition.id).toBe("doc-tree-title-markdown");
        expect(definition.category).toBe("doc-tree");
        expect(definition.enabled).toBe(true);
        // 3.8.10-alpha.2 起标题里的行内格式由宿主负责，再往后这份补丁必须退场
        expect(definition.maxAppVersion).toBe("3.8.10-alpha.1");
        expect(definition.settings).toEqual([
            {kind: "switch", key: "enabled", title: "common.enabled", default: false},
        ]);
    });

    it("挂载时注入共用样式，并先把树里已有的标题渲染一遍", () => {
        const tree = createTree();
        const title = appendTitle(tree, "**粗体** 与 `code`");
        document.body.append(tree);

        const harness = mount();

        expect(harness.records.styles[0]).toBe(INLINE_MARKDOWN_CSS);
        expect(harness.styleElement()?.textContent).toBe(INLINE_MARKDOWN_CSS);
        expect(title.querySelector(`[${MARK_ATTR}="strong"]`)?.textContent).toBe("粗体");
        expect(title.querySelector(".fn__code")?.textContent).toBe("code");
        // 宿主读 textContent 的地方（拖拽载荷、下拉文字）看到的仍是原文
        expect(title.textContent).toBe("**粗体** 与 `code`");
    });

    it("没有语法字符的标题一个节点都不碰", () => {
        const tree = createTree();
        const title = appendTitle(tree, "普通笔记 2024");
        document.body.append(tree);

        mount();

        expect(title.childNodes).toHaveLength(1);
        expect(title.firstChild?.nodeType).toBe(Node.TEXT_NODE);
        expect(title.textContent).toBe("普通笔记 2024");
    });

    it("移动端侧栏（[data-type=sidebar-file]）同样是作用域", () => {
        const tree = createTree(true);
        const title = appendTitle(tree, "==高亮==");
        document.body.append(tree);

        mount();

        expect(title.querySelector(`[${MARK_ATTR}="mark"]`)?.textContent).toBe("高亮");
    });

    it("宿主投影的富标题（.document-title-preview）整块跳过，不 replaceChildren", () => {
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

    it("只读 / 发布模式下照常渲染：它们只拦设置保存，不拦显示", () => {
        const config = window.siyuan.config as unknown as {readonly: boolean;};
        config.readonly = true;
        window.siyuan.isPublish = true;

        const tree = createTree();
        const title = appendTitle(tree, "^上标^");
        document.body.append(tree);

        mount();

        expect(title.querySelector(`[${MARK_ATTR}="sup"]`)?.textContent).toBe("上标");
    });

    it("重复扫描不会给同一份原文再包一层", async () => {
        const tree = createTree();
        const title = appendTitle(tree, "**粗体**");
        document.body.append(tree);

        mount();
        const before = title.innerHTML;
        const markers = title.querySelectorAll(`[${MARK_ATTR}]`).length;
        const styled = title.querySelectorAll(`[${MARK_ATTR}="strong"]`).length;

        // 树里多一条笔记：这是「值得扫描」的突变，会重扫整棵树
        appendTitle(tree, "新笔记");
        await settle();
        await frames.flush();

        expect(title.innerHTML).toBe(before);
        expect(title.querySelectorAll(`[${MARK_ATTR}]`).length).toBe(markers);
        expect(title.querySelectorAll(`[${MARK_ATTR}="strong"]`).length).toBe(styled);
    });

    it("重命名后按新原文重渲染（只有原文变化才重建节点）", async () => {
        const tree = createTree();
        const title = appendTitle(tree, "**粗体**");
        document.body.append(tree);

        mount();

        title.textContent = "*斜体*";
        await settle();
        await frames.flush();

        expect(title.querySelector(`[${MARK_ATTR}="em"]`)?.textContent).toBe("斜体");
        expect(title.querySelector(`[${MARK_ATTR}="strong"]`)).toBeNull();
        expect(title.textContent).toBe("*斜体*");
    });

    it("树里新增笔记的标题同样会被渲染", async () => {
        const tree = createTree();
        document.body.append(tree);
        mount();

        const title = appendTitle(tree, "~~删除~~");
        await settle();
        await frames.flush();

        expect(title.querySelector(`[${MARK_ATTR}="s"]`)?.textContent).toBe("删除");
    });

    it("文档树面板在功能挂载之后才创建也能渲染（靠 addedNodes 判定）", async () => {
        mount();

        const tree = createTree();
        const title = appendTitle(tree, "*斜体*");
        document.body.append(tree);
        await settle();
        await frames.flush();

        expect(title.querySelector(`[${MARK_ATTR}="em"]`)?.textContent).toBe("斜体");
    });

    it("树外的正文突变不触发扫描（正文输入的海量 childList 必须第一次就被挡掉）", async () => {
        const tree = createTree();
        appendTitle(tree, "**粗体**");
        document.body.append(tree);
        mount();
        expect(frames.pendingCount()).toBe(0);

        const editor = document.createElement("div");
        editor.className = "protyle-wysiwyg";
        editor.innerHTML = "<div>正文里的 **星号** 不是标题</div>";
        document.body.append(editor);
        await settle();

        expect(frames.pendingCount()).toBe(0);
        expect(editor.querySelector(`[${MARK_ATTR}]`)).toBeNull();
    });

    it("卸载后标题还原成纯文本，注入的样式一起撤掉", () => {
        const tree = createTree();
        const title = appendTitle(tree, "**粗体**");
        const plain = appendTitle(tree, "普通标题");
        document.body.append(tree);

        const harness = mount();
        expect(title.querySelector(`[${MARK_ATTR}]`)).not.toBeNull();

        harness.dispose();

        expect(title.textContent).toBe("**粗体**");
        expect(title.querySelector(`[${MARK_ATTR}]`)).toBeNull();
        // 没渲染过的标题完全不受影响
        expect(plain.textContent).toBe("普通标题");
        expect(harness.styleElement()).toBeNull();
    });

    it("卸载会取消已经排队的帧，卸载之后到达的突变不再渲染", async () => {
        const tree = createTree();
        document.body.append(tree);
        const harness = mount();

        appendTitle(tree, "**粗体**");
        await settle();
        expect(frames.pendingCount()).toBe(1);

        harness.dispose();
        expect(frames.pendingCount()).toBe(0);

        const later = appendTitle(tree, "*斜体*");
        await settle();
        await frames.flush();

        expect(later.querySelector(`[${MARK_ATTR}]`)).toBeNull();
        expect(later.textContent).toBe("*斜体*");
    });

    it("destroy 幂等：连调两次不抛错", () => {
        const tree = createTree();
        appendTitle(tree, "**粗体**");
        document.body.append(tree);
        const harness = mount();

        expect(() => {
            harness.instance?.destroy?.();
            harness.instance?.destroy?.();
        }).not.toThrow();
    });
});
