/**
 * 插件设置面板。
 *
 * 结构与参考插件的面板同构：`.b3-dialog__content > .config > (页签 + .config-items)*`，
 * 滚动交给每一页自己的 `.some-settings-panel__view`，插件不额外套滚动容器。
 *
 * - 三个分类（功能 / 界面 / 关于）各是一个页签，没有内容的不出现
 * - 桌面端是弹窗左侧的一列页签（照抄内核设置的 `.config__side`），
 *   移动端是弹窗顶部的一条页签栏（照抄内核代码片段弹窗的 `.layout-tab-bar`）
 * - 每一页里第一行是功能名与说明，随后就是设置行，**没有任何嵌套分组**
 * - 每一行都是「左侧文案 + 右侧控件」，控件用思源的 b3-* 类
 * - 行与行之间保留内核 `.b3-label` 自带的分割线，只有整页的最后一行去掉
 * - 底部动作区只有「取消 / 保存」，不额外加任何按钮
 *
 * 保存机制：控件改动先落在面板自己的草稿里，点「保存」才写文件并关闭；
 * 点「取消」丢弃草稿。这样设置一定能存下去，也符合原生对话框的语义。
 *
 * 生命周期同样只有显式入口：取消、保存、插件卸载（外加内核自己的 Esc）。
 * **不监听窗口失焦，也不监听 `document` 可见性** —— 两者都不等于「用户离开了」，
 * 详见 `docs/experience.md` 里的第 12 条。
 */
import {
    Dialog,
    confirm,
    showMessage,
} from "siyuan";
import type {Plugin} from "siyuan";
import type {ConfigStore} from "./config";
import type {ControlSnapshot} from "./control";
import {
    guardAsync,
    reportError,
} from "./error";
import type {
    FeatureActionContext,
    FeatureCategory,
    FeatureConfig,
    FeatureDefinition,
    SettingField,
} from "./types";
import {
    buttonRowHtml,
    ensurePanelCss,
    escapeHtml,
    isMobileFrontend,
    noteBodyHtml,
    noteRowHtml,
    numberRowHtml,
    PANEL_CLASS,
    type PanelTab,
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
    textRowHtml,
} from "./ui";

export type { ControlSnapshot } from "./control";

const CATEGORY_ORDER: FeatureCategory[] = ["function", "ui", "about"];

const CATEGORY_LABELS: Record<FeatureCategory, string> = {
    function: "category.function",
    ui: "category.ui",
    about: "category.about",
};

/** 页签条目上表示「当前选中」的类名：桌面端与移动端各一个。 */
const TAB_FOCUS_CLASSES = ["b3-list-item--focus", "item--focus"];

/**
 * 页签图标（思源内置 symbol 名）。
 *
 * 分类与图标的对应只在这里维护：功能是插件带来的增强，界面是外观，关于是插件自身的信息与维护手段。
 */
const CATEGORY_ICONS: Record<FeatureCategory, string> = {
    function: "iconSparkles",
    ui: "iconTheme",
    about: "iconInfo",
};

export interface SettingsPanelOptions {
    plugin: Plugin;
    store: ConfigStore;
    features: FeatureDefinition[];
    controlOf: (id: string) => ControlSnapshot;
}

const isReadonly = (): boolean => Boolean(window.siyuan?.config?.readonly || window.siyuan?.isPublish);

/**
 * 打开说明块里的外链。
 *
 * 思源把「跳转前可否决」做成了插件事件：内核的 `openLink` 会 `emit("open-link", …)`，
 * 任一插件 `preventDefault()` 就取消本次跳转 —— 本插件的「外链跳转前确认」正是这样拦下来的。
 * 说明块里的链接是插件自己渲染的 `<a>`，走不到内核那条路，所以这里按同样的顺序补问一次；
 * 没人拦下时才用思源重写过的 `window.open`（桌面端交给系统浏览器，移动端交给原生桥）。
 */
const openExternalLink = (href: string, event: MouseEvent): void => {
    const detail = {href, originalHref: href, event};
    for (const plugin of window.siyuan?.ws?.app?.plugins ?? []) {
        if (plugin.eventBus?.emit("open-link", detail) === false) {
            return;
        }
    }
    window.open(href, "_blank");
};

/** 窄屏阈值，与内核折行 .config-item 的断点一致。 */
const NARROW_WIDTH = 750;
/** 窄屏时视口两侧各留的空白。 */
const NARROW_GUTTER = 24;
/** 面板的最小可用宽度，比这更窄排版就没意义了。 */
const MIN_PANEL_WIDTH = 280;
/** 宽屏下的面板宽度上限。桌面端是「侧栏 + 内容」两栏，侧栏那 220px 直接吃掉行宽，
 *  所以上限比单栏的移动端放宽一档（内核自己的设置弹窗也是这样，上限 900px）。 */
const MAX_PANEL_WIDTH = 768;
const MAX_DESKTOP_PANEL_WIDTH = 900;

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
 * 一个页签是一张 `.config-items` 卡片，但它的行要跨功能拼出来，
 * CSS 的 :last-child 只能看见 DOM 里的最后一个元素，所以由这里显式标记。
 * 认的是最后一份带 `config-item` 这个整词的 class 属性：说明块这类行内部还有自己的元素与
 * class（段落是 `b3-label__text`），照着最后一个 class 属性下手会标记到段落的头上。
 */
const markLastRow = (rowsHtml: string): string => {
    const pattern = /class="([^"]*)"/g;
    let index = -1;
    let match = pattern.exec(rowsHtml);
    while (match) {
        if (match[1].split(/\s+/).includes("config-item")) {
            index = match.index;
        }
        match = pattern.exec(rowsHtml);
    }
    if (index < 0) {
        return rowsHtml;
    }
    const head = rowsHtml.slice(0, index + 'class="'.length);
    const tail = rowsHtml.slice(index + 'class="'.length);
    return `${head}config-item--last-visible ${tail}`;
};

/** 视口变化轮询间隔。 */
const VIEWPORT_POLL_MS = 250;

export class SettingsPanel {
    private readonly options: SettingsPanelOptions;
    private dialog?: Dialog;
    private drafts = new Map<string, FeatureConfig>();
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
     * 当前分类（页签）下要显示设置界面的功能。
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
        const features = this.visibleFeaturesAll();
        const mobile = isMobileFrontend();
        this.drafts = new Map(features.map((feature) => [feature.id, {...this.options.store.get(feature.id)}]));

        this.dialog = new Dialog({
            title: this.options.plugin.displayName || this.options.plugin.name,
            // 注意：宿主的 Dialog 不会自动生成动作区，取消/保存必须由 content 自带，
            // 否则弹窗里根本没有保存按钮。
            // 面板根节点在这里就带上布局类：页签的两种外观（桌面端左侧列表 / 移动端顶部页签栏）
            // 由它决定，render() 只管往里填内容。
            content: `<div class="b3-dialog__content">
    <div class="config ${PANEL_CLASS} ${PANEL_CLASS}--tabs${mobile ? ` ${PANEL_CLASS}--mobile` : ""}"></div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel" data-ss-cancel type="button">${
                escapeHtml(this.t("dialog.cancel", window.siyuan.languages.cancel))
            }</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text" data-ss-save type="button">${
                escapeHtml(this.t("dialog.save", window.siyuan.languages.save))
            }</button>
</div>`,
            width: mobile ? "92vw" : "768px",
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
        const maxWidth = isMobileFrontend() ? MAX_PANEL_WIDTH : MAX_DESKTOP_PANEL_WIDTH;
        const width = Math.max(
            Math.min(narrow ? viewport - NARROW_GUTTER : viewport - 48, maxWidth),
            MIN_PANEL_WIDTH,
        );
        container.style.width = `${width}px`;
        container.style.maxWidth = `${width}px`;
        container.style.minWidth = "0";

        // 内边距同样不能交给媒体查询：它挂在 .some-settings-dialog 作用下，
        // 类一旦没挂上就整段落空（实测真机就是这样，padding 一直是内核的 16px 24px）。
        // 这两处都由 JS 直接写行内样式，和宽度走同一条已被证实生效的路径。
        //
        // 内容区取 0 内边距、不滚动：页签结构自己撑满这块地方，
        // 滚动交给每一页（`.some-settings-panel__view`），页签栏才不会被一起滚走。
        const content = container.querySelector<HTMLElement>(".b3-dialog__content");
        const action = container.querySelector<HTMLElement>(".b3-dialog__action");
        if (content) {
            content.style.padding = "0";
            content.style.overflow = "hidden";
        }
        // 动作区窄屏取 8px：内核的 16px 24px 在手机上会吃掉近一半屏宽。
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

    // ------------------------------------------------------------ 渲染

    /**
     * 面板里会出现的全部功能：只看 showUi。
     * 前端与宿主版本的判定已经由 activeFeatures() 统一做过，这里不重复判定。
     */
    private visibleFeaturesAll(): FeatureDefinition[] {
        return this.options.features.filter((feature) => this.options.controlOf(feature.id).showUi);
    }

    private render(): void {
        // 面板直接落在弹窗内容区里（与参考插件同构），滚动交给 .b3-dialog__content，
        // 不再自己套一层滚动容器——多一层就多一份内边距。
        const panel = this.dialog?.element.querySelector<HTMLElement>(`.${PANEL_CLASS}`);
        if (!panel) {
            return;
        }
        const readonly = isReadonly();
        const mobile = isMobileFrontend();
        const tabs: PanelTab[] = [];
        const panes: string[] = [];
        CATEGORY_ORDER.forEach((category) => {
            const features = this.visibleFeatures(category);
            if (features.length === 0) {
                return;
            }
            // 一页是一张连续的行列表：功能名与它下面的设置行全部平铺在一起，
            // 因此「哪一行是最后一行」要跨功能判定，不能交给 :last-child。
            const rows: string[] = [];
            features.forEach((feature) => {
                const draft = this.drafts.get(feature.id) || this.options.store.get(feature.id);
                // 功能自己的开关跟着功能名走，不单独占一行；剩下的才是它的参数
                const toggle = feature.settings.find(
                    (field): field is Extract<SettingField, {kind: "switch";}> =>
                        field.kind === "switch" && field.key === "enabled",
                );
                // 拿 selector 当开关的功能（声明了 isEnabled）没有 enabled 开关，
                // 那个 selector 就是它的开关，同样提到功能名那一行，不另起一行。
                // 只有 select 型才会被提上来：别的控件不是「开关」这个角色的写法。
                const inlineSelect = !toggle && feature.isEnabled ?
                    feature.settings.find((field): field is Extract<SettingField, {kind: "select";}> =>
                        field.kind === "select"
                    ) :
                    undefined;
                const inline = toggle ?
                    {
                        key: bindKey(feature.id, toggle.key),
                        html: switchControlHtml(
                            bindKey(feature.id, toggle.key),
                            this.t(toggle.title),
                            Boolean(draft[toggle.key]),
                            readonly,
                        ),
                        toggles: true,
                    } :
                    inlineSelect && {
                        key: bindKey(feature.id, inlineSelect.key),
                        html: selectControlHtml(
                            bindKey(feature.id, inlineSelect.key),
                            this.selectOptionsOf(inlineSelect),
                            String(draft[inlineSelect.key] ?? inlineSelect.default),
                            readonly,
                        ),
                    };
                rows.push(
                    subtitleRowHtml(
                        this.nameOf(feature),
                        feature.description ? this.t(feature.description) : "",
                        inline || undefined,
                    ),
                );
                feature.settings
                    .filter((field) => field !== toggle && field !== inlineSelect)
                    .forEach((field) => rows.push(this.fieldHtml(feature, field, draft, readonly)));
            });
            // 页签只在这里出现一次：顺序、文案与图标都由这一处决定，默认打开第一个有内容的页签
            tabs.push({
                id: category,
                label: this.t(CATEGORY_LABELS[category], category),
                icon: CATEGORY_ICONS[category],
            });
            panes.push(tabPaneHtml(category, markLastRow(rows.join("")), tabs.length === 1));
        });
        if (tabs.length === 0) {
            panel.innerHTML = `<div class="${PANEL_CLASS}__empty">${escapeHtml(this.t("panel.none"))}</div>`;
            this.bindControls(panel);
            return;
        }
        const items = tabs.map((tab, index) => tabItemHtml(tab, index === 0, mobile)).join("");
        panel.innerHTML = (mobile ? tabBarHtml(items) : tabSideHtml(items)) + tabViewsHtml(panes.join(""));
        this.bindControls(panel);
        this.bindTabs(panel);
    }

    /**
     * 页签的交互：点条目切换，键盘上与内核设置页一致 —— 回车与空格都算。
     * 条目自带 `tabindex="0"`，所以 Tab 键能在页签之间移动。
     */
    private bindTabs(scope: HTMLElement): void {
        scope.querySelectorAll<HTMLElement>("[data-ss-tab]").forEach((item) => {
            const id = item.dataset.ssTab as string;
            item.addEventListener("click", () => this.activateTab(id));
            item.addEventListener("keydown", (event) => {
                if (event.isComposing || (event.key !== "Enter" && event.key !== " ")) {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                this.activateTab(id);
            });
        });
    }

    /**
     * 切到某个页签。
     *
     * 桌面端与移动端用的是两套标记，选中类也各有一个（`b3-list-item--focus` /
     * `item--focus`），这里同时切换两者：另一套类名在当前结构里没有任何样式，无害，
     * 换来的是这一段不必知道面板此刻是哪种布局。
     */
    private activateTab(id: string): void {
        const root = this.dialog?.element;
        if (!root) {
            return;
        }
        root.querySelectorAll<HTMLElement>("[data-ss-tab]").forEach((item) => {
            const active = item.dataset.ssTab === id;
            TAB_FOCUS_CLASSES.forEach((name) => item.classList.toggle(name, active));
            item.setAttribute("aria-selected", String(active));
        });
        root.querySelectorAll<HTMLElement>("[data-ss-tab-panel]").forEach((pane) => {
            pane.classList.toggle("fn__none", pane.dataset.ssTabPanel !== id);
        });
    }

    /**
     * 下拉的候选集。功能自己那一行与参数行都要用它，所以只在这里算一次。
     * 候选集可以在打开面板时才算出来（笔记本、插件列表这类运行时数据）；
     * 两者同时给出时以动态来源为准，避免静态列表与真实数据打架。
     */
    private selectOptionsOf(field: Extract<SettingField, {kind: "select";}>): {value: string; label: string;}[] {
        const raw = field.optionsProvider ? field.optionsProvider() : (field.options ?? []);
        return raw.map((option) => ({value: option.value, label: this.t(option.label)}));
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
                    this.selectOptionsOf(field),
                    String(config[field.key] ?? field.default),
                    field.description ? this.t(field.description) : "",
                    readonly,
                );
            case "note":
                // 只读说明块：没有取值，只把 i18n 文案里的 {version} / {repo} 之类的占位符填上
                return noteRowHtml(
                    bindKey(feature.id, field.key),
                    noteBodyHtml(this.t(field.text), field.values, field.labels),
                );
            case "button":
                return buttonRowHtml(
                    bindKey(feature.id, field.key),
                    this.t(field.title),
                    // 函数型 label 自己取 i18n，返回值就是文案；字符串型仍是 i18n key
                    typeof field.label === "function" ? field.label(this.actionContext()) : this.t(field.label),
                    {
                        description: field.description ? this.t(field.description) : "",
                        // 动作行在只读/发布模式下不提供，避免点了没有反应
                        disabled: readonly,
                    },
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
                        // 单位同样按 i18n key 解析：像 "px" 这种查不到的会原样返回，
                        // 而 "kernelAutoReconnect.times" 这种才能翻成「次」/ "times"。
                        // 以前这里直接把 key 当字面量渲染，面板上真的会显示那串 key。
                        unit: field.unit ? this.t(field.unit) : undefined,
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
        // 说明块里的链接：不让 <a> 走默认跳转 —— 移动端 WebView 可能把整个前端导航走。
        scope.querySelectorAll<HTMLAnchorElement>(`.${PANEL_CLASS}__note a[href]`).forEach((anchor) => {
            anchor.addEventListener("click", (event) => {
                event.preventDefault();
                openExternalLink(anchor.href, event);
            });
        });
        // 动作行：点击立刻执行，不进草稿，因此不受「取消 / 保存」影响
        scope.querySelectorAll<HTMLButtonElement>("[data-ss-button]").forEach((button) => {
            button.addEventListener("click", () => {
                const encoded = button.dataset.ssButton as string;
                const [featureId, key] = parseBindKey(encoded);
                const field = this.options.features
                    .find((feature) => feature.id === featureId)
                    ?.settings.find((item) => item.kind === "button" && item.key === key);
                if (!field || field.kind !== "button") {
                    console.warn(`[some-settings-siyuan] action row "${encoded}" has no matching onClick, ignoring it`);
                    return;
                }
                guardAsync(`${featureId}.${key}`, () => Promise.resolve(field.onClick(this.actionContext())));
            });
        });
    }

    /**
     * 动作行能拿到的平台能力。动作行不参与挂载，拿不到 FeatureHost，
     * 所以它需要的东西只能由面板在这里现搭一个。
     */
    private actionContext(): FeatureActionContext {
        return {
            i18n: (key: string) => this.t(key),
            clearAllConfigs: () => this.options.store.clearAll(),
            exportConfigs: () => this.options.store.exportAll(),
            importConfigs: (config: Record<string, unknown>) => this.options.store.importMany(config),
        };
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
                console.warn(
                    `[some-settings-siyuan] control "${encodedKey}" has no matching feature, change discarded`,
                );
                return;
            }
            // 正常情况下草稿已在 show() 里建好；走到这里说明两者判定不一致，
            // 补建一份以免用户改过的东西被丢掉，同时留一条可检索的错误。
            console.error(
                `[some-settings-siyuan] control "${encodedKey}" has no draft (currently ${this.drafts.size}), rebuilt from the saved config`,
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
