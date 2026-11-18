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
    it("treats only syntax characters as a render signal", () => {
        expect(MARKDOWN_CHARS.test("**bold**")).toBe(true);
        expect(MARKDOWN_CHARS.test("a_b")).toBe(true);
        expect(MARKDOWN_CHARS.test("~~x~~")).toBe(true);
        expect(MARKDOWN_CHARS.test("^x^")).toBe(true);
        expect(MARKDOWN_CHARS.test("==x==")).toBe(true);
        expect(MARKDOWN_CHARS.test("`x`")).toBe(true);
        expect(MARKDOWN_CHARS.test("\\*")).toBe(true);
        expect(MARKDOWN_CHARS.test("plain title")).toBe(false);
    });
});

describe("plain text", () => {
    it("returns a single text node unchanged when there is no syntax", () => {
        const container = render("plain title");
        expect(container.textContent).toBe("plain title");
        expect(container.querySelectorAll("span")).toHaveLength(0);
    });

    it("an empty string returns an empty node list", () => {
        expect(renderInlineMarkdown("")).toEqual([]);
    });
});

describe("emphasis and strikethrough", () => {
    it("two asterisks mean bold", () => {
        const container = render("**bold**");
        expect(countOf(container, "strong")).toBe(1);
        const strong = container.querySelector(`[${MARK_ATTR}="strong"]`) as HTMLElement;
        expect(strong.textContent).toBe("bold");
        expect(strong.getAttribute("data-type")).toBe("strong");
    });

    it("one asterisk means italic", () => {
        const container = render("*italic*");
        expect(container.querySelector(`[${MARK_ATTR}="em"]`)?.textContent).toBe("italic");
    });

    it("three asterisks mean bold italic, strong outside and em inside", () => {
        const container = render("***bold italic***");
        expect(container.querySelector(`[${MARK_ATTR}="strong"] > [${MARK_ATTR}="em"]`)?.textContent).toBe(
            "bold italic",
        );
    });

    it("underscore delimiters behave the same as asterisks", () => {
        expect(countOf(render("__bold__"), "strong")).toBe(1);
        expect(countOf(render("_italic_"), "em")).toBe(1);
    });

    it("two tildes mean strikethrough, one means subscript", () => {
        expect(countOf(render("~~deleted~~"), "s")).toBe(1);
        const sub = render("H~2~O");
        expect(sub.querySelector(`[${MARK_ATTR}="sub"]`)?.textContent).toBe("2");
        expect(sub.textContent).toBe("H~2~O");
    });

    it("equals signs mean highlight, and only in pairs", () => {
        expect(countOf(render("==highlight=="), "mark")).toBe(1);
        expect(countOf(render("=highlight="), "mark")).toBe(0);
    });

    it("one caret means superscript", () => {
        const container = render("2^10^");
        expect(container.querySelector(`[${MARK_ATTR}="sup"]`)?.textContent).toBe("10");
    });

    it("nested emphasis applies at each level", () => {
        const container = render("*italic **bold** italic*");
        expect(countOf(container, "em")).toBe(1);
        expect(container.querySelector(`[${MARK_ATTR}="em"] > [${MARK_ATTR}="strong"]`)?.textContent).toBe("bold");
        expect(container.textContent).toBe("*italic **bold** italic*");
    });

    it("underscores inside a word are not syntax (snake_case / dates)", () => {
        expect(countOf(render("snake_case"), "em")).toBe(0);
        expect(countOf(render("2024_01_01"), "em")).toBe(0);
        expect(countOf(render("a_b_c"), "em")).toBe(0);
    });

    it("a closing delimiter followed by a word character does not close", () => {
        expect(countOf(render("_x_1"), "em")).toBe(0);
    });
});

describe("inline code", () => {
    it("uses SiYuan's own fn__code for color, with no data-type", () => {
        const container = render("`code`");
        const code = container.querySelector(`[${MARK_ATTR}="code"]`) as HTMLElement;
        expect(code.className).toBe("fn__code");
        expect(code.getAttribute("data-type")).toBeNull();
        expect(code.textContent).toBe("code");
    });

    it("syntax inside code is not parsed", () => {
        const container = render("`**not bold**`");
        expect(countOf(container, "strong")).toBe(0);
        expect(container.querySelector(`[${MARK_ATTR}="code"]`)?.textContent).toBe("**not bold**");
    });

    it("an unclosed backtick is emitted literally", () => {
        const container = render("`no end");
        expect(countOf(container, "code")).toBe(0);
        expect(container.textContent).toBe("`no end");
    });

    it("an empty backtick pair produces no code element", () => {
        const container = render("``");
        expect(countOf(container, "code")).toBe(0);
        expect(container.textContent).toBe("``");
    });
});

describe("escapes and unclosed delimiters", () => {
    it("a backslash emits the next character literally and takes it out of pairing", () => {
        const container = render("\\*not italic\\*");
        expect(countOf(container, "em")).toBe(0);
        expect(container.textContent).toBe("\\*not italic\\*");
    });

    it("an escaped delimiter is not treated as a close", () => {
        const container = render("*a \\* b*");
        expect(countOf(container, "em")).toBe(1);
        expect(container.querySelector(`[${MARK_ATTR}="em"]`)?.textContent).toBe("a \\* b");
        expect(container.textContent).toBe("*a \\* b*");
    });

    it("a single trailing backslash is kept literally", () => {
        const container = render("tail\\");
        expect(container.textContent).toBe("tail\\");
    });

    it("a missing closing delimiter is emitted literally", () => {
        const container = render("**unclosed");
        expect(countOf(container, "strong")).toBe(0);
        expect(container.textContent).toBe("**unclosed");
    });

    it("unsupported delimiter lengths are emitted literally", () => {
        const container = render("****four****");
        expect(container.querySelectorAll("span")).toHaveLength(0);
        expect(container.textContent).toBe("****four****");
    });

    it("an opener followed by whitespace does not open", () => {
        expect(countOf(render("* x*"), "em")).toBe(0);
    });

    it("a closer preceded by whitespace does not close", () => {
        expect(countOf(render("*x *"), "em")).toBe(0);
    });
});

describe("textContent invariant", () => {
    const samples = [
        "plain title",
        "**bold**",
        "*italic*",
        "***bold italic***",
        "~~deleted~~ and ~subscript~ and ^superscript^",
        "==highlight==",
        "`code` and **bold**",
        "snake_case and a_b_c",
        "\\*escaped\\* and \\`backtick\\`",
        "**unclosed *also *nested**",
        "mixed ~~deleted **bold** deleted~~ end",
        "Chinese **bold** Chinese",
        "=single equals= and ^single caret",
        "*a **b** c*",
        "trailing **",
    ];

    samples.forEach((sample) => {
        it(`text stays identical after rendering: ${sample}`, () => {
            expect(render(sample).textContent).toBe(sample);
        });
    });
});

describe("INLINE_MARKDOWN_CSS", () => {
    it("hides the delimiters and keeps code segments from wrapping extra", () => {
        expect(INLINE_MARKDOWN_CSS).toContain(`[${MARK_ATTR}="marker"]`);
        expect(INLINE_MARKDOWN_CSS).toContain("display: none");
        expect(INLINE_MARKDOWN_CSS).toContain("white-space: inherit");
        expect(INLINE_MARKDOWN_CSS).toContain("word-break: inherit");
    });

    it("every style has its own rule, with colors from SiYuan theme variables", () => {
        ["strong", "em", "s", "mark", "sup", "sub"].forEach((kind) => {
            expect(INLINE_MARKDOWN_CSS).toContain(`[${MARK_ATTR}="${kind}"]`);
        });
        expect(INLINE_MARKDOWN_CSS).toContain("var(--b3-protyle-inline-strong-color)");
        expect(INLINE_MARKDOWN_CSS).toContain("var(--b3-protyle-inline-mark-background)");
    });
});
