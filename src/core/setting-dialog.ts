/**
 * 插件设置面板。
 *
 * 结构与参考插件的面板同构：`.b3-dialog__content > .config > (分类标题 + .config-items)*`，
 * 滚动交给内核的 `.b3-dialog__content`，插件不额外套滚动容器。
 *
 * - 单栏纵向列表，三个分类（功能 / 界面 / 开发）是小节标题，与设置行平级
 * - 每个分类里第一行是功能名与说明，随后就是设置行，**没有任何嵌套分组**
 * - 每一行都是「左侧文案 + 右侧控件」，控件用思源的 b3-* 类
 * - 行与行之间保留内核 `.b3-label` 自带的分割线，只有整个分类的最后一行去掉
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
import {supportsCurrentFrontend} from "./frontend";
import type {
    FeatureCategory,
    FeatureConfig,
    FeatureDefinition,
    SettingField,
} from "./types";
import {
    categoryHtml,
    ensurePanelCss,
    escapeHtml,
    isMobileFrontend,
    numberRowHtml,
    PANEL_CLASS,
    selectRowHtml,
    subtitleRowHtml,
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

/** 窄屏阈值，与内核折行 .config-item 的断点一致。 */
const NARROW_WIDTH = 750;
/** 窄屏时视口两侧各留的空白。 */
const NARROW_GUTTER = 24;
/** 面板的最小可用宽度，比这更窄排版就没意义了。 */
const MIN_PANEL_WIDTH = 280;
/** 宽屏下的面板宽度上限。 */
const MAX_PANEL_WIDTH = 768;

/** 取布局视口宽度。移动端的 vw 与 innerWidth 在个别内核上会不一致，用 clientWidth 更稳。 */
const viewportWidth = (): number => document.documentElement.clientWidth || window.innerWidth || 0;

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

/**
 * 给一段行 HTML 里最后一行打上「不可见最后一行」标记。
 *
 * 一个分类是一张 .config-items 卡片，但它的行要跨功能拼出来，
 * CSS 的 :last-child 只能看见 DOM 里的最后一个元素，所以由这里显式标记。
 * 取的是一次拼接结果的最后一个 class="，即最后一行自己的 class 属性。
 */
const markLastRow = (rowsHtml: string): string => {
    const index = rowsHtml.lastIndexOf('class="');
    if (index < 0) {
        return rowsHtml;
    }
    const head = rowsHtml.slice(0, index + 'class="'.length);
    const tail = rowsHtml.slice(index + 'class="'.length);
    return `${head}config-item--last-visible ${tail}`;
};

/** 打开后这段时间内的 blur 视为弹窗自身的焦点变化，不作为「窗口失焦」处理。 */
const IGNORE_BLUR_MS = 600;

/** 视口变化轮询间隔。 */
const VIEWPORT_POLL_MS = 250;

/** 思源确认弹窗的特征（dialog/index.ts 与 confirmDialog.ts 的实际实现）。 */
const CONFIRM_SELECTOR = "[data-key='dialogConfirm']";

export class SettingsPanel {
    private readonly options: SettingsPanelOptions;
    private dialog?: Dialog;
    private drafts = new Map<string, FeatureConfig>();
    private openedAt = 0;
    private windowWatcherBound = false;
    private viewportTimer?: number;

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

    /**
     * 当前分类下要显示设置界面的功能。
     * 与建草稿走的是同一个判定，避免出现「渲染了但没草稿」的错位。
     */
    private visibleFeatures(category: FeatureCategory): FeatureDefinition[] {
        return this.visibleFeaturesAll().filter((feature) => feature.category === category);
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
    <div class="config ${PANEL_CLASS}"></div>
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
                this.stopViewportWatch();
            },
        });

        // 面板宽度必须由插件自己定，不能交给 CSS：
        // Dialog 把宽度写成容器上的行内样式（桌面 768px、移动端 92vw），而内核给
        // .b3-dialog__container 设了 flex-shrink: 0。行内宽度 + 不收缩，只要视口
        // 窄于这个宽度，容器就整块溢出屏幕：一侧被裁掉、另一侧贴边，看起来就是
        // 「移动端边距太大」；容器里空间不足又让标题挤成竖排、连 "ms" 都被
        // .b3-dialog__content 的 word-break: break-all 从中间断成两行。
        //
        // 之前两次都靠 CSS（作用域类 + 媒体查询）去纠正，真机上都不生效。
        // 改成：直接量视口，把宽度写成行内样式 —— 不依赖选择器是否命中、
        // 不依赖媒体查询是否按预期触发，行内样式本身优先级最高。
        this.applyPanelWidth();
        this.watchViewport();

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
     * 按当前视口把面板宽度写成容器上的行内样式（唯一可信的宽度来源）。
     *
     * 同时把量到的事实挂到容器属性上：判断「修没修上」只要长按 →「检查元素」，
     * 不必依赖控制台。
     */
    private applyPanelWidth(): void {
        const container = this.dialog?.element.querySelector<HTMLElement>(".b3-dialog__container");
        if (!container) {
            return;
        }
        const viewport = viewportWidth();
        const narrow = viewport <= NARROW_WIDTH;
        const width = Math.max(
            Math.min(narrow ? viewport - NARROW_GUTTER : viewport - 48, MAX_PANEL_WIDTH),
            MIN_PANEL_WIDTH,
        );
        container.style.width = `${width}px`;
        container.style.maxWidth = `${width}px`;
        container.style.minWidth = "0";

        // 内边距同样不能交给媒体查询：它挂在 .some-settings-dialog 作用下，
        // 类一旦没挂上就整段落空（实测真机就是这样，padding 一直是内核的 16px 24px）。
        // 这两处都由 JS 直接写行内样式，和宽度走同一条已被证实生效的路径。
        // 窄屏取 8px：内核的 16px 24px 在手机上会吃掉近一半屏宽。
        const content = container.querySelector<HTMLElement>(".b3-dialog__content");
        const action = container.querySelector<HTMLElement>(".b3-dialog__action");
        if (content) {
            content.style.padding = narrow ? "8px 8px 0" : "16px 24px";
            content.style.overflow = "auto";
        }
        if (action) {
            action.style.padding = narrow ? "7px 8px" : "7px 24px";
        }

        container.dataset.ssViewport = String(viewport);
        container.dataset.ssWidth = String(width);
        container.dataset.ssNarrow = String(narrow);
    }

    /**
     * 面板宽度是按视口算出来的定值，旋转屏幕或改窗口大小后必须重算。
     * 用轮询而不是 resize 事件：移动端部分内核在软键盘弹起/收起时只改布局视口，
     * 不派发（或延迟派发）resize，轮询更可靠；250ms 只为改一个字符串。
     */
    private watchViewport(): void {
        if (this.viewportTimer !== undefined) {
            return;
        }
        let last = viewportWidth();
        this.viewportTimer = window.setInterval(() => {
            if (!this.dialog) {
                return;
            }
            const current = viewportWidth();
            if (Math.abs(current - last) >= 1) {
                last = current;
                this.applyPanelWidth();
            }
        }, VIEWPORT_POLL_MS);
    }

    private stopViewportWatch(): void {
        if (this.viewportTimer === undefined) {
            return;
        }
        window.clearInterval(this.viewportTimer);
        this.viewportTimer = undefined;
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

    /** 面板里会出现的全部功能：showUi 为真，且适用于当前前端。 */
    private visibleFeaturesAll(): FeatureDefinition[] {
        return this.options.features.filter((feature) =>
            this.options.controlOf(feature.id).showUi && supportsCurrentFrontend(feature)
        );
    }

    private render(): void {
        // 面板直接落在弹窗内容区里（与参考插件同构），滚动交给 .b3-dialog__content，
        // 不再自己套一层滚动容器——多一层就多一份内边距。
        const panel = this.dialog?.element.querySelector<HTMLElement>(`.${PANEL_CLASS}`);
        if (!panel) {
            return;
        }
        const readonly = isReadonly();
        const sections: string[] = [];
        CATEGORY_ORDER.forEach((category) => {
            const features = this.visibleFeatures(category);
            if (features.length === 0) {
                return;
            }
            // 一个分类是一张连续的行列表：功能名与它下面的设置行全部平铺在一起，
            // 因此「哪一行是最后一行」要跨功能判定，不能交给 :last-child。
            const rows: string[] = [];
            features.forEach((feature) => {
                const draft = this.drafts.get(feature.id) || this.options.store.get(feature.id);
                rows.push(
                    subtitleRowHtml(
                        this.nameOf(feature),
                        feature.description ? this.t(feature.description) : "",
                    ),
                );
                feature.settings.forEach((field) => rows.push(this.fieldHtml(feature, field, draft, readonly)));
            });
            sections.push(
                categoryHtml(
                    this.t(CATEGORY_LABELS[category], category),
                    markLastRow(rows.join("")),
                ),
            );
        });
        panel.innerHTML = sections.length > 0 ?
            sections.join("") :
            `<div class="ss-panel__empty">${escapeHtml(this.t("panel.none"))}</div>`;
        this.bindControls(panel);
    }

    private fieldHtml(
        feature: FeatureDefinition,
        field: SettingField,
        config: FeatureConfig,
        readonly: boolean,
    ): string {
        switch (field.kind) {
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
            // 正常情况下草稿已在 show() 里建好；走到这里说明两者判定不一致，
            // 补建一份以免用户改过的东西被丢掉，同时留一条可检索的错误。
            console.error(
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
