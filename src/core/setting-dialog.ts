/**
 * 插件设置面板。
 *
 * 形态与思源内置的插件设置弹窗完全一致：
 * - 单栏纵向滚动，分类（功能 / 界面 / 开发）作为小节标题，不是独立页签
 * - 每一行都是「左侧文案 + 右侧控件」，控件用思源的 b3-* 类
 * - 底部动作区只有「取消 / 保存」，不额外加任何按钮
 *
 * 保存机制：控件改动先落在面板自己的草稿里，点「保存」才写文件并关闭；
 * 点「取消」丢弃草稿。这样设置一定能存下去，也符合原生对话框的语义。
 */
import {
    Dialog,
    confirm,
    showMessage,
} from "siyuan";
import type {Plugin} from "siyuan";
import type {ConfigStore} from "./config";
import type {ControlSnapshot} from "./control";
import {reportError} from "./error";
import type {
    FeatureCategory,
    FeatureConfig,
    FeatureDefinition,
    SettingField,
} from "./types";
import {
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

export type { ControlSnapshot } from "./control";

const CATEGORY_ORDER: FeatureCategory[] = ["function", "ui", "dev"];

const CATEGORY_LABELS: Record<FeatureCategory, string> = {
    function: "category.function",
    ui: "category.ui",
    dev: "category.dev",
};

export interface SettingsPanelOptions {
    plugin: Plugin;
    store: ConfigStore;
    features: FeatureDefinition[];
    controlOf: (id: string) => ControlSnapshot;
}

const isReadonly = (): boolean => Boolean(window.siyuan?.config?.readonly || window.siyuan?.isPublish);

/**
 * 每个控件用「功能 id + 字段 key」复合标识，避免不同功能重名时互相串台。
 *
 * 分隔符必须是可打印字符：这里最终会写进 HTML 属性，
 * 而 HTML 解析器会把属性里的 U+0000 换成 U+FFFD（实测会变成 65533），
 * 于是 id 永远匹配不上、草稿也永远查不到——这正是此前「保存后依旧是默认值」的根因。
 * 功能 id 只允许小写字母/数字/连字符，字段 key 只允许字母/数字/下划线，
 * 因此 "::" 不会与任何一侧冲突。用 indexOf 取第一个分隔符，
 * 即使 key 里含 "::" 也能正确切分。
 */
const BIND_SEPARATOR = "::";
const bindKey = (featureId: string, key: string): string => `${featureId}${BIND_SEPARATOR}${key}`;
const parseBindKey = (value: string): [string, string] => {
    const index = value.indexOf(BIND_SEPARATOR);
    return index < 0 ?
        [value, ""] :
        [value.slice(0, index), value.slice(index + BIND_SEPARATOR.length)];
};

/** 打开后这段时间内的 blur 视为弹窗自身的焦点变化，不作为「窗口失焦」处理。 */
const IGNORE_BLUR_MS = 600;

/** 思源确认弹窗的特征（dialog/index.ts 与 confirmDialog.ts 的实际实现）。 */
const CONFIRM_SELECTOR = "[data-key='dialogConfirm']";

export class SettingsPanel {
    private readonly options: SettingsPanelOptions;
    private dialog?: Dialog;
    private drafts = new Map<string, FeatureConfig>();
    private openedAt = 0;
    private windowWatcherBound = false;

    constructor(options: SettingsPanelOptions) {
        this.options = options;
    }

    get isOpen(): boolean {
        return Boolean(this.dialog);
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

    /** 当前分类下要显示设置界面的功能（showUi 为真）。 */
    private visibleFeatures(category: FeatureCategory): FeatureDefinition[] {
        return this.options.features.filter((feature) =>
            feature.category === category && this.options.controlOf(feature.id).showUi
        );
    }

    // ------------------------------------------------------------ 生命周期

    show(): void {
        if (this.dialog) {
            return;
        }
        ensurePanelCss();
        this.openedAt = Date.now();
        const features = this.visibleFeaturesAll();
        this.drafts = new Map(features.map((feature) => [feature.id, {...this.options.store.get(feature.id)}]));

        this.dialog = new Dialog({
            title: this.options.plugin.displayName || this.options.plugin.name,
            // 注意：宿主的 Dialog 不会自动生成动作区，取消/保存必须由 content 自带，
            // 否则弹窗里根本没有保存按钮。
            content: `<div class="b3-dialog__content">
    <div class="${PANEL_CLASS}"><div class="ss-panel__scroll"></div></div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel" data-ss-cancel type="button">${
                escapeHtml(this.t("dialog.cancel", window.siyuan.languages.cancel))
            }</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text" data-ss-save type="button">${
                escapeHtml(this.t("dialog.save", window.siyuan.languages.save))
            }</button>
</div>`,
            width: isMobileFrontend() ? "92vw" : "768px",
            height: "80vh",
            destroyCallback: () => {
                this.dialog = undefined;
                this.drafts = new Map();
            },
        });

        this.render();
        this.bindActions();
        this.bindWindowWatcher();

        if (isReadonly()) {
            showMessage(this.t("panel.readonlyTip"), 5000);
        }
    }

    /** 插件被禁用/重载/卸载时收掉面板；幂等。 */
    close(): void {
        this.dialog?.destroy();
    }

    /**
     * 面板打开期间窗口失焦（去复制设置、切到别的应用）时不留下失效弹窗：
     * 失焦后窗口重新获得焦点、而思源确认弹窗并不在场，说明用户已经离开过设置面板。
     */
    private bindWindowWatcher(): void {
        if (this.windowWatcherBound) {
            return;
        }
        this.windowWatcherBound = true;
        window.addEventListener("blur", () => {
            if (!this.dialog || Date.now() - this.openedAt < IGNORE_BLUR_MS) {
                return;
            }
            window.addEventListener("focus", () => {
                if (this.dialog && !document.querySelector(CONFIRM_SELECTOR)) {
                    this.close();
                }
            }, {once: true});
        });
    }

    // ------------------------------------------------------------ 渲染

    /** 面板里会出现的全部功能：showUi 为真。 */
    private visibleFeaturesAll(): FeatureDefinition[] {
        return this.options.features.filter((feature) => this.options.controlOf(feature.id).showUi);
    }

    private render(): void {
        const scroll = this.dialog?.element.querySelector<HTMLElement>(".ss-panel__scroll");
        if (!scroll) {
            return;
        }
        const readonly = isReadonly();
        const sections: string[] = [];
        CATEGORY_ORDER.forEach((category) => {
            const features = this.visibleFeatures(category);
            if (features.length === 0) {
                return;
            }
            sections.push(
                `<div class="ss-panel__section"><div class="ss-panel__section-name">${
                    escapeHtml(this.t(CATEGORY_LABELS[category], category))
                }</div></div>`,
            );
            features.forEach((feature) => sections.push(this.featureHtml(feature, readonly)));
        });
        scroll.innerHTML = sections.length > 0 ?
            sections.join("") :
            `<div class="ss-panel__empty">${escapeHtml(this.t("panel.none"))}</div>`;
        this.bindControls(scroll);
    }

    private featureHtml(feature: FeatureDefinition, readonly: boolean): string {
        const draft = this.drafts.get(feature.id) || this.options.store.get(feature.id);
        const body = feature.settings.map((field) => this.fieldHtml(feature, field, draft, readonly)).join("");
        return groupHtml(
            this.nameOf(feature),
            body,
            feature.description ? this.t(feature.description) : "",
        );
    }

    private fieldHtml(
        feature: FeatureDefinition,
        field: SettingField,
        config: FeatureConfig,
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
            default:
                return "";
        }
    }

    // ------------------------------------------------------------ 交互

    private bindControls(scope: HTMLElement): void {
        scope.querySelectorAll<HTMLInputElement>("[data-ss-switch]").forEach((input) => {
            input.addEventListener("change", () => {
                this.stage(input.dataset.ssSwitch as string, input.checked);
            });
        });
        scope.querySelectorAll<HTMLSelectElement>("[data-ss-select]").forEach((select) => {
            select.addEventListener("change", () => {
                this.stage(select.dataset.ssSelect as string, select.value);
            });
        });
        scope.querySelectorAll<HTMLInputElement>("[data-ss-number]").forEach((input) => {
            input.addEventListener("change", () => {
                const value = Number(input.value);
                if (Number.isFinite(value)) {
                    this.stage(input.dataset.ssNumber as string, value);
                }
            });
        });
        scope.querySelectorAll<HTMLInputElement>("[data-ss-text]").forEach((input) => {
            input.addEventListener("change", () => {
                this.stage(input.dataset.ssText as string, input.value);
            });
        });
    }

    /**
     * 暂存一次控件变更，只改内存里的草稿，不落盘。
     *
     * 正常路径下草稿在打开面板时就建好了；缺草稿属于异常，此时补建一份而不是丢弃，
     * 保证用户改过的东西一定能进到「保存」里，同时打出告警便于定位。
     */
    private stage(encodedKey: string, value: unknown): void {
        const [featureId, key] = parseBindKey(encodedKey);
        let draft = this.drafts.get(featureId);
        if (!draft) {
            const feature = this.options.features.find((item) => item.id === featureId);
            if (!feature) {
                console.warn(`[some-settings-siyuan] 控件 "${encodedKey}" 找不到对应功能，改动被丢弃`);
                return;
            }
            console.warn(
                `[some-settings-siyuan] 控件 "${encodedKey}" 缺草稿（当前 ${this.drafts.size} 份），已按已提交配置补建`,
            );
            draft = {...this.options.store.get(featureId)};
            this.drafts.set(featureId, draft);
        }
        draft[key] = value;
    }

    private bindActions(): void {
        const root = this.dialog?.element;
        if (!root) {
            return;
        }
        root.querySelector<HTMLButtonElement>("[data-ss-cancel]")?.addEventListener("click", () => {
            if (this.isDirty()) {
                confirm(
                    this.t("dialog.discardTitle", this.options.plugin.displayName || this.options.plugin.name),
                    this.t("dialog.discardText"),
                    () => this.close(),
                );
                return;
            }
            this.close();
        });
        root.querySelector<HTMLButtonElement>("[data-ss-save]")?.addEventListener("click", () => {
            this.save();
        });
    }

    private isDirty(): boolean {
        return this.changedDrafts() !== null;
    }

    /**
     * 收集与已提交配置不同的草稿；没有改动时返回 null。
     * 草稿与已提交配置都在内存里，比较的是同一批 key。
     */
    private changedDrafts(): Record<string, FeatureConfig> | null {
        const changed: Record<string, FeatureConfig> = {};
        for (const [id, draft] of this.drafts) {
            const current = this.options.store.get(id);
            const keys = new Set([...Object.keys(draft), ...Object.keys(current)]);
            if ([...keys].some((key) => draft[key] !== current[key])) {
                changed[id] = {...draft};
            }
        }
        return Object.keys(changed).length > 0 ? changed : null;
    }

    private save(): void {
        const changed = this.changedDrafts();
        if (!changed) {
            this.close();
            return;
        }
        this.options.store.saveMany(changed).then(() => {
            showMessage(this.t("dialog.saved"), 3000);
            this.close();
        }).catch((error) => {
            // 校验失败或写入读回不一致时都会带出全部问题，一次性提示，面板保持打开
            const problems = (error as {problems?: string[];} | null)?.problems;
            if (problems && problems.length > 0) {
                reportError("settings.save", new Error(problems.join("；")));
                return;
            }
            reportError("settings.save", error);
        });
    }
}
