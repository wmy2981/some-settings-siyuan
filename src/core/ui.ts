/**
 * 思源原生风格的 UI 基元。
 *
 * 所有类名刻意取自内核设置面板的真实渲染器
 * （app/src/config/render/render.ts、fragments.ts、config/tabs/*），
 * 目标是让插件设置面板与「设置」里的原生面板在视觉与交互上完全一致。
 */
import type {Plugin} from "siyuan";
import {getFrontend} from "siyuan";

/** 面板内的作用域类名，用于在插件自己的 CSS 里限定样式，不污染全局。 */
export const PANEL_CLASS = "ss-panel";

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

/** 原生风格的按钮行。 */
export const buttonRowHtml = (
    key: string,
    title: string,
    label: string,
    description?: string,
    disabled = false,
): string =>
    `<div class="fn__flex b3-label config-item" data-ss-row="${escapeHtml(key)}">
    ${mainHtml(title, description)}
    <span class="fn__space"></span>
    <button class="b3-button b3-button--outline fn__flex-center fn__size200" data-ss-action="${
        escapeHtml(key)
    }" type="button"${disabled ? " disabled" : ""}>${escapeHtml(label)}</button>
</div>`;

/** 设置面板所需的局部样式，只在插件自己的弹窗作用域内生效。 */
export const PANEL_CSS = `
.${PANEL_CLASS} {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
}
.${PANEL_CLASS} .ss-panel__body {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
}
.${PANEL_CLASS} .ss-panel__nav {
    display: flex;
    flex-direction: column;
    flex: 0 0 148px;
    padding: 8px 0;
    border-right: 1px solid var(--b3-border-color);
    overflow: auto;
}
.${PANEL_CLASS} .ss-panel__nav-item {
    display: flex;
    align-items: center;
    padding: 6px 12px;
    cursor: pointer;
    border-radius: var(--b3-border-radius);
}
.${PANEL_CLASS} .ss-panel__nav-item:hover {
    background-color: var(--b3-theme-surface-lighter);
}
.${PANEL_CLASS} .ss-panel__nav-item[data-active="true"] {
    background-color: var(--b3-theme-surface-lighter);
    color: var(--b3-theme-primary);
}
.${PANEL_CLASS} .ss-panel__nav-item .fn__space {
    width: 8px;
}
.${PANEL_CLASS} .ss-panel__nav-badge {
    margin-left: auto;
    font-size: 12px;
    color: var(--b3-theme-on-surface);
    opacity: .7;
}
.${PANEL_CLASS} .ss-panel__main {
    flex: 1;
    min-width: 0;
    overflow: auto;
    padding: 8px 16px 24px;
}
.${PANEL_CLASS} .ss-panel__footer {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 0 0 auto;
    padding: 8px 16px;
    border-top: 1px solid var(--b3-border-color);
}
.${PANEL_CLASS} .ss-panel__hint {
    flex: 1;
    min-width: 0;
    font-size: 12px;
    color: var(--b3-theme-on-surface);
    opacity: .75;
}
.${PANEL_CLASS} .ss-panel__empty {
    padding: 24px 0;
    text-align: center;
    color: var(--b3-theme-on-surface);
    opacity: .7;
}
.${PANEL_CLASS} .config-item__main.config-name {
    font-weight: 600;
}
.${PANEL_CLASS} .ss-panel__meta {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    color: var(--b3-theme-on-surface);
    font-size: 12px;
}
.${PANEL_CLASS} .ss-panel__meta .fn__flex-1 {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.${PANEL_CLASS} .ss-panel__state {
    flex: 0 0 auto;
    font-family: var(--b3-font-family-code);
}
.${PANEL_CLASS}--mobile .ss-panel__body {
    flex-direction: column;
}
.${PANEL_CLASS}--mobile .ss-panel__nav {
    flex: 0 0 auto;
    flex-direction: row;
    border-right: none;
    border-bottom: 1px solid var(--b3-border-color);
}
.${PANEL_CLASS}--mobile .ss-panel__nav-item {
    flex: 1;
    justify-content: center;
}
.${PANEL_CLASS}--mobile .ss-panel__nav-badge {
    display: none;
}
`;

/** 在当前文档里确保设置面板的局部样式存在（幂等）。 */
export const ensurePanelCss = (): void => {
    const id = `${PANEL_CLASS}-local-css`;
    if (document.getElementById(id)) {
        return;
    }
    const element = document.createElement("style");
    element.id = id;
    element.textContent = PANEL_CSS;
    document.head.append(element);
};

/** 用插件与功能信息生成面板标题：插件显示名 + 功能名。 */
export const panelTitle = (plugin: Plugin): string => plugin.displayName || plugin.name;
