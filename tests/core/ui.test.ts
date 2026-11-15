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
const tab = {id: "editor" as const, label: "正文", icon: "iconEdit"};

describe("escapeHtml", () => {
    it("转义全部五个 HTML 危险字符", () => {
        expect(escapeHtml("&<>\"'")).toBe("&amp;&lt;&gt;&quot;&#39;");
    });

    it("普通文字原样返回", () => {
        expect(escapeHtml("普通文字 123")).toBe("普通文字 123");
    });

    it("只转一次，生成的实体不会被再转一遍", () => {
        expect(escapeHtml("&")).toBe("&amp;");
        expect(escapeHtml("<")).toBe("&lt;");
        expect(escapeHtml("&lt;")).toBe("&amp;lt;");
    });
});

describe("mainHtml", () => {
    it("标题放进 config-item__main，说明放进 b3-label__text", () => {
        const root = parse(mainHtml("标题", "说明"));
        expect(root.querySelector(".config-item__main")?.textContent).toBe("标题说明");
        expect(root.querySelector(".b3-label__text")?.textContent).toBe("说明");
    });

    it("没有说明时不生成说明块", () => {
        expect(query(mainHtml("标题"), ".b3-label__text")).toBeNull();
    });

    it("文案里的 HTML 被转义", () => {
        expect(mainHtml("<b>x</b>")).toContain("&lt;b&gt;x&lt;/b&gt;");
    });
});

describe("页签结构", () => {
    it("桌面端是左侧列表，带 role=tablist", () => {
        const root = parse(tabSideHtml("<li></li>"));
        expect(root.querySelector(`.${PANEL_CLASS}__side.b3-list`)?.getAttribute("role")).toBeNull();
        expect(root.querySelector(`.${PANEL_CLASS}__tabs`)?.getAttribute("role")).toBe("tablist");
        expect(root.querySelector("li")).not.toBeNull();
    });

    it("移动端是顶部页签栏，用内核的 layout-tab-bar", () => {
        const root = parse(tabBarHtml("<div></div>"));
        expect(root.querySelector(".layout-tab-bar.fn__flex.fn__flex-shrink")).not.toBeNull();
    });

    it("内容区容器包住每一页", () => {
        const root = parse(tabViewsHtml("", tabPaneHtml("editor", "body", true)));
        expect(root.querySelector(`.${PANEL_CLASS}__views > .${PANEL_CLASS}__panes > .${PANEL_CLASS}__view`))
            .not.toBeNull();
    });

    it("搜索框排在页签容器之前，无结果提示跟在页签后面", () => {
        const root = parse(tabViewsHtml(
            searchBoxHtml("搜索...", "清空搜索"),
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

describe("搜索框与分组标题", () => {
    it("搜索框是 text 类型，不用浏览器的原生清除按钮（样式不受主题控制）", () => {
        const input = query<HTMLInputElement>(searchBoxHtml("搜索...", "清空搜索"), "input")!;
        expect(input.getAttribute("type")).toBe("text");
        expect(input.dataset.ssSearch).toBe("1");
        expect(input.getAttribute("placeholder")).toBe("搜索...");
        expect(input.getAttribute("aria-label")).toBe("搜索...");
        // 不做自动聚焦、不自动补全
        expect(input.hasAttribute("autofocus")).toBe(false);
        expect(input.getAttribute("autocomplete")).toBe("off");
    });

    it("一键清空按钮在输入框内部右侧，用思源内置的 iconClose，默认收起", () => {
        const root = parse(searchBoxHtml("搜索...", "清空搜索"));
        const field = root.querySelector(`.${PANEL_CLASS}__search-field`);
        const clear = field?.querySelector<HTMLButtonElement>("[data-ss-search-clear]");
        expect(clear).not.toBeNull();
        const button = clear as HTMLButtonElement;
        // 与输入框同一格，按钮排在输入框之后（绝对定位在它内部右侧）
        expect(button.previousElementSibling?.tagName).toBe("INPUT");
        expect(button.getAttribute("type")).toBe("button");
        expect(button.getAttribute("aria-label")).toBe("清空搜索");
        expect(button.getAttribute("title")).toBe("清空搜索");
        expect(button.querySelector("use")?.getAttribute("xlink:href")).toBe("#iconClose");
        // 没有内容时不出现
        expect(button.classList.contains("fn__none")).toBe(true);
    });

    it("搜索框的占位文案与按钮标签都被转义", () => {
        expect(searchBoxHtml("<b>x</b>", "<i>y</i>")).toContain("&lt;b&gt;x&lt;/b&gt;");
        expect(searchBoxHtml("<b>x</b>", "<i>y</i>")).toContain("&lt;i&gt;y&lt;/i&gt;");
    });

    it("分组标题平时收起，带分类 id 供面板显隐", () => {
        const group = query<HTMLElement>(searchGroupHtml("editor", "编辑"), "div")!;
        expect(group.dataset.ssSearchGroup).toBe("editor");
        expect(group.textContent).toBe("编辑");
        expect(group.classList.contains("fn__none")).toBe(true);
    });
});

describe("tabItemHtml", () => {
    it("桌面端：b3-list-item，选中时带 focus 类与 aria-selected", () => {
        const active = query<HTMLElement>(tabItemHtml(tab, true, false), "li")!;
        expect(active.className).toContain("b3-list-item");
        expect(active.className).toContain("b3-list-item--focus");
        expect(active.dataset.ssTab).toBe("editor");
        expect(active.getAttribute("role")).toBe("tab");
        expect(active.getAttribute("tabindex")).toBe("0");
        expect(active.getAttribute("aria-selected")).toBe("true");
        expect(active.querySelector("use")?.getAttribute("xlink:href")).toBe("#iconEdit");
        expect(active.querySelector(".b3-list-item__text")?.textContent).toBe("正文");
    });

    it("桌面端：未选中时不带 focus 类，也不写 aria-selected", () => {
        const idle = query<HTMLElement>(tabItemHtml(tab, false, false), "li")!;
        expect(idle.className).not.toContain("--focus");
        expect(idle.getAttribute("aria-selected")).toBeNull();
    });

    it("移动端：用 item 类、不参与收缩", () => {
        const mobile = query<HTMLElement>(tabItemHtml(tab, true, true), "div")!;
        expect(mobile.className).toContain("item");
        expect(mobile.className).toContain("item--focus");
        expect(mobile.className).not.toContain("b3-list-item");
        expect(mobile.dataset.ssTab).toBe("editor");
        expect(mobile.querySelector(".item__text")?.textContent).toBe("正文");
    });

    it("移动端未选中时不带 focus 类，也不写 aria-selected", () => {
        const idle = query<HTMLElement>(tabItemHtml(tab, false, true), "div")!;
        expect(idle.className).not.toContain("item--focus");
        expect(idle.getAttribute("aria-selected")).toBeNull();
    });

    it("页签文案被转义", () => {
        const html = tabItemHtml({...tab, label: "<x>"}, false, false);
        expect(html).toContain("&lt;x&gt;");
    });
});

describe("tabPaneHtml", () => {
    it("当前页没有 fn__none，其余页带 fn__none", () => {
        const active = query<HTMLElement>(tabPaneHtml("editor", "body", true), "div")!;
        expect(active.classList.contains("fn__none")).toBe(false);
        expect(active.dataset.ssTabPanel).toBe("editor");
        expect(active.getAttribute("role")).toBe("tabpanel");
        expect(active.querySelector(".config-items")?.textContent).toBe("body");

        const idle = query<HTMLElement>(tabPaneHtml("ai", "body", false), "div")!;
        expect(idle.classList.contains("fn__none")).toBe(true);
    });
});

describe("控件本体", () => {
    it("开关：checkbox + b3-switch + data-ss-switch + aria-label", () => {
        const input = query<HTMLInputElement>(switchControlHtml("demo::enabled", "启用", true), "input")!;
        expect(input.type).toBe("checkbox");
        expect(input.className).toContain("b3-switch");
        expect(input.dataset.ssSwitch).toBe("demo::enabled");
        expect(input.getAttribute("aria-label")).toBe("启用");
        expect(input.checked).toBe(true);
        expect(input.disabled).toBe(false);
    });

    it("开关：未选中与禁用", () => {
        const input = query<HTMLInputElement>(switchControlHtml("k", "l", false, true), "input")!;
        expect(input.checked).toBe(false);
        expect(input.hasAttribute("disabled")).toBe(true);
    });

    it("下拉：选项、当前值、禁用", () => {
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

describe("行容器", () => {
    it("功能名那一行：没有控件时是纯文案行", () => {
        const row = query<HTMLElement>(subtitleRowHtml("功能名", "说明"), "div")!;
        expect(row.classList.contains("config-item")).toBe(true);
        expect(row.classList.contains(`${PANEL_CLASS}__sub`)).toBe(true);
        expect(row.dataset.ssRow).toBeUndefined();
    });

    it("功能名那一行：开关跟着功能名走，整行可点", () => {
        const row = query<HTMLElement>(
            subtitleRowHtml("功能名", "说明", {
                key: "demo::enabled",
                html: switchControlHtml("demo::enabled", "启用", true),
                toggles: true,
            }),
            "label",
        )!;
        expect(row.tagName).toBe("LABEL");
        expect(row.dataset.ssRow).toBe("demo::enabled");
        expect(row.querySelector("input")?.getAttribute("data-ss-switch")).toBe("demo::enabled");
    });

    it("功能名那一行：下拉当开关时不能用 label（点文案会拉开下拉）", () => {
        const row = query<HTMLElement>(
            subtitleRowHtml("功能名", "", {key: "demo::scope", html: selectControlHtml("demo::scope", [], "disabled")}),
            "div",
        )!;
        expect(row.tagName).toBe("DIV");
        expect(row.querySelector("select")).not.toBeNull();
    });

    it("开关行带上子行类名，供面板缩进", () => {
        const row = query<HTMLElement>(switchRowHtml("demo::x", "标题", true, "说明"), "label")!;
        expect(row.classList.contains(CHILD_CLASS)).toBe(true);
        expect(row.dataset.ssRow).toBe("demo::x");
        expect(row.querySelector(".b3-label__text")?.textContent).toBe("说明");
    });

    it("下拉行与文本行都是子行", () => {
        expect(query<HTMLElement>(selectRowHtml("demo::m", "标题", [{value: "a", label: "A"}], "a"), "div")!
            .classList.contains(CHILD_CLASS)).toBe(true);
        expect(query<HTMLElement>(textRowHtml("demo::t", "标题", "值"), "div")!.classList.contains(CHILD_CLASS)).toBe(
            true,
        );
    });

    it("数字行：min / max / step 与单位", () => {
        const root = parse(numberRowHtml("demo::n", "标题", 8, {min: 1, max: 10, step: 2, unit: "次"}));
        const input = root.querySelector<HTMLInputElement>("input")!;
        expect(input.type).toBe("number");
        expect(input.value).toBe("8");
        expect(input.getAttribute("min")).toBe("1");
        expect(input.getAttribute("max")).toBe("10");
        expect(input.getAttribute("step")).toBe("2");
        expect(root.querySelector(".config-item__number")).not.toBeNull();
        expect(root.querySelector(".config-item__unit")?.textContent).toBe("次");
    });

    it("数字行：没给界限时属性留空，也不生成单位容器", () => {
        const root = parse(numberRowHtml("demo::n", "标题", 3));
        const input = root.querySelector<HTMLInputElement>("input")!;
        expect(input.getAttribute("min")).toBe("");
        expect(input.getAttribute("step")).toBe("");
        expect(root.querySelector(".config-item__number")).toBeNull();
    });

    it("文本行：值被转义、关掉拼写检查、可带占位文案", () => {
        const root = parse(textRowHtml("demo::t", "标题", 'a"b', {placeholder: "提示"}));
        const input = root.querySelector<HTMLInputElement>("input")!;
        expect(input.type).toBe("text");
        expect(input.value).toBe('a"b');
        expect(input.getAttribute("spellcheck")).toBe("false");
        expect(input.getAttribute("placeholder")).toBe("提示");
    });

    it("多行文本行：textarea 整行铺满，值被转义、行数可配", () => {
        const root = parse(textareaRowHtml("demo::area", "标题", "a\nb</textarea>", {placeholder: "提示", rows: 4}));
        const area = root.querySelector<HTMLTextAreaElement>("textarea")!;
        expect(area.value).toBe("a\nb</textarea>");
        expect(area.getAttribute("rows")).toBe("4");
        expect(area.getAttribute("spellcheck")).toBe("false");
        expect(area.getAttribute("placeholder")).toBe("提示");
        expect(area.dataset.ssTextarea).toBe("demo::area");
        expect(area.className).toContain("fn__block");
        expect(area.closest("div")?.classList.contains(`${PANEL_CLASS}__textarea-row`)).toBe(true);
        expect(area.closest("div")?.classList.contains(CHILD_CLASS)).toBe(true);
    });

    it("多行文本行默认 6 行", () => {
        const area = query<HTMLTextAreaElement>(textareaRowHtml("demo::area", "标题", ""), "textarea")!;
        expect(area.getAttribute("rows")).toBe("6");
        expect(area.value).toBe("");
    });

    it("动作行是 button 元素，不参与表单提交", () => {
        const button = query<HTMLButtonElement>(
            buttonRowHtml("demo::run", "标题", "点我", {description: "说明"}),
            "button",
        )!;
        expect(button.type).toBe("button");
        expect(button.dataset.ssButton).toBe("demo::run");
        expect(button.className).toContain("b3-button--outline");
        expect(button.textContent).toBe("点我");
    });

    it("整块外观撑满 200px 外壳，粉色底 + 现成 SVG 原样内联", () => {
        const root = parse(
            buttonRowHtml("demo::donate", "标题", "给插件开发者捐赠", {
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
        expect(button.textContent.trim()).toBe("给插件开发者捐赠");
        expect(root.querySelector(".fn__size200")?.contains(button)).toBe(true);
    });

    it("整块外观不写 tone 时用主题色，图标同样内联", () => {
        const button = query<HTMLButtonElement>(
            buttonRowHtml("demo::star", "标题", "Star on GitHub", {appearance: "block", icon: "iconGithub"}),
            "button",
        )!;
        expect(button.className).toContain("b3-button");
        expect(button.className).not.toContain("b3-button--pink");
        expect(button.className).toContain("fn__block");
        expect(button.querySelector("use")?.getAttribute("xlink:href")).toBe("#iconGithub");
        expect(button.textContent.trim()).toBe("Star on GitHub");
    });

    it("动作行在只读模式下是 disabled 的", () => {
        const button = query<HTMLButtonElement>(
            buttonRowHtml("demo::run", "标题", "点我", {disabled: true}),
            "button",
        )!;
        expect(button.disabled).toBe(true);
    });
});

describe("noteRowHtml：底部按钮", () => {
    it("不带按钮时整块只有文字", () => {
        const root = parse(noteRowHtml("demo::about", "<div>说明</div>"));
        expect(root.querySelector(".some-settings-panel__note-actions")).toBeNull();
    });

    it("带按钮时是「左侧文字 + 右侧按钮」两栏，各自带绑定标识", () => {
        const root = parse(
            noteRowHtml(
                "demo::about",
                "<div>说明</div>",
                actionButtonHtml("demo::star", "Star on GitHub", {appearance: "block", icon: "iconGithub"}) +
                    actionButtonHtml("demo::donate", "给插件开发者捐赠", {
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
        expect(row.querySelector(".some-settings-panel__note-body")?.textContent).toBe("说明");
        const actions = row.querySelector(".some-settings-panel__note-actions")!;
        const buttons = [...actions.querySelectorAll("button")];
        expect(buttons.map((button) => button.dataset.ssButton)).toEqual(["demo::star", "demo::donate"]);
        expect(buttons[0].className).not.toContain("b3-button--outline");
        expect(buttons[1].className).toContain("b3-button--pink");
    });

    it("没有按钮时文字仍占满整行（不出现空的按钮栏）", () => {
        const root = parse(noteRowHtml("demo::about", "<div>说明</div>"));
        const row = root.querySelector(".some-settings-panel__note")!;
        expect([...row.children].map((child) => child.className)).toEqual(["some-settings-panel__note-body"]);
    });
});

describe("noteBodyHtml", () => {
    it("一行一段，空行被丢掉", () => {
        const root = parse(noteBodyHtml("第一行\n\n   \n第二行"));
        expect([...root.querySelectorAll(".b3-label__text")].map((line) => line.textContent)).toEqual([
            "第一行",
            "第二行",
        ]);
    });

    it("按名字替换占位符", () => {
        expect(parse(noteBodyHtml("版本 {version}", {version: "1.0.1"})).textContent).toBe("版本 1.0.1");
    });

    it("没给值的占位符原样保留", () => {
        expect(parse(noteBodyHtml("版本 {version}")).textContent).toBe("版本 {version}");
    });

    it("http(s) 链接渲染成可点链接，并把地址当文字", () => {
        const anchor = query<HTMLAnchorElement>(
            noteBodyHtml("见 {repo}", {repo: "https://github.com/wmy2981"}),
            "a",
        )!;
        expect(anchor.getAttribute("href")).toBe("https://github.com/wmy2981");
        expect(anchor.getAttribute("target")).toBe("_blank");
        expect(anchor.getAttribute("rel")).toBe("noopener noreferrer");
        expect(anchor.textContent).toBe("https://github.com/wmy2981");
    });

    it("labels 给了短写时用短写，地址仍是完整的", () => {
        const anchor = query<HTMLAnchorElement>(
            noteBodyHtml("见 {repo}", {repo: "https://github.com/wmy2981/x"}, {repo: "仓库"}),
            "a",
        )!;
        expect(anchor.textContent).toBe("仓库");
        expect(anchor.getAttribute("href")).toBe("https://github.com/wmy2981/x");
    });

    it("非 http(s) 的值只当纯文本", () => {
        const root = parse(noteBodyHtml("路径 {path}", {path: "file:///tmp"}));
        expect(root.querySelector("a")).toBeNull();
        expect(root.textContent).toBe("路径 file:///tmp");
    });

    it("文案与替换值里的 HTML 都不会被当成标记", () => {
        const root = parse(noteBodyHtml("<img src=x onerror=1> {v}", {v: "<script>"}));
        expect(root.querySelector("img")).toBeNull();
        expect(root.querySelector("script")).toBeNull();
        expect(root.textContent).toBe("<img src=x onerror=1> <script>");
    });

    it("链接地址里的引号被转义，不会撑破属性", () => {
        const html = noteBodyHtml("{v}", {v: 'https://example.com/?a="b"'});
        expect(html).toContain("&quot;");
        expect(parse(html).querySelector("a")?.getAttribute("href")).toBe('https://example.com/?a="b"');
    });
});

describe("noteRowHtml", () => {
    it("说明块整行铺满，带说明块与子行两个类名", () => {
        const row = query<HTMLElement>(noteRowHtml("demo::about", noteBodyHtml("说明文字")), "div")!;
        expect(row.classList.contains(`${PANEL_CLASS}__note`)).toBe(true);
        expect(row.classList.contains(CHILD_CLASS)).toBe(true);
        expect(row.dataset.ssRow).toBe("demo::about");
        expect(row.querySelector(".b3-label__text")).not.toBeNull();
    });
});

describe("markLastChildRow", () => {
    it("只给最后一行子行加标记，前面那些不动", () => {
        const html = markLastChildRow(switchRowHtml("demo::a", "甲", true) + numberRowHtml("demo::b", "乙", 1));
        const rows = [...parse(html).children] as HTMLElement[];
        expect(rows).toHaveLength(2);
        expect(rows[0].classList.contains(LAST_CHILD_CLASS)).toBe(false);
        expect(rows[1].classList.contains(LAST_CHILD_CLASS)).toBe(true);
        // 原有的类名与取值属性都不受影响
        expect(rows[1].classList.contains(CHILD_CLASS)).toBe(true);
        expect(rows[1].dataset.ssRow).toBe("demo::b");
    });

    it("说明块内部的段落不会被误当成末行", () => {
        const html = markLastChildRow(
            switchRowHtml("demo::a", "甲", true) + noteRowHtml("demo::n", noteBodyHtml("说明")),
        );
        const rows = [...parse(html).children] as HTMLElement[];
        expect(rows[1].classList.contains(LAST_CHILD_CLASS)).toBe(true);
        expect(rows[1].querySelector(".b3-label__text")?.classList.contains(LAST_CHILD_CLASS)).toBe(false);
    });

    it("没有子行时原样返回", () => {
        expect(markLastChildRow("")).toBe("");
    });
});

describe("PANEL_CSS", () => {
    it("子行带层级引导线：竖线与横折都画在子行自己的伪元素上", () => {
        expect(PANEL_CSS).toContain(`.config-items > .${CHILD_CLASS}::before`);
        expect(PANEL_CSS).toContain(`.config-items > .${CHILD_CLASS}::after`);
        expect(PANEL_CSS).toContain(`.config-items > .${LAST_CHILD_CLASS}::before`);
        // 竖线只存在子行上：功能名那一行没有被画出线来
        expect(PANEL_CSS).not.toContain("__sub::before");
    });

    it("功能名那一行不加粗：面板里没有任何字重抬升", () => {
        // 层级只由缩进与引导线表达（回归：曾把 __sub 的标题设为 600）
        expect(PANEL_CSS).not.toMatch(/font-weight:\s*(bold|[5-9]00)/);
    });

    it("搜索时左侧栏靠宽度过渡收起，不是 display:none", () => {
        // display:none 没有过渡，一开一收会硬跳；这里锁住「过渡 + visibility 延时」这套写法
        expect(PANEL_CSS).toContain(`.${PANEL_CLASS}--search > .${PANEL_CLASS}__side {`);
        expect(PANEL_CSS).toContain("transition: width .2s ease, padding .2s ease");
        expect(PANEL_CSS).toContain("visibility 0s linear .2s");
        expect(PANEL_CSS).toContain("@media (prefers-reduced-motion: reduce)");
    });

    it("移动端页签栏收起与桌面端左侧栏同一套过渡：高度从实测值过渡到 0", () => {
        // 高度是内容撑出来的 auto，auto → 0 没法过渡：JS 量好高度写进这个变量当起点
        expect(PANEL_CSS).toContain("height: var(--ss-tabbar-height, auto)");
        expect(PANEL_CSS).toContain(`.${PANEL_CLASS}--search.${PANEL_CLASS}--mobile > .layout-tab-bar {`);
        expect(PANEL_CSS).toContain("transition: height .2s ease, opacity .12s ease");
        // 收起之后才真正隐身（点不到、Tab 不到），展开时立刻可见
        expect(PANEL_CSS).toContain("visibility 0s linear .2s");
    });

    it("移动端搜索框左端对齐页签栏第一项，桌面端窄窗口仍对齐行标题", () => {
        // 页签栏自己 4px + 项 4px = 8px；桌面窄窗口是页签内容 8px + 行 10px = 18px
        expect(PANEL_CSS).toContain(`.${PANEL_CLASS}--mobile > .${PANEL_CLASS}__search {`);
        expect(PANEL_CSS).toContain("padding: 8px 8px 6px;");
        expect(PANEL_CSS).toContain("padding: 8px 10px 6px 18px;");
    });

    it("作用域限定在面板类名下，含移动端与窄屏两套规则", () => {
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

    it("首次调用注入样式表", () => {
        ensurePanelCss();
        expect(cssElement()?.textContent).toBe(PANEL_CSS);
    });

    it("重复调用只有一份，内容不被重复追加", () => {
        ensurePanelCss();
        ensurePanelCss();
        expect(document.querySelectorAll(`#${PANEL_CLASS}-local-css`)).toHaveLength(1);
        expect(cssElement()?.textContent).toBe(PANEL_CSS);
    });

    it("页面里留着旧版本的样式表时重写成本版内容", () => {
        const stale = document.createElement("style");
        stale.id = `${PANEL_CLASS}-local-css`;
        stale.textContent = "/* 旧版本 */";
        document.head.append(stale);
        ensurePanelCss();
        expect(cssElement()?.textContent).toBe(PANEL_CSS);
    });
});

describe("isMobileFrontend", () => {
    it("只在 mobile / browser-mobile 下为真", () => {
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
