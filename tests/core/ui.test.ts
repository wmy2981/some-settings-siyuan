/**
 * `core/ui.ts`：思源原生风格的 UI 基元。
 *
 * 这些函数只产出标记字符串，所以断言分两层：结构用 DOM 查询（改成什么样），
 * 转义用字符串比对（有没有把用户文案当 HTML 执行）。
 */
import {
    describe,
    expect,
    it,
} from "vitest";
import {
    actionButtonHtml,
    buttonRowHtml,
    ensurePanelCss,
    escapeHtml,
    isMobileFrontend,
    LAST_CHILD_CLASS,
    mainHtml,
    markLastChildRow,
    noteBodyHtml,
    noteRowHtml,
    numberRowHtml,
    PANEL_CLASS,
    PANEL_CSS,
    searchBoxHtml,
    searchGroupHtml,
    selectControlHtml,
    selectRowHtml,
    subtitleRowHtml,
    switchControlHtml,
    switchRowHtml,
    tabBarHtml,
    tabItemHtml,
    tabPaneHtml,
    tabSideHtml,
    tabViewsHtml,
    textareaRowHtml,
    textRowHtml,
} from "../../src/core/ui";
import {mockState} from "../mocks/siyuan";

const parse = (html: string): HTMLElement => {
    const container = document.createElement("div");
    container.innerHTML = html;
    return container;
};

const query = <T extends HTMLElement>(html: string, selector: string): T | null =>
    parse(html).querySelector<T>(selector);

const CHILD_CLASS = `${PANEL_CLASS}__child`;
const tab = {id: "editor" as const, label: "Body", icon: "iconEdit"};

describe("escapeHtml", () => {
    it("escapes all five dangerous HTML characters", () => {
        expect(escapeHtml("&<>\"'")).toBe("&amp;&lt;&gt;&quot;&#39;");
    });

    it("plain text is returned unchanged", () => {
        expect(escapeHtml("plain text 123")).toBe("plain text 123");
    });

    it("escapes only once, generated entities are not escaped again", () => {
        expect(escapeHtml("&")).toBe("&amp;");
        expect(escapeHtml("<")).toBe("&lt;");
        expect(escapeHtml("&lt;")).toBe("&amp;lt;");
    });
});

describe("mainHtml", () => {
    it("title goes into config-item__main, description into b3-label__text", () => {
        const root = parse(mainHtml("Title", "Description"));
        expect(root.querySelector(".config-item__main")?.textContent).toBe("TitleDescription");
        expect(root.querySelector(".b3-label__text")?.textContent).toBe("Description");
    });

    it("the title is its own config-name block, like the kernel setting rows", () => {
        // 内核给 .config-item__main 14px、给 .config-name 15px：标题必须自占一层，
        // 否则面板标题比原生设置项小一号（`plugin/Setting.ts` 的行标记也是这个结构）
        const root = parse(mainHtml("Title", "Description"));
        const main = root.querySelector(".config-item__main");
        const title = main?.querySelector(":scope > .config-name");
        expect(title?.textContent).toBe("Title");
        // 标题是元素而不是裸文本，说明才排在它下面
        expect(title?.nextElementSibling?.className).toBe("b3-label__text");
        expect(main?.firstChild).toBe(title);
    });

    it("no description block when the description is missing", () => {
        expect(query(mainHtml("Title"), ".b3-label__text")).toBeNull();
    });

    it("HTML in the text is escaped", () => {
        expect(mainHtml("<b>x</b>")).toContain("&lt;b&gt;x&lt;/b&gt;");
    });
});

describe("tab structure", () => {
    it("desktop is a left-hand list with role=tablist", () => {
        const root = parse(tabSideHtml("<li></li>"));
        expect(root.querySelector(`.${PANEL_CLASS}__side.b3-list`)?.getAttribute("role")).toBeNull();
        expect(root.querySelector(`.${PANEL_CLASS}__tabs`)?.getAttribute("role")).toBe("tablist");
        expect(root.querySelector("li")).not.toBeNull();
    });

    it("mobile is a top tab bar using the kernel layout-tab-bar", () => {
        const root = parse(tabBarHtml("<div></div>"));
        expect(root.querySelector(".layout-tab-bar.fn__flex.fn__flex-shrink")).not.toBeNull();
    });

    it("the views container wraps every pane", () => {
        const root = parse(tabViewsHtml("", tabPaneHtml("editor", "body", true)));
        expect(root.querySelector(`.${PANEL_CLASS}__views > .${PANEL_CLASS}__panes > .${PANEL_CLASS}__view`))
            .not.toBeNull();
    });

    it("the search box comes before the tab container and the empty hint follows the tabs", () => {
        const root = parse(tabViewsHtml(
            searchBoxHtml("Search...", "Clear search"),
            tabPaneHtml("editor", "body", true),
            '<div class="empty"></div>',
        ));
        const views = root.querySelector(`.${PANEL_CLASS}__views`);
        expect(views?.children[0]?.className).toContain(`${PANEL_CLASS}__search`);
        expect(views?.children[1]?.className).toContain(`${PANEL_CLASS}__panes`);
        // 无结果提示在页签容器里，跟着结果一起滚
        expect(views?.querySelector(`.${PANEL_CLASS}__panes > .empty`)).not.toBeNull();
    });
});

describe("search box and group heading", () => {
    it("the search box is type text and avoids the native clear button, whose style no theme can reach", () => {
        const input = query<HTMLInputElement>(searchBoxHtml("Search...", "Clear search"), "input")!;
        expect(input.getAttribute("type")).toBe("text");
        expect(input.dataset.ssSearch).toBe("1");
        expect(input.getAttribute("placeholder")).toBe("Search...");
        expect(input.getAttribute("aria-label")).toBe("Search...");
        // 不做自动聚焦、不自动补全
        expect(input.hasAttribute("autofocus")).toBe(false);
        expect(input.getAttribute("autocomplete")).toBe("off");
    });

    it("the clear button sits inside the field on the right, uses the built-in iconClose and hides by default", () => {
        const root = parse(searchBoxHtml("Search...", "Clear search"));
        const field = root.querySelector(`.${PANEL_CLASS}__search-field`);
        const clear = field?.querySelector<HTMLButtonElement>("[data-ss-search-clear]");
        expect(clear).not.toBeNull();
        const button = clear as HTMLButtonElement;
        // 与输入框同一格，按钮排在输入框之后（绝对定位在它内部右侧）
        expect(button.previousElementSibling?.tagName).toBe("INPUT");
        expect(button.getAttribute("type")).toBe("button");
        expect(button.getAttribute("aria-label")).toBe("Clear search");
        expect(button.getAttribute("title")).toBe("Clear search");
        expect(button.querySelector("use")?.getAttribute("xlink:href")).toBe("#iconClose");
        // 没有内容时不出现
        expect(button.classList.contains("fn__none")).toBe(true);
    });

    it("the placeholder text and the button label are both escaped", () => {
        expect(searchBoxHtml("<b>x</b>", "<i>y</i>")).toContain("&lt;b&gt;x&lt;/b&gt;");
        expect(searchBoxHtml("<b>x</b>", "<i>y</i>")).toContain("&lt;i&gt;y&lt;/i&gt;");
    });

    it("the group heading is hidden by default and carries the category id for panel toggling", () => {
        const group = query<HTMLElement>(searchGroupHtml("editor", "Editor"), "div")!;
        expect(group.dataset.ssSearchGroup).toBe("editor");
        expect(group.textContent).toBe("Editor");
        expect(group.classList.contains("fn__none")).toBe(true);
    });
});

describe("tabItemHtml", () => {
    it("desktop: b3-list-item, a selected tab has the focus class and aria-selected", () => {
        const active = query<HTMLElement>(tabItemHtml(tab, true, false), "li")!;
        expect(active.className).toContain("b3-list-item");
        expect(active.className).toContain("b3-list-item--focus");
        expect(active.dataset.ssTab).toBe("editor");
        expect(active.getAttribute("role")).toBe("tab");
        expect(active.getAttribute("tabindex")).toBe("0");
        expect(active.getAttribute("aria-selected")).toBe("true");
        expect(active.querySelector("use")?.getAttribute("xlink:href")).toBe("#iconEdit");
        expect(active.querySelector(".b3-list-item__text")?.textContent).toBe("Body");
    });

    it("desktop: an unselected tab has no focus class and no aria-selected", () => {
        const idle = query<HTMLElement>(tabItemHtml(tab, false, false), "li")!;
        expect(idle.className).not.toContain("--focus");
        expect(idle.getAttribute("aria-selected")).toBeNull();
    });

    it("mobile: uses the item class and does not shrink", () => {
        const mobile = query<HTMLElement>(tabItemHtml(tab, true, true), "div")!;
        expect(mobile.className).toContain("item");
        expect(mobile.className).toContain("item--focus");
        expect(mobile.className).not.toContain("b3-list-item");
        expect(mobile.dataset.ssTab).toBe("editor");
        expect(mobile.querySelector(".item__text")?.textContent).toBe("Body");
    });

    it("mobile: an unselected tab has no focus class and no aria-selected", () => {
        const idle = query<HTMLElement>(tabItemHtml(tab, false, true), "div")!;
        expect(idle.className).not.toContain("item--focus");
        expect(idle.getAttribute("aria-selected")).toBeNull();
    });

    it("the tab label is escaped", () => {
        const html = tabItemHtml({...tab, label: "<x>"}, false, false);
        expect(html).toContain("&lt;x&gt;");
    });
});

describe("tabPaneHtml", () => {
    it("the active pane lacks fn__none and the other panes carry it", () => {
        const active = query<HTMLElement>(tabPaneHtml("editor", "body", true), "div")!;
        expect(active.classList.contains("fn__none")).toBe(false);
        expect(active.dataset.ssTabPanel).toBe("editor");
        expect(active.getAttribute("role")).toBe("tabpanel");
        expect(active.querySelector(".config-items")?.textContent).toBe("body");

        const idle = query<HTMLElement>(tabPaneHtml("ai", "body", false), "div")!;
        expect(idle.classList.contains("fn__none")).toBe(true);
    });
});

describe("the controls themselves", () => {
    it("switch: checkbox + b3-switch + data-ss-switch + aria-label", () => {
        const input = query<HTMLInputElement>(switchControlHtml("demo::enabled", "Enable", true), "input")!;
        expect(input.type).toBe("checkbox");
        expect(input.className).toContain("b3-switch");
        expect(input.dataset.ssSwitch).toBe("demo::enabled");
        expect(input.getAttribute("aria-label")).toBe("Enable");
        expect(input.checked).toBe(true);
        expect(input.disabled).toBe(false);
    });

    it("switch: unchecked and disabled", () => {
        const input = query<HTMLInputElement>(switchControlHtml("k", "l", false, true), "input")!;
        expect(input.checked).toBe(false);
        expect(input.hasAttribute("disabled")).toBe(true);
    });

    it("select: options, current value, disabled", () => {
        const select = query<HTMLSelectElement>(
            selectControlHtml("demo::mode", [{value: "a", label: "A"}, {value: "b", label: "B"}], "b", true),
            "select",
        )!;
        expect(select.dataset.ssSelect).toBe("demo::mode");
        expect(select.className).toContain("b3-select");
        expect([...select.options].map((option) => option.value)).toEqual(["a", "b"]);
        expect(select.value).toBe("b");
        expect(select.disabled).toBe(true);
    });
});

describe("row containers", () => {
    it("the title row: a plain text row when there is no control", () => {
        const row = query<HTMLElement>(subtitleRowHtml("Feature name", "Description"), "div")!;
        expect(row.classList.contains("config-item")).toBe(true);
        expect(row.classList.contains(`${PANEL_CLASS}__sub`)).toBe(true);
        expect(row.dataset.ssRow).toBeUndefined();
    });

    it("the title row: the switch follows the title and the whole row is clickable", () => {
        const row = query<HTMLElement>(
            subtitleRowHtml("Feature name", "Description", {
                key: "demo::enabled",
                html: switchControlHtml("demo::enabled", "Enable", true),
                toggles: true,
            }),
            "label",
        )!;
        expect(row.tagName).toBe("LABEL");
        expect(row.dataset.ssRow).toBe("demo::enabled");
        expect(row.querySelector("input")?.getAttribute("data-ss-switch")).toBe("demo::enabled");
    });

    it("the title row: a select used as a switch must not be a label, clicking the text would open it", () => {
        const row = query<HTMLElement>(
            subtitleRowHtml("Feature name", "", {
                key: "demo::scope",
                html: selectControlHtml("demo::scope", [], "disabled"),
            }),
            "div",
        )!;
        expect(row.tagName).toBe("DIV");
        expect(row.querySelector("select")).not.toBeNull();
    });

    it("the switch row carries the child class for panel indentation", () => {
        const row = query<HTMLElement>(switchRowHtml("demo::x", "Title", true, "Description"), "label")!;
        expect(row.classList.contains(CHILD_CLASS)).toBe(true);
        expect(row.dataset.ssRow).toBe("demo::x");
        expect(row.querySelector(".b3-label__text")?.textContent).toBe("Description");
    });

    it("the select row and the text row are both child rows", () => {
        expect(query<HTMLElement>(selectRowHtml("demo::m", "Title", [{value: "a", label: "A"}], "a"), "div")!
            .classList.contains(CHILD_CLASS)).toBe(true);
        expect(query<HTMLElement>(textRowHtml("demo::t", "Title", "value"), "div")!.classList.contains(CHILD_CLASS))
            .toBe(
                true,
            );
    });

    it("number row: min / max / step and the unit", () => {
        const root = parse(numberRowHtml("demo::n", "Title", 8, {min: 1, max: 10, step: 2, unit: "times"}));
        const input = root.querySelector<HTMLInputElement>("input")!;
        expect(input.type).toBe("number");
        expect(input.value).toBe("8");
        expect(input.getAttribute("min")).toBe("1");
        expect(input.getAttribute("max")).toBe("10");
        expect(input.getAttribute("step")).toBe("2");
        expect(root.querySelector(".config-item__number")).not.toBeNull();
        expect(root.querySelector(".config-item__unit")?.textContent).toBe("times");
    });

    it("number row: attributes stay empty without bounds and no unit container is created", () => {
        const root = parse(numberRowHtml("demo::n", "Title", 3));
        const input = root.querySelector<HTMLInputElement>("input")!;
        expect(input.getAttribute("min")).toBe("");
        expect(input.getAttribute("step")).toBe("");
        expect(root.querySelector(".config-item__number")).toBeNull();
    });

    it("text row: the value is escaped, spellcheck is off, the placeholder is optional", () => {
        const root = parse(textRowHtml("demo::t", "Title", 'a"b', {placeholder: "Hint"}));
        const input = root.querySelector<HTMLInputElement>("input")!;
        expect(input.type).toBe("text");
        expect(input.value).toBe('a"b');
        expect(input.getAttribute("spellcheck")).toBe("false");
        expect(input.getAttribute("placeholder")).toBe("Hint");
    });

    it("textarea row: the textarea fills the row, the value is escaped, rows are configurable", () => {
        const root = parse(textareaRowHtml("demo::area", "Title", "a\nb</textarea>", {placeholder: "Hint", rows: 4}));
        const area = root.querySelector<HTMLTextAreaElement>("textarea")!;
        expect(area.value).toBe("a\nb</textarea>");
        expect(area.getAttribute("rows")).toBe("4");
        expect(area.getAttribute("spellcheck")).toBe("false");
        expect(area.getAttribute("placeholder")).toBe("Hint");
        expect(area.dataset.ssTextarea).toBe("demo::area");
        expect(area.className).toContain("fn__block");
        expect(area.closest("div")?.classList.contains(`${PANEL_CLASS}__textarea-row`)).toBe(true);
        expect(area.closest("div")?.classList.contains(CHILD_CLASS)).toBe(true);
    });

    it("the textarea row defaults to 6 rows", () => {
        const area = query<HTMLTextAreaElement>(textareaRowHtml("demo::area", "Title", ""), "textarea")!;
        expect(area.getAttribute("rows")).toBe("6");
        expect(area.value).toBe("");
    });

    it("the action row is a button element and does not submit forms", () => {
        const button = query<HTMLButtonElement>(
            buttonRowHtml("demo::run", "Title", "Click me", {description: "Description"}),
            "button",
        )!;
        expect(button.type).toBe("button");
        expect(button.dataset.ssButton).toBe("demo::run");
        expect(button.className).toContain("b3-button--outline");
        expect(button.textContent).toBe("Click me");
    });

    it("the block appearance fills the 200px shell, pink background, ready-made SVG inlined as is", () => {
        const root = parse(
            buttonRowHtml("demo::donate", "Title", "Donate to the plugin author", {
                appearance: "block",
                tone: "pink",
                iconSvg: '<svg viewBox="0 0 32 32"><path fill="#fff"></path></svg>',
            }),
        );
        const button = root.querySelector<HTMLButtonElement>("button")!;
        expect(button.className).not.toContain("b3-button--outline");
        expect(button.className).toContain("b3-button--pink");
        expect(button.className).toContain("fn__block");
        expect(button.dataset.ssButton).toBe("demo::donate");
        expect(button.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 32 32");
        expect(button.querySelector("use")).toBeNull();
        expect(button.textContent.trim()).toBe("Donate to the plugin author");
        expect(root.querySelector(".fn__size200")?.contains(button)).toBe(true);
    });

    it("a block appearance without tone uses the theme color and inlines the icon too", () => {
        const button = query<HTMLButtonElement>(
            buttonRowHtml("demo::star", "Title", "Star on GitHub", {appearance: "block", icon: "iconGithub"}),
            "button",
        )!;
        expect(button.className).toContain("b3-button");
        expect(button.className).not.toContain("b3-button--pink");
        expect(button.className).toContain("fn__block");
        expect(button.querySelector("use")?.getAttribute("xlink:href")).toBe("#iconGithub");
        expect(button.textContent.trim()).toBe("Star on GitHub");
    });

    it("the action row is disabled in read-only mode", () => {
        const button = query<HTMLButtonElement>(
            buttonRowHtml("demo::run", "Title", "Click me", {disabled: true}),
            "button",
        )!;
        expect(button.disabled).toBe(true);
    });
});

describe("noteRowHtml: bottom buttons", () => {
    it("text only when there are no buttons", () => {
        const root = parse(noteRowHtml("demo::about", "<div>Description</div>"));
        expect(root.querySelector(".some-settings-panel__note-actions")).toBeNull();
    });

    it("with buttons it is a two-column layout of text left and buttons right, each with its binding id", () => {
        const root = parse(
            noteRowHtml(
                "demo::about",
                "<div>Description</div>",
                actionButtonHtml("demo::star", "Star on GitHub", {appearance: "block", icon: "iconGithub"}) +
                    actionButtonHtml("demo::donate", "Donate to the plugin author", {
                        appearance: "block",
                        tone: "pink",
                        iconSvg: '<svg viewBox="0 0 32 32"><path fill="#fff"></path></svg>',
                    }),
            ),
        );
        const row = root.querySelector(".some-settings-panel__note")!;
        // 与其它行同构：文字占一栏，按钮那一栏排在同一行的右侧
        expect([...row.children].map((child) => child.className)).toEqual([
            "some-settings-panel__note-body",
            "some-settings-panel__note-actions",
        ]);
        expect(row.querySelector(".some-settings-panel__note-body")?.textContent).toBe("Description");
        const actions = row.querySelector(".some-settings-panel__note-actions")!;
        const buttons = [...actions.querySelectorAll("button")];
        expect(buttons.map((button) => button.dataset.ssButton)).toEqual(["demo::star", "demo::donate"]);
        expect(buttons[0].className).not.toContain("b3-button--outline");
        expect(buttons[1].className).toContain("b3-button--pink");
    });

    it("without buttons the text still fills the row and no empty button column appears", () => {
        const root = parse(noteRowHtml("demo::about", "<div>Description</div>"));
        const row = root.querySelector(".some-settings-panel__note")!;
        expect([...row.children].map((child) => child.className)).toEqual(["some-settings-panel__note-body"]);
    });
});

describe("noteBodyHtml", () => {
    it("one paragraph per line, blank lines are dropped", () => {
        const root = parse(noteBodyHtml("First line\n\n   \nSecond line"));
        expect([...root.querySelectorAll(".b3-label__text")].map((line) => line.textContent)).toEqual([
            "First line",
            "Second line",
        ]);
    });

    it("placeholders are replaced by name", () => {
        expect(parse(noteBodyHtml("Version {version}", {version: "1.0.1"})).textContent).toBe("Version 1.0.1");
    });

    it("placeholders without a value are kept as is", () => {
        expect(parse(noteBodyHtml("Version {version}")).textContent).toBe("Version {version}");
    });

    it("http(s) links render as clickable anchors with the address as text", () => {
        const anchor = query<HTMLAnchorElement>(
            noteBodyHtml("See {repo}", {repo: "https://github.com/wmy2981"}),
            "a",
        )!;
        expect(anchor.getAttribute("href")).toBe("https://github.com/wmy2981");
        expect(anchor.getAttribute("target")).toBe("_blank");
        expect(anchor.getAttribute("rel")).toBe("noopener noreferrer");
        expect(anchor.textContent).toBe("https://github.com/wmy2981");
    });

    it("labels use the short form when given and the address stays complete", () => {
        const anchor = query<HTMLAnchorElement>(
            noteBodyHtml("See {repo}", {repo: "https://github.com/wmy2981/x"}, {repo: "Repository"}),
            "a",
        )!;
        expect(anchor.textContent).toBe("Repository");
        expect(anchor.getAttribute("href")).toBe("https://github.com/wmy2981/x");
    });

    it("values that are not http(s) stay plain text", () => {
        const root = parse(noteBodyHtml("Path {path}", {path: "file:///tmp"}));
        expect(root.querySelector("a")).toBeNull();
        expect(root.textContent).toBe("Path file:///tmp");
    });

    it("HTML in the text and in replacement values is never treated as markup", () => {
        const root = parse(noteBodyHtml("<img src=x onerror=1> {v}", {v: "<script>"}));
        expect(root.querySelector("img")).toBeNull();
        expect(root.querySelector("script")).toBeNull();
        expect(root.textContent).toBe("<img src=x onerror=1> <script>");
    });

    it("quotes in a link address are escaped and do not break the attribute", () => {
        const html = noteBodyHtml("{v}", {v: 'https://example.com/?a="b"'});
        expect(html).toContain("&quot;");
        expect(parse(html).querySelector("a")?.getAttribute("href")).toBe('https://example.com/?a="b"');
    });
});

describe("noteRowHtml", () => {
    it("the note block fills the row and has both the note and the child class", () => {
        const row = query<HTMLElement>(noteRowHtml("demo::about", noteBodyHtml("Description text")), "div")!;
        expect(row.classList.contains(`${PANEL_CLASS}__note`)).toBe(true);
        expect(row.classList.contains(CHILD_CLASS)).toBe(true);
        expect(row.dataset.ssRow).toBe("demo::about");
        expect(row.querySelector(".b3-label__text")).not.toBeNull();
    });
});

describe("markLastChildRow", () => {
    it("only the last child row is marked and the earlier ones are left alone", () => {
        const html = markLastChildRow(switchRowHtml("demo::a", "A", true) + numberRowHtml("demo::b", "B", 1));
        const rows = [...parse(html).children] as HTMLElement[];
        expect(rows).toHaveLength(2);
        expect(rows[0].classList.contains(LAST_CHILD_CLASS)).toBe(false);
        expect(rows[1].classList.contains(LAST_CHILD_CLASS)).toBe(true);
        // 原有的类名与取值属性都不受影响
        expect(rows[1].classList.contains(CHILD_CLASS)).toBe(true);
        expect(rows[1].dataset.ssRow).toBe("demo::b");
    });

    it("paragraphs inside the note block are not mistaken for the last row", () => {
        const html = markLastChildRow(
            switchRowHtml("demo::a", "A", true) + noteRowHtml("demo::n", noteBodyHtml("Description")),
        );
        const rows = [...parse(html).children] as HTMLElement[];
        expect(rows[1].classList.contains(LAST_CHILD_CLASS)).toBe(true);
        expect(rows[1].querySelector(".b3-label__text")?.classList.contains(LAST_CHILD_CLASS)).toBe(false);
    });

    it("returns the input unchanged when there are no child rows", () => {
        expect(markLastChildRow("")).toBe("");
    });
});

describe("PANEL_CSS", () => {
    it("child rows carry level guides: the vertical line and the elbow are drawn on the child row pseudo-elements", () => {
        expect(PANEL_CSS).toContain(`.config-items > .${CHILD_CLASS}::before`);
        expect(PANEL_CSS).toContain(`.config-items > .${CHILD_CLASS}::after`);
        expect(PANEL_CSS).toContain(`.config-items > .${LAST_CHILD_CLASS}::before`);
        // 竖线只存在子行上：功能名那一行没有被画出线来
        expect(PANEL_CSS).not.toContain("__sub::before");
    });

    it("the title row is not bold: the panel never raises font weight", () => {
        // 层级只由缩进与引导线表达（回归：曾把 __sub 的标题设为 600）
        expect(PANEL_CSS).not.toMatch(/font-weight:\s*(bold|[5-9]00)/);
    });

    it("searching collapses the side list with a width transition rather than display:none", () => {
        // display:none 没有过渡，一开一收会硬跳；这里锁住「过渡 + visibility 延时」这套写法
        expect(PANEL_CSS).toContain(`.${PANEL_CLASS}--search > .${PANEL_CLASS}__side {`);
        expect(PANEL_CSS).toContain("transition: width .2s ease, padding .2s ease");
        expect(PANEL_CSS).toContain("visibility 0s linear .2s");
        expect(PANEL_CSS).toContain("@media (prefers-reduced-motion: reduce)");
    });

    it("the mobile tab bar collapses with the same transition as the desktop side list: height animates from the measured value to 0", () => {
        // 高度是内容撑出来的 auto，auto → 0 没法过渡：JS 量好高度写进这个变量当起点
        expect(PANEL_CSS).toContain("height: var(--ss-tabbar-height, auto)");
        expect(PANEL_CSS).toContain(`.${PANEL_CLASS}--search.${PANEL_CLASS}--mobile > .layout-tab-bar {`);
        expect(PANEL_CSS).toContain("transition: height .2s ease, opacity .12s ease");
        // 收起之后才真正隐身（点不到、Tab 不到），展开时立刻可见
        expect(PANEL_CSS).toContain("visibility 0s linear .2s");
    });

    it("on mobile the search box aligns with the first tab and in narrow desktop windows it still aligns with the row title", () => {
        // 页签栏自己 4px + 项 4px = 8px；桌面窄窗口是页签内容 8px + 行 10px = 18px
        expect(PANEL_CSS).toContain(`.${PANEL_CLASS}--mobile > .${PANEL_CLASS}__search {`);
        expect(PANEL_CSS).toContain("padding: 8px 8px 6px;");
        expect(PANEL_CSS).toContain("padding: 8px 10px 6px 18px;");
    });

    it("scoped under the panel class and covers both the mobile and narrow-screen rules", () => {
        expect(PANEL_CSS).toContain(`.${PANEL_CLASS} {`);
        expect(PANEL_CSS).toContain(`.${PANEL_CLASS}--mobile`);
        expect(PANEL_CSS).toContain("@media (max-width: 750px)");
        expect(PANEL_CSS).toContain(`.config-items > .${CHILD_CLASS}`);
        expect(PANEL_CSS).toContain(".some-settings-dialog.b3-dialog__container");
    });
});

describe("ensurePanelCss", () => {
    const cssElement = (): HTMLStyleElement | null =>
        document.getElementById(`${PANEL_CLASS}-local-css`) as HTMLStyleElement | null;

    it("the first call injects the stylesheet", () => {
        ensurePanelCss();
        expect(cssElement()?.textContent).toBe(PANEL_CSS);
    });

    it("repeated calls leave one stylesheet and do not append the content twice", () => {
        ensurePanelCss();
        ensurePanelCss();
        expect(document.querySelectorAll(`#${PANEL_CLASS}-local-css`)).toHaveLength(1);
        expect(cssElement()?.textContent).toBe(PANEL_CSS);
    });

    it("a stylesheet left over from an older version is rewritten with the current content", () => {
        const stale = document.createElement("style");
        stale.id = `${PANEL_CLASS}-local-css`;
        stale.textContent = "/* old version */";
        document.head.append(stale);
        ensurePanelCss();
        expect(cssElement()?.textContent).toBe(PANEL_CSS);
    });
});

describe("isMobileFrontend", () => {
    it("is true only for mobile and browser-mobile", () => {
        mockState.frontend = "mobile";
        expect(isMobileFrontend()).toBe(true);
        mockState.frontend = "browser-mobile";
        expect(isMobileFrontend()).toBe(true);
        mockState.frontend = "desktop";
        expect(isMobileFrontend()).toBe(false);
        mockState.frontend = "desktop-window";
        expect(isMobileFrontend()).toBe(false);
    });
});
