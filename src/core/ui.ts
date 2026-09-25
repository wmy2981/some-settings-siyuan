/**
 * 思源原生风格的 UI 基元。
 *
 * 所有类名与结构都刻意对齐内核设置面板的真实渲染器
 * （app/src/config/render/render.ts、fragments.ts、config/tabs/*），
 * 目标是让插件设置面板与「设置」里的原生面板逐像素一致：
 * 左侧文案（标题 + 灰色小字说明）在左，控件靠右固定宽度。
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
export const mainHtml = (title: string, description?: string, nameClass = ""): string =>
    `<div class="fn__flex-1 config-item__main${nameClass}">${escapeHtml(title)}${
        description ? `<div class="b3-label__text">${escapeHtml(description)}</div>` : ""
    }</div>`;

/** 原生分组容器。 */
export const groupHtml = (title: string, bodyHtml: string, description?: string): string =>
    `<div class="config-group">
    ${title ? `<div class="config-title">${escapeHtml(title)}</div>` : ""}
    ${
        description ?
            `<div class="b3-label config-item"><div class="fn__flex-1 config-item__main"><div class="b3-label__text">${
                escapeHtml(description)
            }</div></div></div>` :
            ""
    }
    <div class="config-items">${bodyHtml}</div>
</div>`;

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
 * 面板的全部局部样式：只在插件自己的弹窗作用域内生效。
 *
 * 面板本体不加任何自定义外观——每一行都用思源自己的 b3-* 与 config-* 类。
 * 这里只补内核没有给的两件事：分类标题的间距，以及滚动区的内边距。
 */
export const PANEL_CSS = `
.${PANEL_CLASS} {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
}
.${PANEL_CLASS} .ss-panel__scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 2px 2px 16px;
}
.${PANEL_CLASS} .ss-panel__section {
    padding: 14px 0 6px;
}
.${PANEL_CLASS} .ss-panel__section:first-child {
    padding-top: 2px;
}
.${PANEL_CLASS} .ss-panel__section-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--b3-theme-on-background);
}
.${PANEL_CLASS} .config-group + .config-group {
    margin-top: 6px;
}
.${PANEL_CLASS} .ss-panel__empty {
    padding: 24px 0;
    text-align: center;
    color: var(--b3-theme-on-surface);
    opacity: .7;
}
.${PANEL_CLASS} .config-item:last-child {
    border-bottom: 0;
}

/* 单位标签：窄屏下内核那套 fn__flex-center 会被压成一列一个字，这里改成不换行 */
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
   用媒体查询而不是容器查询：内核给 .b3-dialog__content 的 16px 24px 内边距
   在手机屏上几乎吃掉一半宽度，必须由插件改掉；纯容器查询的后果无法反向影响
   外层那个容器。作用域用容器上的 some-settings-dialog 类限定，不会波及别的弹窗。 */
@media (max-width: 480px) {
    .some-settings-dialog .b3-dialog__content {
        padding: 12px 12px 0;
    }
    .some-settings-dialog .b3-dialog__action {
        padding: 7px 12px;
    }
    .${PANEL_CLASS} .ss-panel__scroll {
        padding: 0 0 12px;
    }
    .${PANEL_CLASS} .ss-panel__section {
        padding: 10px 0 4px;
    }
    /* 文案与控件都由内核加了 .fn__flex 行内样式，必须 !important 才能折行 */
    .${PANEL_CLASS} .config-item {
        flex-wrap: wrap !important;
    }
    .${PANEL_CLASS} .config-item > .config-item__main {
        flex: 1 1 100% !important;
    }
    .${PANEL_CLASS} .config-item > .fn__space {
        display: none;
    }
    .${PANEL_CLASS} .config-item > .fn__size200,
    .${PANEL_CLASS} .config-item > .config-item__number,
    .${PANEL_CLASS} .config-item > .b3-text-field,
    .${PANEL_CLASS} .config-item > .b3-select {
        flex: 1 1 100% !important;
        width: auto !important;
        max-width: none !important;
    }
    .${PANEL_CLASS} .config-item > .b3-switch {
        margin-inline-start: 0 !important;
        margin-top: 6px;
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
