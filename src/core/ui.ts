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
    const control = options.unit ?
        `<div class="fn__size200 fn__flex-center fn__flex config-item__number">${input}<span class="fn__space"></span><span class="ft__on-surface fn__flex-center">${
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
