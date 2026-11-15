/**
 * `core/inline-markdown.ts`：行级 Markdown 渲染。
 *
 * 最关键的一条不变量：渲染结果的 `textContent` 必须与原文**逐字相同**
 * —— 思源有若干地方直接读 `textContent`（拖拽提示、`document.title`、页签下拉），
 * 定界符因此留在 DOM 里、只靠 CSS 隐藏。
 */
import {
    describe,
    expect,
    it,
} from "vitest";
import {
    INLINE_MARKDOWN_CSS,
    MARK_ATTR,
    MARKDOWN_CHARS,
    renderInlineMarkdown,
} from "../../src/core/inline-markdown";

const render = (source: string): HTMLElement => {
    const container = document.createElement("div");
    container.append(...renderInlineMarkdown(source));
    return container;
};

/** 某一种样式元素的数量。 */
const countOf = (container: HTMLElement, kind: string): number =>
    container.querySelectorAll(`[${MARK_ATTR}="${kind}"]`).length;

describe("MARKDOWN_CHARS", () => {
    it("只把语法字符当成「需要渲染」的信号", () => {
        expect(MARKDOWN_CHARS.test("**bold**")).toBe(true);
        expect(MARKDOWN_CHARS.test("a_b")).toBe(true);
        expect(MARKDOWN_CHARS.test("~~x~~")).toBe(true);
        expect(MARKDOWN_CHARS.test("^x^")).toBe(true);
        expect(MARKDOWN_CHARS.test("==x==")).toBe(true);
        expect(MARKDOWN_CHARS.test("`x`")).toBe(true);
        expect(MARKDOWN_CHARS.test("\\*")).toBe(true);
        expect(MARKDOWN_CHARS.test("普通标题")).toBe(false);
    });
});

describe("纯文本", () => {
    it("没有语法时原样返回一个文本节点", () => {
        const container = render("普通标题");
        expect(container.textContent).toBe("普通标题");
        expect(container.querySelectorAll("span")).toHaveLength(0);
    });

    it("空串返回空节点列表", () => {
        expect(renderInlineMarkdown("")).toEqual([]);
    });
});

describe("强调与删除线", () => {
    it("两个星号是加粗", () => {
        const container = render("**粗体**");
        expect(countOf(container, "strong")).toBe(1);
        const strong = container.querySelector(`[${MARK_ATTR}="strong"]`) as HTMLElement;
        expect(strong.textContent).toBe("粗体");
        expect(strong.getAttribute("data-type")).toBe("strong");
    });

    it("一个星号是斜体", () => {
        const container = render("*斜体*");
        expect(container.querySelector(`[${MARK_ATTR}="em"]`)?.textContent).toBe("斜体");
    });

    it("三个星号是粗斜体，外层 strong、内层 em", () => {
        const container = render("***粗斜***");
        expect(container.querySelector(`[${MARK_ATTR}="strong"] > [${MARK_ATTR}="em"]`)?.textContent).toBe("粗斜");
    });

    it("下划线写法与星号一致", () => {
        expect(countOf(render("__粗__"), "strong")).toBe(1);
        expect(countOf(render("_斜_"), "em")).toBe(1);
    });

    it("两个波浪号是删除线，一个是下标", () => {
        expect(countOf(render("~~删~~"), "s")).toBe(1);
        const sub = render("H~2~O");
        expect(sub.querySelector(`[${MARK_ATTR}="sub"]`)?.textContent).toBe("2");
        expect(sub.textContent).toBe("H~2~O");
    });

    it("等号是高亮，仅限两个", () => {
        expect(countOf(render("==亮=="), "mark")).toBe(1);
        expect(countOf(render("=亮="), "mark")).toBe(0);
    });

    it("一个尖号是上标", () => {
        const container = render("2^10^");
        expect(container.querySelector(`[${MARK_ATTR}="sup"]`)?.textContent).toBe("10");
    });

    it("嵌套的强调各自生效", () => {
        const container = render("*斜 **粗** 斜*");
        expect(countOf(container, "em")).toBe(1);
        expect(container.querySelector(`[${MARK_ATTR}="em"] > [${MARK_ATTR}="strong"]`)?.textContent).toBe("粗");
        expect(container.textContent).toBe("*斜 **粗** 斜*");
    });

    it("词内下划线不当语法（snake_case / 日期）", () => {
        expect(countOf(render("snake_case"), "em")).toBe(0);
        expect(countOf(render("2024_01_01"), "em")).toBe(0);
        expect(countOf(render("a_b_c"), "em")).toBe(0);
    });

    it("闭合定界符后面紧跟词字符时不算闭合", () => {
        expect(countOf(render("_x_1"), "em")).toBe(0);
    });
});

describe("行级代码", () => {
    it("用思源自己的 fn__code 上色，不带 data-type", () => {
        const container = render("`code`");
        const code = container.querySelector(`[${MARK_ATTR}="code"]`) as HTMLElement;
        expect(code.className).toBe("fn__code");
        expect(code.getAttribute("data-type")).toBeNull();
        expect(code.textContent).toBe("code");
    });

    it("代码内部不再解析语法", () => {
        const container = render("`**not bold**`");
        expect(countOf(container, "strong")).toBe(0);
        expect(container.querySelector(`[${MARK_ATTR}="code"]`)?.textContent).toBe("**not bold**");
    });

    it("没有闭合的反引号按字面输出", () => {
        const container = render("`no end");
        expect(countOf(container, "code")).toBe(0);
        expect(container.textContent).toBe("`no end");
    });

    it("空的反引号对不产生代码元素", () => {
        const container = render("``");
        expect(countOf(container, "code")).toBe(0);
        expect(container.textContent).toBe("``");
    });
});

describe("转义与不闭合", () => {
    it("反斜杠把下一个字符按字面输出，不再参与配对", () => {
        const container = render("\\*不是斜体\\*");
        expect(countOf(container, "em")).toBe(0);
        expect(container.textContent).toBe("\\*不是斜体\\*");
    });

    it("转义过的定界符不会被当成闭合", () => {
        const container = render("*a \\* b*");
        expect(countOf(container, "em")).toBe(1);
        expect(container.querySelector(`[${MARK_ATTR}="em"]`)?.textContent).toBe("a \\* b");
        expect(container.textContent).toBe("*a \\* b*");
    });

    it("末尾单个反斜杠按字面保留", () => {
        const container = render("tail\\");
        expect(container.textContent).toBe("tail\\");
    });

    it("找不到闭合定界符时按字面输出", () => {
        const container = render("**没闭合");
        expect(countOf(container, "strong")).toBe(0);
        expect(container.textContent).toBe("**没闭合");
    });

    it("不支持的定界符长度按字面输出", () => {
        const container = render("****四个****");
        expect(container.querySelectorAll("span")).toHaveLength(0);
        expect(container.textContent).toBe("****四个****");
    });

    it("开定界符后面紧跟空白时不算开", () => {
        expect(countOf(render("* x*"), "em")).toBe(0);
    });

    it("闭合定界符前面是空白时不算闭合", () => {
        expect(countOf(render("*x *"), "em")).toBe(0);
    });
});

describe("textContent 不变量", () => {
    const samples = [
        "普通标题",
        "**粗体**",
        "*斜体*",
        "***粗斜***",
        "~~删除~~ 和 ~下标~ 和 ^上标^",
        "==高亮==",
        "`code` 加 **粗**",
        "snake_case 与 a_b_c",
        "\\*转义\\* 与 \\`反引号\\`",
        "**没闭合 *也算 *嵌套**",
        "混合 ~~删 **粗** 删~~ 结束",
        "中文 **加粗** 中文",
        "=单等号= 与 ^单尖号",
        "*a **b** c*",
        "结尾 **",
    ];

    samples.forEach((sample) => {
        it(`渲染后文字仍是原文：${sample}`, () => {
            expect(render(sample).textContent).toBe(sample);
        });
    });
});

describe("INLINE_MARKDOWN_CSS", () => {
    it("隐藏定界符，并保持代码段不额外折行", () => {
        expect(INLINE_MARKDOWN_CSS).toContain(`[${MARK_ATTR}="marker"]`);
        expect(INLINE_MARKDOWN_CSS).toContain("display: none");
        expect(INLINE_MARKDOWN_CSS).toContain("white-space: inherit");
        expect(INLINE_MARKDOWN_CSS).toContain("word-break: inherit");
    });

    it("每种样式都有对应规则，色值取思源主题变量", () => {
        ["strong", "em", "s", "mark", "sup", "sub"].forEach((kind) => {
            expect(INLINE_MARKDOWN_CSS).toContain(`[${MARK_ATTR}="${kind}"]`);
        });
        expect(INLINE_MARKDOWN_CSS).toContain("var(--b3-protyle-inline-strong-color)");
        expect(INLINE_MARKDOWN_CSS).toContain("var(--b3-protyle-inline-mark-background)");
    });
});
