/**
 * 思源原生风格的 UI 基元。
 *
 * 所有类名与结构都刻意对齐内核设置面板的真实渲染器
 * （app/src/config/render/render.ts、fragments.ts、config/tabs/*），
 * 目标是让插件设置面板与「设置」里的原生面板逐像素一致：
 * 左侧文案（标题 + 灰色小字说明）在左，控件靠右固定宽度。
 *
 * 结构是扁平的两层，与内核设置页同构：
 *
 *   .config
 *     .config-group                    一个分类
 *       .config-title                  「功能 / 界面 / 开发」
 *       .config-items
 *         .b3-label.config-item        功能名小节标题
 *         .b3-label.config-item        设置行
 *         ...                          行与行之间保留内核自带的分割线
 *
 * 没有嵌套分组：任何一层多余的分组容器都会让面板重新长出层级。
 */
import {getFrontend} from "siyuan";

/** 面板内的作用域类名，用于在插件自己的 CSS 里限定样式，不污染全局。 */
export const PANEL_CLASS = "some-settings-panel";

export const isMobileFrontend = (): boolean => {
    const frontend = getFrontend();
    return frontend === "mobile" || frontend === "browser-mobile";
};

export const escapeHtml = (value: string): string =>
    value.replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

/** 原生「主文案 + 说明」块。 */
export const mainHtml = (title: string, description?: string): string =>
    `<div class="fn__flex-1 config-item__main">${escapeHtml(title)}${
        description ? `<div class="b3-label__text">${escapeHtml(description)}</div>` : ""
    }</div>`;

/**
 * 一个分类：小节标题 + 该分类的设置行。
 *
 * 标题与 `.config-items` 是**平级**的兄弟节点，都直接挂在 `.config` 之下——
 * 不再像内核设置页那样包一层 `.config-group`：那层在弹窗里会额外贡献
 * `margin: 24px 16px 16px`，是窄屏上「分类标题到第一行」空隙过大的来源。
 */
export const categoryHtml = (title: string, bodyHtml: string): string =>
    `<div class="config-title">${escapeHtml(title)}</div>
<div class="config-items">${bodyHtml}</div>`;

/**
 * 功能名小节标题。
 *
 * 它就是一行设置行，所以照样带内核的分割线——分割线在功能名与它下面的
 * 第一个设置项之间也必须留着，否则设置项会看起来像挂在功能名上。
 */
export const subtitleRowHtml = (title: string, description?: string): string =>
    `<div class="b3-label config-item ${PANEL_CLASS}__sub">${mainHtml(title, description)}</div>`;

/** 原生风格的开关行。 */
export const switchRowHtml = (
    key: string,
    title: string,
    checked: boolean,
    description?: string,
    disabled = false,
): string =>
    `<label class="fn__flex b3-label config-item" data-ss-row="${escapeHtml(key)}">
    ${mainHtml(title, description)}
    <span class="fn__space"></span>
    <input class="b3-switch fn__flex-center" type="checkbox" data-ss-switch="${escapeHtml(key)}"${
        checked ? " checked" : ""
    }${disabled ? " disabled" : ""}/>
</label>`;

/** 原生风格的下拉行。 */
export const selectRowHtml = (
    key: string,
    title: string,
    options: {value: string; label: string;}[],
    current: string,
    description?: string,
    disabled = false,
): string =>
    `<div class="fn__flex b3-label config-item" data-ss-row="${escapeHtml(key)}">
    ${mainHtml(title, description)}
    <span class="fn__space"></span>
    <select class="b3-select fn__flex-center fn__size200" data-ss-select="${escapeHtml(key)}"${
        disabled ? " disabled" : ""
    }>
    ${
        options.map((option) =>
            `<option value="${escapeHtml(option.value)}"${option.value === current ? " selected" : ""}>${
                escapeHtml(option.label)
            }</option>`
        ).join("")
    }
    </select>
</div>`;

/** 原生风格的数字行，带单位时结构与内核一致。 */
export const numberRowHtml = (
    key: string,
    title: string,
    value: number,
    options: {min?: number; max?: number; step?: number; unit?: string; description?: string; disabled?: boolean;} = {},
): string => {
    const input = `<input class="b3-text-field ${options.unit ? "fn__flex-1" : "fn__flex-center fn__size200"}"
    type="number" data-ss-number="${escapeHtml(key)}" value="${value}"
    min="${typeof options.min === "number" ? options.min : ""}"
    max="${typeof options.max === "number" ? options.max : ""}"
    step="${typeof options.step === "number" ? options.step : ""}"${options.disabled ? " disabled" : ""}/>`;
    // 单位用独立 span 承载（内核用的是 fn__flex-center，窄屏下会被压成一列一个字）
    const control = options.unit ?
        `<div class="fn__size200 fn__flex-center fn__flex config-item__number">${input}<span class="fn__space"></span><span class="config-item__unit ft__on-surface">${
            escapeHtml(options.unit)
        }</span></div>` :
        input;
    return `<div class="fn__flex b3-label config-item" data-ss-row="${escapeHtml(key)}">
    ${mainHtml(title, options.description)}
    <span class="fn__space"></span>
    ${control}
</div>`;
};

/** 原生风格的文本行。 */
export const textRowHtml = (
    key: string,
    title: string,
    value: string,
    options: {placeholder?: string; description?: string; disabled?: boolean;} = {},
): string =>
    `<div class="fn__flex b3-label config-item" data-ss-row="${escapeHtml(key)}">
    ${mainHtml(title, options.description)}
    <span class="fn__space"></span>
    <input class="b3-text-field fn__flex-center fn__size200" type="text" data-ss-text="${escapeHtml(key)}"
    spellcheck="false" value="${escapeHtml(value)}"${
        options.placeholder ? ` placeholder="${escapeHtml(options.placeholder)}"` : ""
    }${options.disabled ? " disabled" : ""}/>
</div>`;

/**
 * 原生风格的动作行：右侧一个 `b3-button--outline`。
 *
 * 只用于「点击即打开某个窗口」这类没有可持久化取值的入口。
 * 按钮不参与草稿：点击立刻执行，不受「取消 / 保存」影响。
 */
export const buttonRowHtml = (
    key: string,
    title: string,
    label: string,
    options: {description?: string; disabled?: boolean;} = {},
): string =>
    `<div class="fn__flex b3-label config-item" data-ss-row="${escapeHtml(key)}">
    ${mainHtml(title, options.description)}
    <span class="fn__space"></span>
    <button class="b3-button b3-button--outline fn__flex-center fn__size200" type="button"
    data-ss-button="${escapeHtml(key)}"${options.disabled ? " disabled" : ""}>${escapeHtml(label)}</button>
</div>`;

/**
 * 面板的全部局部样式：只在插件自己的弹窗作用域内生效。
 *
 * 结构、类名与间距全部照抄「设置页 + 参考插件面板」那套做法，插件只动四件事：
 * - 分类标题与 .config-items 平级（同参考插件），不再多包一层 .config-group
 * - 去掉 .config-items 的灰底大圆角，面板不再有"卡片"这件多余的东西
 * - 文案只有两种角色：设置项名（标题，统一加粗）与说明（统一不加粗、更淡）
 * - 窄屏（≤750px，与内核同一断点）把行内边距压到 8px 10px、内容区压到 8px：
 *   内核给 .b3-label 的 16px 24px 在手机上会吃掉近一半屏宽，这是"边距特别大"的主因
 * 桌面端的行内边距与行间分割线完全交给内核 .b3-label，不做任何覆盖。
 */
export const PANEL_CSS = `
.${PANEL_CLASS} {
    display: block;
}
/* 分类标题：与 .config-items 平级，和设置行共用同一条左对齐线 */
.${PANEL_CLASS} > .config-title {
    margin: 0 0 8px;
    padding: 0 12px;
}
.${PANEL_CLASS} > .config-title ~ .config-title {
    margin-top: 14px;
}
/* 设置行直接排在弹窗内容区里，不要卡片底色与大圆角 */
.${PANEL_CLASS} .config-items {
    background-color: transparent;
    border-radius: 0;
}
/* 面板里的文案只有两种角色：设置项名（标题）与说明。
   标题统一加粗、说明统一不加粗——在此之前，只有功能名是粗体（而且它的说明
   被一起带粗了），设置项名却是常规字重，同一块面板里出现两种「标题」和一种
   被加粗的说明，看起来就是乱的。 */
.${PANEL_CLASS} .config-item__main {
    font-weight: 600;
}
.${PANEL_CLASS} .config-item__main .b3-label__text {
    font-weight: 400;
    color: var(--b3-theme-on-surface);
}
.${PANEL_CLASS} .config-item:last-child,
.${PANEL_CLASS} .config-item--last-visible {
    border-bottom: 0;
}
.${PANEL_CLASS} .ss-panel__empty {
    padding: 18px 12px;
    text-align: center;
    color: var(--b3-theme-on-surface);
    opacity: .7;
}

/* 弹窗容器宽度 -----------------------------------------------------------
   真正的宽度由 setting-dialog.ts 的 applyPanelWidth() 量完视口写成行内样式，
   因为 CSS 这条路已经证实不可靠：Dialog 把宽度写成容器上的行内样式
   （桌面 768px、移动端 92vw），而内核给 .b3-dialog__container 设了
   flex-shrink: 0 —— 行内宽度 + 不收缩，视口一旦更窄容器就整块溢出屏幕。
   这里只留一条兜底：CSS 没生效时也别让它宽过视口。
   必须 !important —— 内核自己也用同优先级的 max-width 声明这一条。 */
.some-settings-dialog.b3-dialog__container {
    max-width: 100% !important;
    min-width: 0;
}

/* 单位标签：内核给 .b3-dialog__content 设了 word-break: break-all，
   容器一旦容不下，连 "ms" 这种两个字母的单位都会被从中间断成两行。
   nowrap 才是止血点（keep-all 只约束 CJK，对 "ms" 无效）。 */
.${PANEL_CLASS} .config-item__unit {
    flex: 0 0 auto;
    white-space: nowrap;
}

/* 窄面板适配 -------------------------------------------------------------
   弹窗宽度由用户拖拽决定，思源给 .config-item__main 的 flex:1 在窄宽度下
   会把文案挤成一列单字。这里给文案一个最小宽度，空间不够就让整行折成
   上下两段（文案在上、控件在下并撑满宽度），而不是把字竖向排开。 */
.${PANEL_CLASS} .config-item,
.${PANEL_CLASS} .config-item__main {
    min-width: 0;
}
.${PANEL_CLASS} label.config-item > .config-item__main:first-child,
.${PANEL_CLASS} div.config-item > .config-item__main:first-child {
    flex: 1 1 12rem;
}
.${PANEL_CLASS} .config-item .fn__size200,
.${PANEL_CLASS} .config-item .config-item__number {
    max-width: 100%;
}
.${PANEL_CLASS} .config-item .b3-select,
.${PANEL_CLASS} .config-item .b3-text-field {
    min-width: 0;
}
.${PANEL_CLASS} .b3-switch {
    margin-inline-start: auto;
}

/* 移动端 / 窄窗口 ---------------------------------------------------------
   断点与内核一致（内核在 750px 以下把 .config-item 折成上下两段、输入框撑满整行）。
   关键是行内边距：内核给 .b3-label 的 16px 24px 在手机上会吃掉近一半屏宽，
   上下各 16px 还会把每行之间撑出 32px 的空隙——这正是"边距特别大"的主因。
   选择器比内核的 .config__tab-container .b3-label 多一级，
   不论样式表加载顺序如何都稳定生效。作用域用容器上的 some-settings-dialog 类限定。 */
@media (max-width: 750px) {
    .some-settings-dialog .b3-dialog__content {
        padding: 8px 8px 0;
    }
    .some-settings-dialog .b3-dialog__action {
        padding: 7px 8px;
    }
    .b3-dialog__body .${PANEL_CLASS} .b3-label.config-item,
    .b3-dialog__body .${PANEL_CLASS} .config-item {
        padding: 8px 10px;
    }
    .b3-dialog__body .${PANEL_CLASS} .config-item__main {
        flex: 1 1 100%;
        margin: 0;
    }
    .b3-dialog__body .${PANEL_CLASS} .config-item > .fn__space {
        display: none;
    }
    .b3-dialog__body .${PANEL_CLASS} .config-item > .fn__size200:not(.b3-switch),
    .b3-dialog__body .${PANEL_CLASS} .config-item > .b3-text-field,
    .b3-dialog__body .${PANEL_CLASS} .config-item > .b3-select {
        width: 100%;
        max-width: 100%;
        margin-top: 6px;
    }
    .b3-dialog__body .${PANEL_CLASS} .config-item__number {
        flex-wrap: nowrap;
    }
    .b3-dialog__body .${PANEL_CLASS} .config-item__number > .b3-text-field {
        width: auto;
        margin-top: 0;
    }
    .${PANEL_CLASS} > .config-title {
        padding: 0 10px;
    }
    .${PANEL_CLASS} > .config-title ~ .config-title {
        margin-top: 12px;
    }
}
`;

const PANEL_CSS_ID = `${PANEL_CLASS}-local-css`;

/** 在当前文档里确保设置面板的局部样式存在（幂等）。 */
export const ensurePanelCss = (): void => {
    if (document.getElementById(PANEL_CSS_ID)) {
        return;
    }
    const element = document.createElement("style");
    element.id = PANEL_CSS_ID;
    element.textContent = PANEL_CSS;
    document.head.append(element);
};
