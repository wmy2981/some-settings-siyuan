/**
 * 插件设置面板。
 *
 * 三分类（功能 / 界面 / 开发）在左侧，右侧按功能分组渲染设置项；
 * 显隐完全由 feature-control.json 的四态决定。
 *
 * 与原生 Setting 组件的唯一偏差：原生组件是「改完点保存」的一次性弹窗，
 * 而本插件的设置项要求可独立启停/隐藏/重置，所以改为「控件变更即落盘」+
 * 单个关闭按钮。控件外观与原生设置面板逐类对齐。
 */
import {
    Dialog,
    showMessage,
} from "siyuan";
import type {Plugin} from "siyuan";
import type {ConfigStore} from "./config";
import type {ControlSnapshot} from "./control";
import {reportError} from "./error";
import type {
    FeatureCategory,
    FeatureDefinition,
    FeatureHost,
    SettingField,
} from "./types";
import {
    buttonRowHtml,
    ensurePanelCss,
    escapeHtml,
    groupHtml,
    isMobileFrontend,
    mainHtml,
    numberRowHtml,
    PANEL_CLASS,
    selectRowHtml,
    switchRowHtml,
    textRowHtml,
} from "./ui";

/** 面板里某个功能当前的四态快照，用于徽标与片段导出。 */
export type { ControlSnapshot } from "./control";

const CATEGORY_LABELS: Record<FeatureCategory, string> = {
    function: "category.function",
    ui: "category.ui",
    dev: "category.dev",
};

const CATEGORY_ORDER: FeatureCategory[] = ["function", "ui", "dev"];

export interface SettingsPanelOptions {
    plugin: Plugin;
    store: ConfigStore;
    features: FeatureDefinition[];
    controlOf: (id: string) => ControlSnapshot;
}

const isReadonly = (): boolean => Boolean(window.siyuan?.config?.readonly || window.siyuan?.isPublish);

/** 每个控件用「功能 id + 字段 key」复合标识，避免不同功能重名时互相串台。 */
const bindKey = (featureId: string, key: string): string => `${featureId}\u0000${key}`;
const parseBindKey = (value: string): [string, string] => {
    const index = value.indexOf("\u0000");
    return index < 0 ? [value, ""] : [value.slice(0, index), value.slice(index + 1)];
};

const copyText = async (text: string): Promise<boolean> => {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {
        // 回落到 execCommand
    }
    try {
        const area = document.createElement("textarea");
        area.value = text;
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.append(area);
        area.select();
        const ok = document.execCommand("copy");
        area.remove();
        return ok;
    } catch {
        return false;
    }
};

export class SettingsPanel {
    private readonly options: SettingsPanelOptions;
    private readonly hosts = new Map<string, FeatureHost>();
    private dialog?: Dialog;
    private activeCategory: FeatureCategory = "function";

    constructor(options: SettingsPanelOptions) {
        this.options = options;
    }

    get isOpen(): boolean {
        return Boolean(this.dialog);
    }

    /** bootstrap 把已挂载功能的 host 注册进来，供 action 型设置项复用。 */
    registerHost(id: string, host: FeatureHost): void {
        this.hosts.set(id, host);
    }

    private t(key: string, fallback?: string): string {
        const value = this.options.plugin.i18n?.[key];
        if (typeof value === "string" && value) {
            return value;
        }
        return fallback ?? key;
    }

    private nameOf(feature: FeatureDefinition): string {
        return this.t(feature.name, feature.id);
    }

    private readonlyFeatures(category: FeatureCategory): FeatureDefinition[] {
        return this.options.features.filter((feature) =>
            feature.category === category && this.options.controlOf(feature.id).showUi
        );
    }

    private hiddenCount(category: FeatureCategory): number {
        return this.options.features.filter((feature) =>
            feature.category === category && !this.options.controlOf(feature.id).showUi
        ).length;
    }

    show(): void {
        if (this.dialog) {
            return;
        }
        ensurePanelCss();
        this.dialog = new Dialog({
            title: this.options.plugin.displayName || this.options.plugin.name,
            content: `<div class="${PANEL_CLASS}${isMobileFrontend() ? ` ${PANEL_CLASS}--mobile` : ""}">
    <div class="ss-panel__body">
        <div class="ss-panel__nav" data-ss-nav></div>
        <div class="ss-panel__main" data-ss-main></div>
    </div>
    <div class="ss-panel__footer">
        <div class="ss-panel__hint" data-ss-hint></div>
        <button class="b3-button b3-button--outline fn__flex-center fn__size200" data-ss-copy type="button"></button>
    </div>
</div>`,
            width: isMobileFrontend() ? "92vw" : "768px",
            height: "80vh",
            destroyCallback: () => {
                this.dialog = undefined;
            },
        });
        this.renderNav();
        this.renderCategory();
        this.bindFooter();
        if (isReadonly()) {
            showMessage(this.t("panel.readonlyTip", "当前处于只读或发布模式，设置项不可修改。"), 4000);
        }
    }

    private renderNav(): void {
        const nav = this.dialog?.element.querySelector<HTMLElement>("[data-ss-nav]");
        if (!nav) {
            return;
        }
        nav.innerHTML = CATEGORY_ORDER.map((category) => {
            const visible = this.readonlyFeatures(category).length;
            const hidden = this.hiddenCount(category);
            const badge = hidden > 0 ? `${visible}+${hidden}` : String(visible);
            return `<div class="ss-panel__nav-item" data-ss-nav-item="${category}" data-active="${
                category === this.activeCategory
            }">${
                escapeHtml(this.t(CATEGORY_LABELS[category], category))
            }<span class="fn__space"></span><span class="ss-panel__nav-badge">${escapeHtml(badge)}</span></div>`;
        }).join("");
        nav.querySelectorAll<HTMLElement>("[data-ss-nav-item]").forEach((item) => {
            item.addEventListener("click", () => {
                this.activeCategory = item.dataset.ssNavItem as FeatureCategory;
                this.renderNav();
                this.renderCategory();
            });
        });
    }

    private renderCategory(): void {
        const main = this.dialog?.element.querySelector<HTMLElement>("[data-ss-main]");
        if (!main) {
            return;
        }
        const visible = this.readonlyFeatures(this.activeCategory);
        const readonly = isReadonly();
        if (visible.length === 0) {
            main.innerHTML = this.hiddenCount(this.activeCategory) > 0 ?
                `<div class="ss-panel__empty">${
                    escapeHtml(this.t(
                        "panel.allHidden",
                        "该分类下的功能都已在 feature-control.json 中设为不显示",
                    ))
                }</div>` :
                `<div class="ss-panel__empty">${escapeHtml(this.t("panel.none", "该分类下还没有功能"))}</div>`;
        } else {
            main.innerHTML = visible.map((feature) => this.featureHtml(feature, readonly)).join("");
        }
        if (readonly) {
            main.insertAdjacentHTML(
                "afterbegin",
                `<div class="b3-label config-item">${
                    mainHtml(
                        this.t("panel.readonly", "只读模式"),
                        this.t("panel.readonlyTip", "当前处于只读或发布模式，设置项不可修改。"),
                    )
                }</div>`,
            );
        }
        this.bindMain(main);
    }

    private featureHtml(feature: FeatureDefinition, readonly: boolean): string {
        const stored = this.options.store.get(feature.id);
        const body = feature.settings.map((field) => this.fieldHtml(feature, field, stored, readonly)).join("");
        const resetRow = `<div class="fn__flex b3-label config-item">
    ${
            mainHtml(
                this.t("config.reset", "重置本功能配置"),
                this.t("config.resetTip", "删除该功能的 JSON 配置文件并恢复默认值。"),
            )
        }
    <span class="fn__space"></span>
    <button class="b3-button b3-button--outline fn__flex-center fn__size200" data-ss-reset="${
            escapeHtml(feature.id)
        }" type="button"${readonly ? " disabled" : ""}>${escapeHtml(this.t("config.reset", "重置本功能配置"))}</button>
</div>`;
        return groupHtml(this.nameOf(feature), resetRow + body, feature.description ? this.t(feature.description) : "");
    }

    private fieldHtml(
        feature: FeatureDefinition,
        field: SettingField,
        config: Record<string, unknown>,
        readonly: boolean,
    ): string {
        switch (field.kind) {
            case "group": {
                const body = field.children.map((child) => this.fieldHtml(feature, child, config, readonly)).join("");
                if (!body) {
                    return "";
                }
                return `<div class="config-group config-group--nested">
    ${field.title ? `<div class="config-title">${escapeHtml(this.t(field.title))}</div>` : ""}
    ${field.description ? `<div class="b3-label config-item">${mainHtml("", this.t(field.description))}</div>` : ""}
    <div class="config-items">${body}</div>
</div>`;
            }
            case "switch":
                return switchRowHtml(
                    bindKey(feature.id, field.key),
                    this.t(field.title),
                    Boolean(config[field.key]),
                    field.description ? this.t(field.description) : "",
                    readonly,
                );
            case "select":
                return selectRowHtml(
                    bindKey(feature.id, field.key),
                    this.t(field.title),
                    field.options.map((option) => ({value: option.value, label: this.t(option.label)})),
                    String(config[field.key] ?? field.default),
                    field.description ? this.t(field.description) : "",
                    readonly,
                );
            case "number":
                return numberRowHtml(
                    bindKey(feature.id, field.key),
                    this.t(field.title),
                    Number(config[field.key] ?? field.default),
                    {
                        min: field.min,
                        max: field.max,
                        step: field.step,
                        unit: field.unit,
                        description: field.description ? this.t(field.description) : "",
                        disabled: readonly,
                    },
                );
            case "text":
                return textRowHtml(
                    bindKey(feature.id, field.key),
                    this.t(field.title),
                    String(config[field.key] ?? field.default),
                    {
                        placeholder: field.placeholder ? this.t(field.placeholder) : "",
                        description: field.description ? this.t(field.description) : "",
                        disabled: readonly,
                    },
                );
            case "action":
                return buttonRowHtml(
                    bindKey(feature.id, field.key),
                    this.t(field.title),
                    this.t(field.button),
                    field.description ? this.t(field.description) : "",
                );
            default:
                return "";
        }
    }

    private bindMain(scope: HTMLElement): void {
        scope.querySelectorAll<HTMLInputElement>("[data-ss-switch]").forEach((input) => {
            input.addEventListener("change", () => {
                this.apply(input.dataset.ssSwitch as string, input.checked);
            });
        });
        scope.querySelectorAll<HTMLSelectElement>("[data-ss-select]").forEach((select) => {
            select.addEventListener("change", () => {
                this.apply(select.dataset.ssSelect as string, select.value);
            });
        });
        scope.querySelectorAll<HTMLInputElement>("[data-ss-number]").forEach((input) => {
            input.addEventListener("change", () => {
                const value = Number(input.value);
                if (!Number.isFinite(value)) {
                    return;
                }
                this.apply(input.dataset.ssNumber as string, value);
            });
        });
        scope.querySelectorAll<HTMLInputElement>("[data-ss-text]").forEach((input) => {
            input.addEventListener("change", () => {
                this.apply(input.dataset.ssText as string, input.value);
            });
        });
        scope.querySelectorAll<HTMLElement>("[data-ss-action]").forEach((button) => {
            button.addEventListener("click", () => {
                const [featureId, key] = parseBindKey(button.dataset.ssAction as string);
                const feature = this.options.features.find((item) => item.id === featureId);
                const field = feature ? this.findAction(feature, key) : undefined;
                const host = this.hosts.get(featureId);
                if (!field || !host) {
                    return;
                }
                Promise.resolve(field.handler(host)).catch((error) => {
                    reportError(`${featureId}.${key}`, error);
                });
            });
        });
        scope.querySelectorAll<HTMLElement>("[data-ss-reset]").forEach((button) => {
            button.addEventListener("click", () => {
                const id = button.dataset.ssReset as string;
                this.options.store.reset(id).then(() => {
                    this.renderNav();
                    this.renderCategory();
                    showMessage(this.t("config.resetDone", "已重置，配置文件已删除"), 4000);
                }).catch((error) => {
                    reportError(`${id}.reset`, error);
                });
            });
        });
    }

    private findAction(feature: FeatureDefinition, key: string): Extract<SettingField, {kind: "action";}> | undefined {
        const actions: Extract<SettingField, {kind: "action";}>[] = [];
        const visit = (fields: SettingField[]) => {
            fields.forEach((field) => {
                if (field.kind === "action") {
                    actions.push(field);
                } else if (field.kind === "group") {
                    visit(field.children);
                }
            });
        };
        visit(feature.settings);
        return actions.find((field) => field.key === key);
    }

    private apply(encodedKey: string, value: unknown): void {
        const [featureId, key] = parseBindKey(encodedKey);
        this.options.store.patchDeferred(featureId, {[key]: value});
    }

    private bindFooter(): void {
        const copyButton = this.dialog?.element.querySelector<HTMLElement>("[data-ss-copy]");
        const hint = this.dialog?.element.querySelector<HTMLElement>("[data-ss-hint]");
        if (hint) {
            hint.textContent = this.t(
                "panel.hint",
                "改动即时保存。启停与显隐请在仓库根目录的 feature-control.json 中调整后重新加载插件。",
            );
        }
        if (!copyButton) {
            return;
        }
        copyButton.textContent = this.t("panel.copyControl", "复制 feature-control 片段");
        copyButton.addEventListener("click", () => {
            const snippet: Record<string, {state: number;}> = {};
            this.options.features.forEach((feature) => {
                snippet[feature.id] = {state: this.options.controlOf(feature.id).state};
            });
            copyText(JSON.stringify({features: snippet}, null, 2)).then((ok) => {
                showMessage(
                    ok ? this.t("panel.copied", "已复制到剪贴板") : this.t("panel.copyFailed", "复制失败"),
                    4000,
                );
            });
        });
    }
}
