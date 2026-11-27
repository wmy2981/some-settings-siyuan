/**
 * 插件设置面板。
 *
 * 面板走思源原生的 `Setting`：对话框由宿主创建，插件只往它的正文里填自己的面板，
 * 因此移动端**不需要插件做任何事**就会被新版宿主渲染成底部抽屉（抓手、遮罩、拖动、
 * 返回键、可视视口与键盘避让全部由宿主接管），桌面端仍是居中的设置弹窗。
 *
 * 打开方式跟随用户在「设置 - 应用 - 常规」里的「在独立窗口中打开设置界面」：勾了就按
 * `Setting({openInWindow})` 请宿主把面板开到独立原生窗口里。那一条路径有两个额外约束 ——
 * 对话框**异步**在**另一个窗口的文档**里建出来（`waitForWindowDialog()`），所以面板样式表与
 * 快捷键都按对话框自己的 `ownerDocument` 落位，不借插件所属窗口的 `document`。
 *
 * 结构与参考插件的面板同构：`.b3-dialog__content > .config > (页签 + .config-items)*`。
 *
 * - 每个分类（按作用到的原生功能划分）各是一个页签，没有内容的不出现
 * - 桌面端是弹窗左侧的一列页签（照抄内核设置的 `.config__side`），
 *   移动端是顶部一条可左右滑动的页签栏（照抄内核代码片段弹窗的 `.layout-tab-bar`）
 * - 每一页里第一行是功能名与说明，随后就是设置行，**没有任何嵌套分组**
 * - 每一行都是「左侧文案 + 右侧控件」，控件用思源的 b3-* 类
 * - 行与行之间保留内核 `.b3-label` 自带的分割线，只有整页的最后一行去掉
 * - 没有底部动作区：面板里不出现任何「保存 / 取消」按钮，宿主的动作区整块收起
 *
 * 滚动：桌面端每一页自己滚（`.some-settings-panel__view`），内容区不滚，页签栏不会被滚走；
 * 移动端的抽屉高度由宿主按内容量出来，所以整块面板按自然高度排版、由宿主的内容区滚动，
 * 页签栏吸顶。
 *
 * 保存机制：**改完即落盘**。控件一变就写进该功能自己的配置文件，没有草稿、也没有「保存」，
 * 界面显示的值永远等于磁盘上的值。开关与下拉改一次写一次；文本 / 数字框在打字过程中按静默期
 * 合并写盘，失焦立即写，关面板时把还没落地的那一次补上。写盘失败时 store 已把内存态退回改动
 * 之前，面板再把控件改回磁盘上的值并让错误可见。
 *
 * 搜索：面板内置全局搜索（分类名、功能、设置项一起搜），它只是面板的**过滤机制** ——
 * 开关由 `settings-search` 这个功能承载（默认开启，保持它加入之前的行为），关闭时搜索框
 * 整块收起、快捷键交还宿主，面板内容一点不变。命中时把原来那些页签里的行就地显隐、
 * 拼成一列结果（分类名作为分组标题），**不重建面板**，所以输入框焦点、滚动位置与还在
 * 静默期里的输入都不受影响。
 * 匹配、高亮分段的纯逻辑在 `core/search.ts`；这里只管 DOM 侧的显隐、分组与高亮写入。
 *
 * 生命周期同样只有显式入口：关面板、插件卸载（外加内核自己的 Esc）。关面板时补写待落地的改动。
 * **不监听窗口失焦，也不监听 `document` 可见性** —— 两者都不等于「用户离开了」，
 * 详见 `docs/development.md` 的「交互」一节。
 */
import {
    Setting,
    showMessage,
} from "siyuan";
import type {
    Dialog,
    Plugin,
} from "siyuan";
import type {UnavailableReason} from "./availability";
import {
    isShowUnavailable,
    SHOW_UNAVAILABLE_FEATURE_ID,
    unavailableReasons,
} from "./availability";
import {runPendingClick} from "./click";
import type {ConfigStore} from "./config";
import {
    defaultConfig,
    normalizeConfig,
    storageNameOf,
} from "./config";
import {
    guardAsync,
    guardSilent,
    reportError,
} from "./error";
import {withoutMobileInputFocus} from "./frontend";
import {preheatDialogLayer} from "./layer";
import {openExternalLink} from "./link";
import {createLogger} from "./log";
import type {
    SearchField,
    SearchIndex,
    SearchRecord,
} from "./search";
import {
    fieldOf,
    highlightSegments,
    isSearchEnabled,
    matchIndex,
    parseQuery,
    SEARCH_FEATURE_ID,
} from "./search";
import {
    readStoredFile,
    writeStoredFile,
} from "./storage";
import type {
    FeatureActionContext,
    FeatureCategory,
    FeatureConfig,
    FeatureDefinition,
    SettingField,
} from "./types";
import {FEATURE_CATEGORIES} from "./types";
import {
    actionButtonHtml,
    buttonRowHtml,
    categoryEmptyHtml,
    CHILD_CLASS,
    ensurePanelCss,
    escapeHtml,
    isMobileFrontend,
    LAST_CHILD_CLASS,
    markLastChildRow,
    noteBodyHtml,
    noteRowHtml,
    numberRowHtml,
    PANEL_CLASS,
    type PanelTab,
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
    unavailableReasonRowHtml,
} from "./ui";
// 搜索要把静态文案的**所有语言**都索引进同一个匹配域，而宿主只交出当前语言那一份 i18n，
// 所以这里把全部语言文件一起打进包里：它们本来就是插件自带的，读取时不经过任何运行时 API。
import enLocale from "../i18n/en.json";
import zhLocale from "../i18n/zh-CN.json";
import zhTWLocale from "../i18n/zh-TW.json";
import {categoryKey} from "./i18n-key";

const log = createLogger("core.panel");

const CATEGORY_ORDER: FeatureCategory[] = FEATURE_CATEGORIES;
/** 面板自身的状态与功能配置放在一起，导出、导入和清除时也会一并处理。 */
const PANEL_STATE_ID = "panel-state";
const PANEL_STATE_FILE = storageNameOf(PANEL_STATE_ID);
interface PanelState {
    tab?: string;
}

/** 搜索前的滚动位置：桌面端每页自己滚，移动端滚的是宿主的内容区，两处都要记。 */
interface SearchSnapshot {
    /** 弹窗内容区的滚动位置（移动端整块由它滚）。 */
    content: number;
    /** 页签容器的滚动位置（桌面端搜索时结果列由它滚）。 */
    views: number;
    /** 每一页各自的滚动位置，键是分类 id。 */
    panes: Map<string, number>;
}

/** 页签条目上表示「当前选中」的类名：桌面端与移动端各一个。 */
const TAB_FOCUS_CLASSES = ["b3-list-item--focus", "item--focus"];

/**
 * 页签图标（思源内置 symbol 名），两端都显示。
 *
 * 分类与图标的对应只在这里维护：图标说的是「这个页签改的是哪块原生界面」，
 * 与分类名一一对应，不随某个功能增删而变。
 */
const CATEGORY_ICONS: Record<FeatureCategory, string> = {
    ai: "iconSparkles",
    editor: "iconEdit",
    "doc-tree": "iconFiles",
    appearance: "iconTheme",
    connection: "iconPlugZap",
    settings: "iconSettings",
    bazaar: "iconBazaar",
    plugin: "iconPlugin",
};

export interface SettingsPanelOptions {
    plugin: Plugin;
    store: ConfigStore;
    /** 当前宿主上真正可用的功能（`activeFeatures()`），面板按它们拼页签。 */
    features: FeatureDefinition[];
    /**
     * 整份声明视图（应用用户补丁之后的），用来找出「不可用」的那部分
     * （开发者禁用 / 用户禁用 / 平台不符 / 版本区间不符）。
     *
     * 不传就当作没有不可用功能：面板测试里直接给一份功能清单时不必额外准备第二份。
     */
    allFeatures?: FeatureDefinition[];
}

const isReadonly = (): boolean => Boolean(window.siyuan?.config?.readonly || window.siyuan?.isPublish);

/** 窄屏阈值，与内核折行 .config-item 的断点一致。 */
const NARROW_WIDTH = 750;
/** 窄屏时视口两侧各留的空白。 */
const NARROW_GUTTER = 24;
/** 面板的最小可用宽度，比这更窄排版就没意义了。 */
const MIN_PANEL_WIDTH = 280;
/** 宽屏下的面板宽度上限。桌面端是「侧栏 + 内容」两栏，侧栏那 220px 直接吃掉行宽，
 *  所以上限比单栏的移动端放宽一档（内核自己的设置弹窗也是这样，上限 900px）。 */
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

/** 「这一页最后一行」的标记类名：去掉它多余的下分割线。 */
const LAST_ROW_CLASS = "config-item--last-visible";

/** 行上的面板私有元数据：这一行属于哪个功能。搜索按它显隐整个功能。 */
const ROW_FEATURE_ATTR = "data-ss-feature";

/** 行上的面板私有元数据：这一行属于「不可用」条目。显隐、灰显与搜索都按它认。 */
const UNAVAILABLE_ATTR = "data-ss-unavailable";

/** 不可用条目的行类名：整块灰显、不可操作。 */
const UNAVAILABLE_CLASS = `${PANEL_CLASS}__unavailable`;

/**
 * 搜索结果里「不可用」那一组的页签 id。
 *
 * 它不是一个功能分类：只在搜索时出现，把各分类里不可用的功能汇总到结果最底部，
 * 与现有的分类分组同一套做法（分组标题 + 该组的行）。平时整页收起。
 */
const UNAVAILABLE_PANE_ID = "__unavailable";

/** 「显示不可用的设置」打开时挂在面板根上的状态类（面板此刻的显示模式，测试与调试都认它）。 */
const SHOW_UNAVAILABLE_CLASS = `${PANEL_CLASS}--show-unavailable`;

/** 不可用原因 → i18n key。版本两种原因带 `{version}`，平台那种带 `{platform}`。 */
const REASON_KEYS: Record<UnavailableReason, string> = {
    disabled: "panel.unavailable.disabled",
    userDisabled: "panel.unavailable.userDisabled",
    frontend: "panel.unavailable.frontend",
    minAppVersion: "panel.unavailable.minVersion",
    maxAppVersion: "panel.unavailable.maxVersion",
};

/**
 * 适用端被补丁设成空数组（两端都不适用）时的说明：这时没有端名可以填进 `{platform}`，
 * 直接沿用上一条会渲染成「仅适用于 」，等于什么都没说。
 */
const NO_FRONTEND_KEY = "panel.unavailable.frontendNone";

/**
 * 判断一份 class 属性是不是「一个行」的：行带 `config-item` 这个整词。
 *
 * 说明块这类行内部还有自己的元素与 class（段落是 `b3-label__text`、
 * 数字行是 `config-item__number`），照着别的词下手会改到行内部去。
 */
const isRowClass = (classes: string): boolean => classes.split(/\s+/).includes("config-item");

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
        if (isRowClass(match[1])) {
            index = match.index;
        }
        match = pattern.exec(rowsHtml);
    }
    if (index < 0) {
        return rowsHtml;
    }
    const head = rowsHtml.slice(0, index + 'class="'.length);
    const tail = rowsHtml.slice(index + 'class="'.length);
    return `${head}${LAST_ROW_CLASS} ${tail}`;
};

/**
 * 给一个功能的全部行打上「这一行属于哪个功能」的元数据。
 *
 * 搜索要把「分类 / 功能 / 字段」和 DOM 行对应起来：字段本来就能从 `data-ss-row`
 * （`功能 id::字段 key`）读出来，功能却只在行与行之间隐含 —— 于是这里在拼行时补上。
 * 做法与 `markLastRow()` 一致：只认带 `config-item` 整词的 class 属性，
 * 不会标记到行内部那块文案上，也不依赖任何行构造器的参数（新行类型自动带上）。
 */
const tagRows = (rowsHtml: string, featureId: string): string =>
    rowsHtml.replace(
        /class="([^"]*)"/g,
        (whole: string, classes: string) =>
            isRowClass(classes) ? `${whole} ${ROW_FEATURE_ATTR}="${escapeHtml(featureId)}"` : whole,
    );

/**
 * 把一段行 HTML 里的每一行都标成「不可用」：加类名（灰显）与元数据（显隐、搜索都按它认）。
 *
 * 与 `tagRows()` 同一套做法：只认带 `config-item` 整词的 class 属性，
 * 所以说明块内部的段落不会被一起标记。属性必须加在整个 `class="…"` 之后，
 * 加在引号里会把类名拼坏。
 */
const markUnavailableRows = (rowsHtml: string, hidden = false): string =>
    rowsHtml.replace(
        /class="([^"]*)"/g,
        (whole: string, classes: string) =>
            isRowClass(classes) ?
                `${
                    whole.replace(classes, `${hidden ? "fn__none " : ""}${UNAVAILABLE_CLASS} ${classes}`)
                } ${UNAVAILABLE_ATTR}="1"` :
                whole,
    );

/** `NodeFilter.SHOW_TEXT`：直接写数值，省得依赖全局 NodeFilter（测试环境里不一定有）。 */
const SHOW_TEXT = 4;

/** 命中文字外面那层 `<mark>` 的类名。 */
const HIT_CLASS = `${PANEL_CLASS}__hit`;

/** 搜索结果视图挂在面板根上的状态类。 */
const SEARCH_CLASS = `${PANEL_CLASS}--search`;

/**
 * 移动端页签栏收起 / 展开的过场时长（毫秒），与 `PANEL_CSS` 里那段 `height` 过渡同一个数。
 *
 * 它只用来决定「什么时候把过渡起点那个自定义属性删掉」，不参与动画本身。
 */
const TABBAR_ANIM_MS = 200;

/** 移动端页签栏收起前，把实测高度写进这个自定义属性当 `height` 过渡的起点。 */
const TABBAR_HEIGHT_VAR = "--ss-tabbar-height";

/** 焦点是不是停在「可以输入文字」的控件上：这时 `/` 属于用户要输入的字符，不是快捷键。 */
const isEditingControl = (element: Element | null): boolean => {
    if (!element) {
        return false;
    }
    const tag = element.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (element as HTMLElement).isContentEditable;
};

/**
 * 静态 i18n 文案的其余语言文件。
 *
 * 搜索要把同一个字段的多语言版本当成一个匹配域，而宿主的 `plugin.i18n` 只含当前语言。
 * 各语言文件本来就是插件自带的资源，直接读它们即可，不经过任何运行时 API。
 */
const LOCALE_TEXTS: readonly Record<string, string>[] = [enLocale, zhLocale, zhTWLocale];

/** 视口变化轮询间隔。 */
const VIEWPORT_POLL_MS = 250;

/** 文本 / 数字框的静默期：连续敲字时把改动合并成一次写盘。 */
const TYPING_QUIET_MS = 400;

/**
 * 取对话框里的一个区域（正文区 / 动作区），没有就补一个。
 *
 * 宿主的 `Setting.open()` 正常会建好正文区；补建只是兜底 —— 结构略有差异的宿主版本上
 * 宁可自己补一个，也不能让面板没有正文。节点必须建在**父节点自己那份文档**里：
 * 独立设置窗口模式下对话框不在插件所属窗口的文档中。
 */
const ensureRegion = (parent: HTMLElement, className: string): HTMLElement => {
    const existing = parent.querySelector<HTMLElement>(`.${className}`);
    if (existing) {
        return existing;
    }
    const element = parent.ownerDocument.createElement("div");
    element.className = className;
    parent.append(element);
    return element;
};

/**
 * 宿主的 `Setting` 比 SDK 的类型声明多出几样东西（宿主源码里都是 public）：
 * - 构造参数 `openInWindow`：桌面端在独立原生窗口里打开设置；
 * - `open()` 会把建好的对话框挂在 `setting.dialog` 上（独立窗口模式下由另一个窗口稍后创建）；
 * - `close()` 会按「普通对话框 / 独立设置窗口」分别收掉。
 * 这里只做一处窄类型扩展，不扩散成全局断言。
 */
interface SettingOptions {
    destroyCallback?: () => void;
    openInWindow?: boolean;
}
type SettingWithDialog = Setting & {
    dialog?: Dialog;
    close?: () => void;
};
type SettingConstructor = new(options: SettingOptions) => SettingWithDialog;

/**
 * 用户在「设置 - 应用 - 常规」里勾的「在独立窗口中打开设置界面」
 * （`window.siyuan.config.system.settingsWindow`，仅桌面 Electron 客户端生效）。
 *
 * 仓库固定的 SDK 类型里还没有这个字段（较新的版本才声明），按可选读取：
 * 旧宿主没有它时是 `undefined`，面板照旧开在主窗口的对话框里。
 */
const inSettingsWindowMode = (): boolean =>
    (window.siyuan?.config?.system as {settingsWindow?: boolean;} | undefined)?.settingsWindow === true;

/** 独立设置窗口模式下等它建出对话框的轮询间隔与上限。 */
const SETTINGS_WINDOW_POLL_MS = 50;
const SETTINGS_WINDOW_TIMEOUT_MS = 30000;

/** 按宿主真实的构造参数建 `Setting`：SDK 的类型里还没有 `openInWindow`。 */
const createSetting = (options: SettingOptions): SettingWithDialog =>
    new (Setting as unknown as SettingConstructor)(options);

export class SettingsPanel {
    private readonly options: SettingsPanelOptions;
    private setting?: SettingWithDialog;
    private dialog?: Dialog;
    /**
     * 静默期里还没落盘的改动，键是功能 id。
     *
     * 只收文本 / 数字框的在途输入：开关与下拉改一次写一次，不进这里。
     * 关面板时把这里剩下的内容补写出去。
     */
    private pending = new Map<string, FeatureConfig>();
    /**
     * 用户已经改了、但对应的那次写盘还没回显过的控件（键是编码键 `功能 id::字段 key`，值是改动序号）。
     *
     * 写盘是异步的（`saveData` + 读回校验）：文本 / 数字框在写盘途中继续输入时，新内容只进了
     * `pending`，store 里还是上一批的值。这时若按 store 回写控件，会把用户正在输入的内容覆盖掉，
     * 接着打字还会按被截断的值落盘。所以有在途改动的控件一律不回写，等它自己那次写盘完成再对齐。
     */
    private readonly dirtyControls = new Map<string, number>();
    /** 每次用户改动自增；写盘开始时取一份快照，用来判断「写完之后有没有更新的输入」。 */
    private editSeq = 0;
    private flushTimer?: number;
    /** 插件卸载中：这时不再补写待落地的改动（宿主已经不再接受写入）。 */
    private disposed = false;
    /**
     * 正在整体替换配置（清空 / 导入）。
     *
     * 成功后窗口很快会重新载入，这期间面板上显示的还是替换前的值：继续接受输入
     * 会把旧值当成新值写回文件（替换等于没做）。操作失败时（不会重载）解除封锁。
     */
    private frozen = false;
    private viewportTimer?: number;
    /** 动作行注册的「插件卸载时」清理回调。 */
    private readonly unloadListeners = new Set<() => void>();
    /**
     * 不可用功能在磁盘上的配置，键是功能 id。
     *
     * 它们不进 store（`activeFeatures()` 已经把它们筛掉，既不装载也不挂载），面板只把文件读出来
     * 按实际值灰显，控件依旧 `disabled`。读到之前用声明里的默认值拼行。
     */
    private unavailableConfigs = new Map<string, FeatureConfig>();
    /** 这一次打开是否已经读过不可用功能的配置：只读一次，翻开关时不必再读。 */
    private unavailableConfigsLoaded = false;
    /** 「显示不可用的设置」开关的订阅：开着面板时翻开关，不可用条目立刻显隐。 */
    private toggleUnsubscribe?: () => void;
    /** 「设置面板搜索」开关的订阅：开着面板时翻开关，搜索框立刻显隐。 */
    private searchToggleUnsubscribe?: () => void;
    /** 当前页签；内存里先更新，关闭面板时再落盘。 */
    private currentTab?: FeatureCategory;
    /** 上一次打开面板时从磁盘读到的状态，用来挡掉没有变化的重复写盘。 */
    private storedTab?: FeatureCategory;
    /** 用户已经手动选过页签后，迟到的读盘结果不能再抢回旧页签。 */
    private tabTouched = false;
    /** 连续关闭 / 重开时页签写入按顺序完成，旧写入不能覆盖新值。 */
    private tabWriteQueue: Promise<void> = Promise.resolve();
    /** 面板的这一次打开；异步读盘回来时，旧的打开过程不能覆盖新面板。 */
    private showGeneration = 0;
    /** 页签栏还没量到宽度时，下一帧补滚的那一次。 */
    private revealFrame?: number;
    /** 搜索是否正在生效（结果是「搜索状态」而不是「有没有输入框焦点」）。 */
    private searchActive = false;
    /** 上一次真正过滤用的查询原文：文本没变就不重算，也不清空当前结果。 */
    private searchText = "";
    /** 搜索前的滚动位置，清空搜索时原样还给用户。 */
    private searchSnapshot?: SearchSnapshot;
    /** 面板打开期间挂在 document 上的快捷键监听。 */
    private searchKeys?: (event: KeyboardEvent) => void;
    /** 快捷键监听挂在哪份文档上：独立设置窗口模式下它不是插件所属窗口的那一份。 */
    private searchKeysDocument?: Document;
    /** 恢复滚动位置的那一帧（个别内核算不到滚动高度时补一次）。 */
    private scrollFrame?: number;
    /** 移动端页签栏展开后，删掉过渡起点高度的那个定时器。 */
    private tabBarTimer?: number;
    /**
     * 一页里的行按功能分组的结果。
     *
     * 搜索期间行只改变显隐、不增删，分组结果可以按 pane 缓存；`render()` 会换掉整块
     * innerHTML，pane 变成新对象后旧缓存自然失效，不需要手工清理。
     */
    private readonly featureRowsCache = new WeakMap<HTMLElement, Map<string, HTMLElement[]>>();

    constructor(options: SettingsPanelOptions) {
        this.options = options;
    }

    get isOpen(): boolean {
        return Boolean(this.setting);
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

    /** 当前分类（页签）下要显示设置界面的功能。 */
    private visibleFeatures(category: FeatureCategory): FeatureDefinition[] {
        return this.visibleFeaturesAll().filter((feature) => feature.category.includes(category));
    }

    /**
     * 声明视图里在当前宿主上不可用的功能（开发者禁用 / 用户禁用 / 平台不符 / 版本区间不符）。
     *
     * 面板默认不显示它们；「显示不可用的设置」打开后，每个页签底部会灰显出来并注明原因。
     * 它们不参与配置装载（`activeFeatures()` 已经把它们筛掉了），配置由
     * `loadUnavailableConfigs()` 直接从文件读回来只作显示，读到之前用声明里的默认值。
     */
    private unavailableFeaturesAll(): FeatureDefinition[] {
        return (this.options.allFeatures ?? []).filter((feature) => unavailableReasons(feature).length > 0);
    }

    /** 当前分类（页签）下不可用的功能，顺序与注册表一致。 */
    private unavailableFeatures(category: FeatureCategory): FeatureDefinition[] {
        return this.unavailableFeaturesAll().filter((feature) => feature.category.includes(category));
    }

    // ------------------------------------------------------------ 生命周期

    show(): void {
        if (this.setting) {
            return;
        }
        // 打开方式跟随用户在「设置 - 应用 - 常规」里的选择：勾了「在独立窗口中打开设置界面」
        // 就请宿主把本插件的设置也开到独立窗口里，没勾（或旧宿主没有这个设置）仍是弹窗。
        const openInWindow = inSettingsWindowMode();
        const mobile = isMobileFrontend();
        log.info("opening the settings panel", {
            frontend: mobile ? "mobile" : "desktop",
            features: this.options.features.length,
            settingsWindow: openInWindow,
        });

        const generation = ++this.showGeneration;
        this.tabTouched = false;
        // 已落盘状态属于这一次打开，不能被上一次关闭的异步写盘顺带改掉。
        this.storedTab = undefined;
        // 不可用功能的配置也属于这一次打开：开关关着时根本没读，读出来的旧值不能留给下一个面板。
        this.unavailableConfigs = new Map();
        this.unavailableConfigsLoaded = false;
        // 上一次打开留下的补滚帧指向旧的对话框，先收掉；搜索状态与快捷键监听一并复位。
        this.cancelRevealFrame();
        this.disposeSearch();
        const setting = createSetting({
            openInWindow,
            destroyCallback: () => {
                // 关面板时把还在静默期里的那一次补上：用户改完直接关窗，改动也不会丢。
                void this.flushPending();
                void this.saveTab(generation);
                this.setting = undefined;
                this.dialog = undefined;
                this.pending = new Map();
                this.dirtyControls.clear();
                this.frozen = false;
                this.clearFlushTimer();
                this.stopViewportWatch();
                this.cancelRevealFrame();
                this.disposeSearch();
                this.toggleUnsubscribe?.();
                this.toggleUnsubscribe = undefined;
                this.searchToggleUnsubscribe?.();
                this.searchToggleUnsubscribe = undefined;
            },
        });
        this.setting = setting;

        // 对话框由宿主建：宿主在移动端用 AdaptiveDialog（旧版叫 MobileDialog）把它渲染成底部抽屉，
        // 桌面端仍是居中弹窗；设置窗口模式下 Setting.close() 还会替我们收掉那个窗口。
        // 普通打开时 open() 是同步的，返回时正文已经就绪，因此这里一次性填好整块面板内容 ——
        // 不逐项插入、不异步挂载，入场动画开始前内容就是完整的。
        //
        // 移动端还要挡掉宿主在 open() 里对正文输入控件的自动聚焦：那一下会顶起软键盘、
        // 压缩可视视口，抽屉跟着重排（见 core/frontend.ts）。
        try {
            withoutMobileInputFocus(() => {
                setting.open(this.options.plugin.displayName || this.options.plugin.name);
            });
        } catch (error) {
            // 宿主建对话框失败时不能留下「已打开」的状态，否则之后再点设置都不会有反应。
            this.setting = undefined;
            reportError("settings.open", error);
            return;
        }

        const dialog = setting.dialog;
        if (dialog) {
            this.attachDialog(dialog, generation);
            return;
        }
        // 独立窗口模式：对话框由宿主在另一个窗口里建，这一刻还拿不到（见 waitForWindowDialog）。
        if (openInWindow) {
            this.waitForWindowDialog(setting, generation);
            return;
        }
        // 宿主没有建出对话框：收干净状态并报错，不留一个关不掉的半成品面板。
        this.setting = undefined;
        reportError("settings.open", new Error("the host did not create a settings dialog"));
    }

    /**
     * 等独立设置窗口把对话框建出来。
     *
     * `Setting.open()` 走独立窗口时**不同步**给出对话框：它只是请宿主去开窗，那个窗口启动完
     * （加载语言、外观与插件）才回调挂载，主窗口这边这时才拿得到 `setting.dialog`。
     * 所以这里轮询等它出现，出现之后再把面板画进去；面板关掉、重开或一直等不到都立刻停。
     *
     * 30 秒等不到就当作窗口没建起来：收掉这次打开（`Setting.close()` 会取消还没落地的开窗请求），
     * 不让用户对着一个空白窗口、也不留下一个永远等下去的定时器。
     */
    private waitForWindowDialog(setting: SettingWithDialog, generation: number): void {
        const started = Date.now();
        const timer = window.setInterval(() => {
            if (generation !== this.showGeneration || this.setting !== setting) {
                window.clearInterval(timer);
                return;
            }
            const dialog = setting.dialog;
            if (!dialog) {
                if (Date.now() - started < SETTINGS_WINDOW_TIMEOUT_MS) {
                    return;
                }
                window.clearInterval(timer);
                reportError("settings.open", new Error("the settings window did not create a dialog"));
                this.close();
                return;
            }
            window.clearInterval(timer);
            log.info("the settings window created the dialog", {elapsedMs: Date.now() - started});
            this.attachDialog(dialog, generation);
        }, SETTINGS_WINDOW_POLL_MS);
    }

    /**
     * 把面板画进宿主建好的对话框。
     *
     * 独立设置窗口模式下这个对话框在**另一个窗口的文档**里：面板样式、快捷键都必须落在
     * 那份文档上，不能借用插件所属窗口的 `document`（宿主给插件设置窗口的文档说明里
     * 也写明了这一点）。
     */
    private attachDialog(dialog: Dialog, generation: number): void {
        this.dialog = dialog;
        const mobile = isMobileFrontend();
        // 面板样式表跟着对话框自己的文档走：独立窗口模式下主窗口那份管不到它。
        ensurePanelCss(dialog.element.ownerDocument);

        // 入场图层预热：宿主的 Dialog 在 50ms 后才加 b3-dialog--open，这里在 open() 返回后
        // 同步补类，样式在过渡开始前就已生效（见 core/layer.ts）。
        preheatDialogLayer(dialog);

        // 面板根节点在这里就带上布局类：页签的两种外观（桌面端左侧列表 / 移动端顶部页签栏）
        // 由它决定，render() 只管往里填内容。
        const body = dialog.element.querySelector<HTMLElement>(".b3-dialog__body");
        if (!body) {
            reportError("settings.open", new Error("the settings dialog has no body"));
            this.close();
            return;
        }
        const content = ensureRegion(body, "b3-dialog__content");
        content.innerHTML = `<div class="config ${PANEL_CLASS} ${PANEL_CLASS}--tabs${
            mobile ? ` ${PANEL_CLASS}--mobile` : ""
        }"></div>`;

        if (mobile) {
            this.applySheetLayout();
        } else {
            this.applyDesktopLayout();
        }

        this.render();
        this.hideActionBar();
        // 开关一翻就重算不可用条目的显隐：面板开着的时候，功能会被装载器当场挂载 / 卸载，
        // 面板读到的标记随之改变，这里只负责把结果画出来。
        this.toggleUnsubscribe?.();
        this.toggleUnsubscribe = this.options.store.subscribe(SHOW_UNAVAILABLE_FEATURE_ID, () => {
            // 面板开着的时候才翻开关：这一刻才需要那些灰显行，配置也就这一刻才读
            if (isShowUnavailable()) {
                void this.loadUnavailableConfigs(generation);
            }
            this.applyUnavailableVisibility();
        });
        // 「设置面板搜索」同理：功能会在配置落盘时当场挂载 / 卸载，面板再按标记显隐搜索框。
        this.searchToggleUnsubscribe?.();
        this.searchToggleUnsubscribe = this.options.store.subscribe(SEARCH_FEATURE_ID, () => {
            this.applySearchAvailability();
        });
        // 开关本来就开着：把不可用功能存过的值读回来，让灰显行显示实际配置而不是默认值。
        if (isShowUnavailable()) {
            void this.loadUnavailableConfigs(generation);
        }
        void this.restoreTab(generation);

        if (isReadonly()) {
            showMessage(this.t("panel.readonlyTip"), 5000);
        }
    }

    /** 插件被禁用/重载/卸载时收掉面板；幂等。 */
    close(): void {
        if (this.setting) {
            log.info("closing the settings panel");
        }
        // Setting.close() 自己区分「普通对话框」与「独立设置窗口」两种收法。
        this.setting?.close?.();
    }

    /**
     * 插件卸载：收掉面板，并执行动作行注册的清理回调（它们打开的窗口不在挂载实例里）。
     * 与 `close()` 分开：用户关面板只收面板，动作行开的窗口仍然留着。
     */
    dispose(): void {
        this.disposed = true;
        this.close();
        const listeners = [...this.unloadListeners];
        this.unloadListeners.clear();
        listeners.forEach((listener) => guardSilent("panel.unload", listener));
    }

    /**
     * 桌面端布局。
     *
     * 独立设置窗口（宿主给 `.b3-dialog` 加了 `--window`，容器被铺成 100%）只处理内边距：
     * 那里的宽高由宿主决定，插件再写定值只会让面板缩在窗口一角。
     * 普通弹窗才自己量视口定宽度，见 `applyPanelWidth()`。
     */
    private applyDesktopLayout(): void {
        const root = this.dialog?.element;
        if (!root) {
            return;
        }
        // 内边距不能交给媒体查询：它挂在容器类作用下，类一旦没挂上就整段落空
        // （实测真机就是这样，padding 一直是内核的 16px 24px）。这里直接写行内样式。
        //
        // 内容区取 0 内边距、不滚动：页签结构自己撑满这块地方，
        // 滚动交给每一页（`.some-settings-panel__view`），页签栏才不会被一起滚走。
        const content = root.querySelector<HTMLElement>(".b3-dialog__content");
        if (content) {
            content.style.padding = "0";
            content.style.overflow = "hidden";
        }
        if (root.querySelector(".b3-dialog--window")) {
            return;
        }
        this.applyPanelWidth();
        this.watchViewport();
    }

    /**
     * 按当前视口把面板宽度写成容器上的行内样式（唯一可信的宽度来源）。
     * 只在桌面端的普通弹窗里用：移动端是宿主的底部抽屉，宽度 100vw 由宿主写死；
     * 独立设置窗口由宿主铺满整个窗口。
     *
     * 面板宽度必须由插件自己定，不能交给 CSS：`Dialog` 把宽度写成容器上的行内样式，
     * 而内核给 `.b3-dialog__container` 设了 `flex-shrink: 0`。行内宽度 + 不收缩，
     * 只要视口窄于这个宽度，容器就整块溢出屏幕：一侧被裁掉、另一侧贴边；
     * 容器里空间不足又让标题挤成竖排、连 "ms" 都被 `.b3-dialog__content` 的
     * `word-break: break-all` 从中间断成两行。之前两次都靠 CSS（作用域类 + 媒体查询）
     * 纠正，真机上都不生效 —— 直接量视口写行内样式，优先级最高。
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
            Math.min(narrow ? viewport - NARROW_GUTTER : viewport - 48, MAX_DESKTOP_PANEL_WIDTH),
            MIN_PANEL_WIDTH,
        );
        container.style.width = `${width}px`;
        container.style.maxWidth = `${width}px`;
        container.style.minWidth = "0";

        container.dataset.ssViewport = String(viewport);
        container.dataset.ssWidth = String(width);
        container.dataset.ssNarrow = String(narrow);
    }

    /**
     * 移动端（宿主把 `Setting` 渲染成底部抽屉）的布局。
     *
     * 抽屉高度由宿主按**内容的自然高度**量出来，再按可视视口裁限（拖动还能改），
     * 所以这里**不能**给容器写行内宽度和高度：写死高度要么一打开就空出一截，
     * 要么把内容裁掉。面板按内容自然排版（见 `PANEL_CSS` 里 `--mobile` 那一段），
     * 整块由宿主的内容区滚动，页签栏吸顶。
     */
    private applySheetLayout(): void {
        const content = this.dialog?.element.querySelector<HTMLElement>(".b3-dialog__content");
        if (content) {
            // 内容区取 0 内边距，行自己的内边距由面板给；滚动仍交给宿主的内容区。
            content.style.padding = "0";
            content.style.overflow = "auto";
        }
    }

    /**
     * 面板宽度是按视口算出来的定值，改窗口大小后必须重算（桌面端专用）。
     * 用轮询而不是 resize 事件：桌面窗口的最大化 / 还原在个别内核上只改布局视口、
     * 不派发（或延迟派发）resize，轮询更可靠；250ms 只为改一个字符串。
     */
    private watchViewport(): void {
        if (this.viewportTimer !== undefined) {
            return;
        }
        let last = viewportWidth();
        this.viewportTimer = window.setInterval(() => {
            // 对话框已经不在页面里（宿主收掉了它、页面正在拆除）就没有量视口的必要：
            // 继续轮询只会在没有 document 的环境里抛错，也白留一个定时器。
            if (!this.dialog || !this.dialog.element.isConnected) {
                this.stopViewportWatch();
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

    private cancelRevealFrame(): void {
        if (this.revealFrame === undefined) {
            return;
        }
        window.cancelAnimationFrame(this.revealFrame);
        this.revealFrame = undefined;
    }

    // ------------------------------------------------------------ 渲染

    /**
     * 面板里会出现的全部功能。
     * 前端、宿主版本与 `enabled` 声明已经由 activeFeatures() 统一筛过，这里不重复判定。
     */
    private visibleFeaturesAll(): FeatureDefinition[] {
        return this.options.features;
    }

    private render(): void {
        // 面板直接落在弹窗内容区里（与参考插件同构）：桌面端滚动交给每一页自己，
        // 移动端交给宿主的内容区，插件不再自己套一层滚动容器——多一层就多一份内边距。
        const panel = this.dialog?.element.querySelector<HTMLElement>(`.${PANEL_CLASS}`);
        if (!panel) {
            return;
        }
        const readonly = isReadonly();
        const mobile = isMobileFrontend();
        const showUnavailable = isShowUnavailable();
        panel.classList.toggle(SHOW_UNAVAILABLE_CLASS, showUnavailable);
        const tabs: PanelTab[] = [];
        const panes: string[] = [];
        this.currentTab = undefined;
        CATEGORY_ORDER.forEach((category) => {
            const features = this.visibleFeatures(category);
            const unavailable = this.unavailableFeatures(category);
            if (features.length === 0 && unavailable.length === 0) {
                return;
            }
            // 一页是一张连续的行列表：功能名与它下面的设置行全部平铺在一起，
            // 因此「哪一行是最后一行」要跨功能判定，不能交给 :last-child。
            const rows: string[] = [];
            features.forEach((feature) => {
                rows.push(
                    tagRows(
                        this.featureBlockHtml(feature, this.options.store.get(feature.id), readonly),
                        feature.id,
                    ),
                );
            });
            // 这个分类一个可用的功能都没有：平时只显示这句提示；打开「显示不可用的设置」后
            // 由下面那些灰显条目替代（之后翻开关由 applyUnavailableVisibility() 切 fn__none）。
            if (features.length === 0) {
                rows.push(categoryEmptyHtml(this.t("panel.categoryEmpty"), showUnavailable));
            }
            const unavailableRows = unavailable.map((feature) =>
                markUnavailableRows(tagRows(this.unavailableBlockHtml(feature), feature.id), !showUnavailable)
            ).join("");
            // 首次拼行就直接落下正确的显隐与最后一行标记，不再把整块 DOM 扫描、改写第二遍。
            const body = showUnavailable ?
                markLastRow(rows.join("") + unavailableRows) :
                markLastRow(rows.join("")) + unavailableRows;
            // 页签只在这里出现一次：顺序、文案与图标都由这一处决定，默认打开第一个有内容的页签
            tabs.push({
                id: category,
                label: this.t(categoryKey(category), category),
                icon: CATEGORY_ICONS[category],
            });
            // 分类名那一行是搜索结果的分组标题：平时收起，搜索时显示（见 searchGroupHtml）。
            panes.push(tabPaneHtml(
                category,
                searchGroupHtml(category, this.t(categoryKey(category), category)) + body,
                tabs.length === 1,
            ));
            this.currentTab ??= category;
        });
        // 搜索结果里的「不可用」分组：把各分类里不可用的功能汇总到结果最底部，平时整页收起。
        // 它与分类页里那份是两套行（同一时刻只有一份可见），这样搜索仍然只是「切显隐」，
        // 不用在进 / 出搜索时搬运 DOM。
        const unavailableAll = this.unavailableFeaturesAll();
        if (unavailableAll.length > 0) {
            const rows = unavailableAll.map((feature) =>
                markUnavailableRows(tagRows(this.unavailableBlockHtml(feature), feature.id), !showUnavailable)
            ).join("");
            panes.push(tabPaneHtml(
                UNAVAILABLE_PANE_ID,
                searchGroupHtml(UNAVAILABLE_PANE_ID, this.t("panel.unavailable.group")) +
                    (showUnavailable ? markLastRow(rows) : rows),
                false,
            ));
        }
        if (tabs.length === 0) {
            panel.innerHTML = `<div class="${PANEL_CLASS}__empty">${escapeHtml(this.t("panel.empty"))}</div>`;
            this.bindControls(panel);
            return;
        }
        const items = tabs.map((tab, index) => tabItemHtml(tab, index === 0, mobile)).join("");
        // 搜索框两端各在自己的位置上：桌面端在内容区顶部（设置行上方），
        // 移动端在面板标题下方、页签栏上方。两端都不自动聚焦。
        const search = searchBoxHtml(this.t("panel.search.placeholder"), this.t("panel.search.clear"));
        // 「无结果」只在搜索时可能露出来，平时一直收起。
        const empty = `<div class="${PANEL_CLASS}__empty ${PANEL_CLASS}__search-empty fn__none">${
            escapeHtml(this.t("panel.search.empty"))
        }</div>`;
        panel.innerHTML = mobile ?
            search + tabBarHtml(items) + tabViewsHtml("", panes.join(""), empty) :
            tabSideHtml(items) + tabViewsHtml(search, panes.join(""), empty);
        this.bindControls(panel);
        this.bindTabs(panel);
        this.bindSearch(panel);
        // 搜索框的显隐跟着「设置面板搜索」这个功能走：关掉时整块收起，不占位。
        this.applySearchAvailability();
        log.info(`panel rendered with ${tabs.length} tab(s)`, tabs.map((tab) => tab.id));
    }

    /**
     * 一个功能在页签里的全部行：功能名那一行（带它自己的开关）+ 它下面的设置行。
     *
     * `disabled` 为真时所有控件都是 disabled（只读工作空间、或这个功能不可用）。
     * `reasons` 只给不可用条目：它们作为这个功能的最后一行排在参数行之后，逐条说明为什么用不了。
     */
    private featureBlockHtml(
        feature: FeatureDefinition,
        config: FeatureConfig,
        disabled: boolean,
        reasons: string[] = [],
    ): string {
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
                    Boolean(config[toggle.key]),
                    disabled,
                ),
                toggles: true,
            } :
            inlineSelect && {
                key: bindKey(feature.id, inlineSelect.key),
                html: selectControlHtml(
                    bindKey(feature.id, inlineSelect.key),
                    this.selectOptionsOf(inlineSelect),
                    String(config[inlineSelect.key] ?? inlineSelect.default),
                    disabled,
                ),
            };
        // 子行先各自成串，再给这个功能的最后一行打上标记：层级引导线要在那里收尾（画成 └）。
        // 不能交给 CSS 的 :last-child —— 行是跨功能平铺的，它只看得见整页最后一行。
        const childRows: string[] = [];
        feature.settings
            .filter((field) => field !== toggle && field !== inlineSelect)
            .forEach((field) => childRows.push(this.fieldHtml(feature, field, config, disabled)));
        if (reasons.length > 0) {
            childRows.push(unavailableReasonRowHtml(reasons));
        }
        return subtitleRowHtml(
            this.nameOf(feature),
            feature.description ? this.t(feature.description) : "",
            inline || undefined,
        ) + markLastChildRow(childRows.join(""));
    }

    /**
     * 一个不可用功能的全部行。
     *
     * 它的配置不会被装载（`activeFeatures()` 已经把它筛掉），面板把配置文件直接读出来
     * （`loadUnavailableConfigs()`）只用于显示；读到之前、或者根本没有这个文件时，
     * 按声明里的默认值灰显出来。无论显示的是哪一份，控件都不可操作。
     */
    private unavailableBlockHtml(feature: FeatureDefinition): string {
        return this.featureBlockHtml(
            feature,
            this.unavailableConfigs.get(feature.id) ?? defaultConfig(feature.settings),
            true,
            this.reasonTextsOf(feature),
        );
    }

    /**
     * 读回不可用功能在磁盘上的配置，并按实际值把已经画好的灰显控件补齐。
     *
     * 这些功能不装载、不挂载，store 里没有它们的内存态，所以「这个功能此刻是什么状态」只有
     * 配置文件知道：打开「显示不可用的设置」时读一次，用户存过的值才不会被声明默认值顶替。
     * 只读不写：控件保持 `disabled`，功能也不会因为这一次读盘被挂起来。
     *
     * 面板先同步画出来（默认值），读回来再就地改控件的值；只改这一个打开过程里的面板，
     * 关掉又重开时旧结果不会写进新面板。
     */
    private async loadUnavailableConfigs(generation: number): Promise<void> {
        const features = this.unavailableFeaturesAll();
        if (!this.dialog || features.length === 0 || this.unavailableConfigsLoaded) {
            return;
        }
        // 先立标记再读：读是异步的，翻开关时会连着触发两次，没有这个标记就会重复读一遍
        this.unavailableConfigsLoaded = true;
        const reads = await Promise.all(features.map(async (feature) => ({
            feature,
            stored: await readStoredFile(this.options.plugin, storageNameOf(feature.id)),
        })));
        if (generation !== this.showGeneration || !this.dialog) {
            return;
        }
        reads.forEach(({feature, stored}) => {
            const config = normalizeConfig(
                feature.settings,
                stored,
                (message) => log.warn(`${feature.id}: ${message}`),
            );
            this.unavailableConfigs.set(feature.id, config);
            this.applyConfig(feature.id, config);
        });
        log.info(
            `loaded ${reads.length} unavailable configuration(s) for display`,
            reads.map(({feature, stored}) => [feature.id, stored === null ? "defaults" : "stored"]),
        );
    }

    /** 一个不可用功能的全部原因文案：命中的每一条各占一行，顺序与 `unavailableReasons()` 一致。 */
    private reasonTextsOf(feature: FeatureDefinition): string[] {
        return unavailableReasons(feature).map((reason) => {
            const template = this.t(REASON_KEYS[reason]);
            switch (reason) {
                case "frontend": {
                    const platforms = this.platformLabelsOf(feature);
                    // 空数组（两端都不适用）时没有端名可填
                    return platforms ? template.replace("{platform}", platforms) : this.t(NO_FRONTEND_KEY);
                }
                case "minAppVersion":
                    return feature.minAppVersion ? template.replace("{version}", feature.minAppVersion) : template;
                case "maxAppVersion":
                    return feature.maxAppVersion ? template.replace("{version}", feature.maxAppVersion) : template;
                default:
                    return template;
            }
        });
    }

    /**
     * 功能声明的适用端名字：`["mobile"]` → 「移动端」。空数组时返回空串，调用方改用另一条文案。
     */
    private platformLabelsOf(feature: FeatureDefinition): string {
        return (feature.frontends ?? []).map((frontend) =>
            this.t(frontend === "mobile" ? "common.scope.mobile" : "common.scope.desktop")
        ).join(" / ");
    }

    /**
     * 按「设置面板搜索」此刻的状态把搜索框显隐掉。
     *
     * 搜索框始终留在 DOM 里，开关只切 `fn__none`：关掉时输入框不占位、也进不了 Tab 序，
     * 打开时不必重建面板。关掉的那一刻如果正在搜索，先退回分类视图 —— 结果视图依赖搜索框，
     * 留着会把分类导航一直收着。
     */
    private applySearchAvailability(): void {
        const root = this.dialog?.element;
        if (!root) {
            return;
        }
        const enabled = isSearchEnabled();
        root.querySelector<HTMLElement>(`.${PANEL_CLASS}__search`)?.classList.toggle("fn__none", !enabled);
        if (!enabled) {
            const input = root.querySelector<HTMLInputElement>("[data-ss-search]");
            if (input) {
                input.value = "";
            }
            this.updateSearch("");
        }
        log.info("search availability applied", {enabled});
    }

    /**
     * 按「显示不可用的设置」此刻的状态把不可用条目显隐掉。
     *
     * 平时它们带着 `fn__none`：不占位、也不参与「最后一行」的判定；打开后重新露出，
     * 并重算每页最后一行与功能内最后一个子行的标记（层级引导线的 └ 要在新的最后一行上收尾）。
     * 搜索视图里由 `filterSearch()` 按命中与开关决定，这里只更新根上的类再重过滤一次。
     */
    private applyUnavailableVisibility(): void {
        const root = this.dialog?.element;
        if (!root) {
            return;
        }
        const show = isShowUnavailable();
        this.panelElement(root)?.classList.toggle(SHOW_UNAVAILABLE_CLASS, show);
        if (this.searchActive) {
            this.filterSearch(parseQuery(this.searchText));
            return;
        }
        root.querySelectorAll<HTMLElement>("[data-ss-tab-panel]").forEach((pane) => {
            const dedicated = pane.dataset.ssTabPanel === UNAVAILABLE_PANE_ID;
            pane.querySelectorAll<HTMLElement>(`[${UNAVAILABLE_ATTR}]`).forEach((row) => {
                row.classList.toggle("fn__none", !show);
            });
            // 一个可用的功能都没有的分类：开关关着时只有这句提示，打开后换成灰显条目
            pane.querySelector<HTMLElement>(`.${PANEL_CLASS}__category-empty`)?.classList.toggle("fn__none", show);
            this.refreshLastRow(pane);
            this.refreshChildMarks(this.rowsByFeature(pane));
            if (dedicated) {
                // 汇总页只属于搜索结果：平时整页收起（行自己的显隐仍跟着开关，搜索时直接可用）
                pane.classList.add("fn__none");
            }
        });
        log.info("unavailable settings visibility applied", {show});
    }

    /**
     * 页签的交互：点条目切换，键盘上与内核设置页一致 —— 回车与空格都算。
     * 条目自带 `tabindex="0"`，所以 Tab 键能在页签之间移动。
     */
    private bindTabs(scope: HTMLElement): void {
        scope.querySelectorAll<HTMLElement>("[data-ss-tab]").forEach((item) => {
            const id = item.dataset.ssTab as string;
            item.addEventListener("click", () => {
                this.tabTouched = true;
                this.activateTab(id);
            });
            item.addEventListener("keydown", (event) => {
                if (event.isComposing || (event.key !== "Enter" && event.key !== " ")) {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                this.tabTouched = true;
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
        this.currentTab = id as FeatureCategory;
        this.revealTab(id);
    }

    /**
     * 把页签滚到看得见的位置：恢复上次的页签时，选中的那一项往往还在屏幕外。
     *
     * 移动端的页签栏是一整条横向滚动区（八个分类一屏放不下），一打开总是停在最左边；
     * 桌面端左侧列表也会纵向滚。类名换到第 4、5 个页签上，用户看到的却还是开头那几个，
     * 于是「记住了页签」看起来等于没记住 —— 所以切页之后要把它滚出来。
     *
     * 量不到尺寸时（抽屉刚挂上、页签栏宽度还是 0）下一帧再补一次，只补这一次。
     */
    private revealTab(id: string): void {
        // 上一帧要补滚的是别的页签：撤掉，按这一次的页签重新判断。
        this.cancelRevealFrame();
        if (this.putTabInView(id) || typeof requestAnimationFrame !== "function") {
            return;
        }
        this.revealFrame = requestAnimationFrame(() => {
            this.revealFrame = undefined;
            this.putTabInView(id);
        });
    }

    /**
     * 让页签在它自己的滚动容器里完整可见，位移取最小值：已经看得见就不动，
     * 只露出一半就贴到最近的边。
     *
     * 不用 `scrollIntoView()`：它会连带滚动所有祖先（弹窗内容区、宿主抽屉、整个页面），
     * 恢复一个页签就把整页带偏。这里只改页签栏自己的 `scrollLeft` / `scrollTop`。
     *
     * 返回 false 表示这次没量到尺寸（容器还没排版），调用方可以下一帧再试。
     */
    private putTabInView(id: string): boolean {
        const root = this.dialog?.element;
        const item = root?.querySelector<HTMLElement>(`[data-ss-tab="${id}"]`);
        if (!root || !item) {
            return true;
        }
        // 移动端页签条横向滚，桌面端左侧列表纵向滚，两种容器互斥。
        const bar = item.closest<HTMLElement>(".layout-tab-bar");
        const scroller = bar ?? item.closest<HTMLElement>(`.${PANEL_CLASS}__tabs`);
        if (!scroller) {
            return true;
        }
        const axis: "x" | "y" = bar ? "x" : "y";
        const view = axis === "x" ? scroller.clientWidth : scroller.clientHeight;
        const content = axis === "x" ? scroller.scrollWidth : scroller.scrollHeight;
        if (view <= 0) {
            return false;
        }
        if (content <= view) {
            // 整条都放得下：没有可滚的余量，本来就不需要动。
            return true;
        }
        const box = scroller.getBoundingClientRect();
        const rect = item.getBoundingClientRect();
        const start = axis === "x" ? rect.left - box.left : rect.top - box.top;
        const size = axis === "x" ? rect.width : rect.height;
        if (size <= 0) {
            return false;
        }
        const delta = start < 0 ? start : Math.max(0, start + size - view);
        if (delta === 0) {
            return true;
        }
        if (axis === "x") {
            scroller.scrollLeft += delta;
        } else {
            scroller.scrollTop += delta;
        }
        log.info("revealed the active tab", {tab: id, axis, delta});
        return true;
    }

    /**
     * 恢复上一次关闭时的页签。
     *
     * show() 保持同步：先画出默认页签，再读状态，存储慢也不会拖住对话框。
     * 页签可能因功能退役或前端不同而消失，只恢复当前确实存在的页签。
     */
    private async restoreTab(generation: number): Promise<void> {
        const stored = await readStoredFile(this.options.plugin, PANEL_STATE_FILE);
        if (generation !== this.showGeneration || !this.setting || this.tabTouched) {
            return;
        }
        const tab = typeof stored === "object" && stored !== null && !Array.isArray(stored) ?
            (stored as PanelState).tab :
            undefined;
        if (typeof tab !== "string") {
            return;
        }
        // 一个分类只要有可用的功能、或有不可用的功能（页签会显示空状态文案 / 灰显条目），
        // 它就仍然是一个存在的页签。
        const available = CATEGORY_ORDER.some((category) =>
            category === tab &&
            (this.visibleFeatures(category).length > 0 || this.unavailableFeatures(category).length > 0)
        );
        if (!available) {
            return;
        }
        this.storedTab = tab as FeatureCategory;
        this.activateTab(tab);
        // 读盘慢时用户可能已经开始搜了：页签切换会把结果视图的显隐改掉，按当前查询再过滤一遍。
        // 清空搜索时恢复的仍是这个页签（`currentTab` 已经跟着改了）。
        if (this.searchActive) {
            this.filterSearch(parseQuery(this.searchText));
        }
    }

    /** 关闭面板时记住当前页签；与功能配置一样写后读回，失败必须可见。 */
    private saveTab(generation: number): Promise<void> {
        const tab = this.currentTab;
        const task = this.tabWriteQueue.catch((): void => undefined).then(async () => {
            if (isReadonly() || !tab || tab === this.storedTab) {
                return;
            }
            const value: PanelState = {tab};
            const status = await writeStoredFile(this.options.plugin, PANEL_STATE_FILE, value);
            if (!status.ok) {
                throw new Error(status.detail);
            }
            const readBack = await readStoredFile(this.options.plugin, PANEL_STATE_FILE);
            const actual = typeof readBack === "object" && readBack !== null && !Array.isArray(readBack) ?
                (readBack as PanelState).tab :
                undefined;
            if (actual !== tab) {
                throw new Error(`tab: wrote ${JSON.stringify(tab)} / read back ${JSON.stringify(actual)}`);
            }
            if (generation === this.showGeneration) {
                this.storedTab = tab;
            }
        });
        this.tabWriteQueue = task;
        return task.catch((error: unknown) => reportError("settings.panel-state", error));
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
                // 只读说明块：没有取值，只把 i18n 文案里的 {version} / {repo} 之类的占位符填上。
                // 它底部的按钮与动作行同一套语义：只读 / 发布模式下禁用，点击统一走 runPendingClick
                return noteRowHtml(
                    bindKey(feature.id, field.key),
                    noteBodyHtml(this.t(field.text), field.values, field.labels),
                    (field.actions ?? [])
                        .map((action) =>
                            actionButtonHtml(
                                bindKey(feature.id, action.key),
                                this.actionLabel(action.label, feature.id),
                                {
                                    disabled: readonly,
                                    appearance: action.appearance,
                                    tone: action.tone,
                                    icon: action.icon,
                                    iconSvg: action.iconSvg,
                                },
                            )
                        )
                        .join(""),
                );
            case "button":
                return buttonRowHtml(
                    bindKey(feature.id, field.key),
                    this.t(field.title),
                    this.actionLabel(field.label, feature.id),
                    {
                        description: field.description ? this.t(field.description) : "",
                        // 动作行在只读/发布模式下不提供，避免点了没有反应
                        disabled: readonly,
                        appearance: field.appearance,
                        tone: field.tone,
                        icon: field.icon,
                        iconSvg: field.iconSvg,
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
                        // 而 "feature.kernelAutoReconnect.times" 这种才能翻成「次」/ "times"。
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
            case "textarea":
                return textareaRowHtml(
                    bindKey(feature.id, field.key),
                    this.t(field.title),
                    String(config[field.key] ?? field.default),
                    {
                        placeholder: field.placeholder ? this.t(field.placeholder) : "",
                        description: field.description ? this.t(field.description) : "",
                        disabled: readonly,
                        rows: field.rows,
                    },
                );
            default:
                return "";
        }
    }

    // ------------------------------------------------------------ 交互

    /**
     * 控件事件统一委托给面板根节点：打开时只绑三种事件，不为每个控件各建一组闭包与监听器。
     * 面板整块销毁时这些监听器也随 DOM 一起释放，行为与逐控件绑定一致。
     */
    private bindControls(scope: HTMLElement): void {
        scope.addEventListener("input", (event) => {
            const input = event.target as HTMLInputElement | HTMLTextAreaElement | null;
            const encoded = input?.dataset.ssNumber ?? input?.dataset.ssText ?? input?.dataset.ssTextarea;
            if (encoded) {
                this.typeInput(encoded, input.value);
            }
        });
        scope.addEventListener("change", (event) => {
            const control = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
            const switchKey = control?.dataset.ssSwitch;
            if (switchKey) {
                this.commitControl(switchKey, (control as HTMLInputElement).checked);
                return;
            }
            const selectKey = control?.dataset.ssSelect;
            if (selectKey) {
                this.commitControl(selectKey, control.value);
                return;
            }
            const inputKey = control?.dataset.ssNumber ?? control?.dataset.ssText ?? control?.dataset.ssTextarea;
            if (inputKey) {
                this.commitInput(inputKey, control.value);
            }
        });
        scope.addEventListener("click", (event) => {
            // 不用 instanceof Element：独立设置窗口里的元素属于另一份 window。
            const target = event.target as Element | null;
            const anchor = target?.closest?.(`.${PANEL_CLASS}__note a[href]`) as HTMLAnchorElement | null | undefined;
            if (anchor && scope.contains(anchor)) {
                event.preventDefault();
                openExternalLink(anchor.href, event);
                return;
            }
            const button = target?.closest?.("[data-ss-button]") as HTMLButtonElement | null | undefined;
            if (!button || !scope.contains(button)) {
                return;
            }
            const encoded = button.dataset.ssButton as string;
            runPendingClick(button, encoded, () => {
                const [featureId, key] = parseBindKey(encoded);
                const action = this.actionOf(featureId, key);
                if (!action) {
                    log.warn(`action "${encoded}" has no matching onClick, ignoring it`);
                    return;
                }
                log.info(`action "${encoded}" triggered`);
                return guardAsync(
                    `${featureId}.${key}`,
                    () => Promise.resolve(action.onClick(this.actionContext(featureId))),
                );
            });
        });
    }

    /**
     * 动作按钮的文案：字符串是 i18n key；函数型每次打开面板求值，返回值直接当文案。
     * 动作行与说明块底部的按钮都从这里取，两处不各写一份。
     */
    private actionLabel(
        label: string | ((context: FeatureActionContext) => string),
        featureId: string,
    ): string {
        return typeof label === "function" ? label(this.actionContext(featureId)) : this.t(label);
    }

    /**
     * 按「功能 id + key」找一个动作：独立的动作行与说明块底部的按钮都能找到。
     */
    private actionOf(
        featureId: string,
        key: string,
    ): {onClick: (context: FeatureActionContext) => void | Promise<void>;} | undefined {
        const feature = this.options.features.find((item) => item.id === featureId);
        for (const field of feature?.settings ?? []) {
            if (field.kind === "button" && field.key === key) {
                return field;
            }
            if (field.kind === "note") {
                const action = field.actions?.find((item) => item.key === key);
                if (action) {
                    return action;
                }
            }
        }
        return undefined;
    }

    /**
     * 动作行能拿到的平台能力。动作行不参与挂载，拿不到 FeatureHost，
     * 所以它需要的东西只能由面板在这里现搭一个。
     */
    private actionContext(featureId: string): FeatureActionContext {
        return {
            i18n: (key: string) => this.t(key),
            featureId,
            pluginName: this.options.plugin.name,
            onUnload: (listener: () => void) => {
                this.unloadListeners.add(listener);
                return () => this.unloadListeners.delete(listener);
            },
            configOf: (id: string) => ({...this.options.store.get(id)}),
            updateConfig: async (id: string, patch: FeatureConfig) => {
                await this.options.store.patch(id, patch);
                // 开关状态变了就把面板上的控件一起改掉，不让界面和磁盘各说各话
                this.syncControls(id);
            },
            clearAllConfigs: () => {
                // 清空是全量重置：静默期里还没落盘的输入属于要被清掉的那一份，直接丢掉。
                // 留着它会在删除完成之后写盘，把刚清掉的配置又带回来。
                this.clearFlushTimer();
                this.pending = new Map();
                this.dirtyControls.clear();
                // 清空成功后窗口很快会重新载入，这期间面板上还是清空前的值：继续接受输入
                // 会把旧值当成新值写回文件。清空失败（不会重载）时解除封锁。
                this.frozen = true;
                return this.options.store.clearAll().catch((error: unknown) => {
                    this.frozen = false;
                    throw error;
                });
            },
            exportConfigs: async () => {
                // 导出读的是磁盘：静默期里还没落盘的输入先写掉，导出的才是用户此刻看到的值
                await this.flushPending();
                return this.options.store.exportAll();
            },
            importConfigs: async (config: Record<string, unknown>) => {
                // 导入是整体替换：静默期里还没落盘的输入先写掉（导入会覆盖同一批文件，
                // 留在队列里反而会在导入完成后再写一次旧值）。成功后窗口很快重新载入，
                // 这期间不再接受输入；失败时解除封锁。
                this.frozen = true;
                try {
                    await this.flushPending();
                    return await this.options.store.importMany(config);
                } catch (error) {
                    this.frozen = false;
                    throw error;
                }
            },
        };
    }

    /**
     * 把宿主的动作区整块收起。
     *
     * 面板没有「保存 / 取消」这一步 —— 控件改动当场落盘，所以宿主建的那条动作区直接
     * 用 `fn__none` 收起来，插件也不往里放任何按钮。宿主没建动作区时什么都不用做。
     */
    private hideActionBar(): void {
        this.dialog?.element.querySelector<HTMLElement>(".b3-dialog__action")?.classList.add("fn__none");
    }

    // ------------------------------------------------------------ 改完即写

    /** 开关 / 下拉的一次改动：立即落盘。 */
    private commitControl(encodedKey: string, value: unknown): void {
        const target = this.targetOf(encodedKey);
        if (target) {
            void this.commit(target.featureId, {[target.key]: value});
        }
    }

    /**
     * 文本 / 数字框在打字过程中的一次输入：只进静默队列，等用户停下来再写。
     *
     * 数字框打到一半的形态（清空、只有一个负号、小数点）不是合法值，先不落盘；
     * 写完（失焦的 change）时再按 0 处理，与改动前「保存时被 min 夹住」的行为一致。
     */
    private typeInput(encodedKey: string, raw: string): void {
        const target = this.targetOf(encodedKey);
        if (!target) {
            return;
        }
        if (!target.numeric) {
            this.schedule(target.featureId, {[target.key]: raw});
            return;
        }
        if (raw.trim() === "") {
            return;
        }
        const value = Number(raw);
        if (Number.isFinite(value)) {
            this.schedule(target.featureId, {[target.key]: value});
        }
    }

    /** 文本 / 数字框失焦（或回车）触发的提交：立即落盘。 */
    private commitInput(encodedKey: string, raw: string): void {
        const target = this.targetOf(encodedKey);
        if (target) {
            void this.commit(target.featureId, {[target.key]: target.numeric ? Number(raw) : raw});
        }
    }

    /**
     * 把控件标识（`功能 id::字段 key`）解析成落盘需要的信息。
     *
     * 声明里找不到这个功能时只告警并丢弃这次改动：面板渲染完之后声明被改掉属于异常，
     * 没有 schema 就没有可写的东西。
     */
    private targetOf(encodedKey: string): {featureId: string; key: string; numeric: boolean;} | undefined {
        const [featureId, key] = parseBindKey(encodedKey);
        const feature = this.options.features.find((item) => item.id === featureId);
        if (!feature) {
            log.warn(`control "${encodedKey}" has no matching feature, change discarded`);
            return undefined;
        }
        const field = feature.settings.find((item) => item.key === key);
        return {featureId, key, numeric: field?.kind === "number"};
    }

    /** 立即写盘；同一功能还有排队中的输入时一起写掉，同一个文件不写两遍。 */
    private commit(featureId: string, patch: FeatureConfig): Promise<void> {
        if (this.frozen) {
            return Promise.resolve();
        }
        this.markEdits(featureId, patch);
        const queued = this.pending.get(featureId);
        this.pending.delete(featureId);
        // 立即提交后旧计时器必须失效，否则写入途中再次输入会留下一次没有新输入触发的静默写盘。
        this.clearFlushTimer();
        const writing = this.write(featureId, queued ? {...queued, ...patch} : patch);
        // 别的功能还有静默期里的输入：刚才清掉的计时器是共用的，这里把它重新排上，
        // 否则那些改动要等到关面板才落盘（彼此无关的两个输入框，改完 A 再去改 B 就会触发）。
        if (this.pending.size > 0) {
            this.armFlushTimer();
        }
        return writing;
    }

    /** 把一次改动放进静默队列；静默期结束后统一写盘。 */
    private schedule(featureId: string, patch: FeatureConfig): void {
        if (this.frozen) {
            return;
        }
        this.markEdits(featureId, patch);
        this.pending.set(featureId, {...this.pending.get(featureId), ...patch});
        this.clearFlushTimer();
        this.armFlushTimer();
    }

    /**
     * 记下这一次用户改动：这些控件在对应的写盘回显之前不能被 store 的值覆盖。
     *
     * 序号同时用来区分「这次写盘负责的改动」与「写盘途中又来的改动」，见 `settleEdits`。
     */
    private markEdits(featureId: string, patch: FeatureConfig): void {
        for (const key of Object.keys(patch)) {
            this.dirtyControls.set(bindKey(featureId, key), ++this.editSeq);
        }
    }

    /**
     * 一次写盘结束后，把这次负责的控件从「在途」里摘掉。
     *
     * 只摘没有更新改动的那些：写盘途中又被改过的控件保留在途状态，等它自己的写盘完成，
     * 否则这次回显仍然会覆盖用户正在输入的新内容。
     */
    private settleEdits(featureId: string, patch: FeatureConfig, editSeq: number): void {
        for (const key of Object.keys(patch)) {
            const encoded = bindKey(featureId, key);
            const last = this.dirtyControls.get(encoded);
            if (last !== undefined && last <= editSeq) {
                this.dirtyControls.delete(encoded);
            }
        }
    }

    /** 排一次静默期结束后的写盘（调用方负责先清掉旧计时器，这样每次 input 都重新计时）。 */
    private armFlushTimer(): void {
        this.flushTimer = window.setTimeout(() => {
            this.flushTimer = undefined;
            void this.flushPending();
        }, TYPING_QUIET_MS);
    }

    /** 把静默期里剩下的改动立刻写盘（定时器到点、失焦合并、关面板时调用）；幂等。 */
    private async flushPending(): Promise<void> {
        this.clearFlushTimer();
        if (this.pending.size === 0) {
            return;
        }
        // 卸载途中宿主已经不再接受写入（saveData 会以 410 拒绝）：待落地的改动直接丢掉，
        // 不要让一次注定失败的写入再弹一个错误提示。
        if (this.disposed) {
            this.pending = new Map();
            return;
        }
        const queued = [...this.pending];
        this.pending = new Map();
        for (const [featureId, patch] of queued) {
            await this.write(featureId, patch);
        }
    }

    private clearFlushTimer(): void {
        if (this.flushTimer === undefined) {
            return;
        }
        window.clearTimeout(this.flushTimer);
        this.flushTimer = undefined;
    }

    /**
     * 写盘并处理失败。
     *
     * 写完后按 store 的归一化结果回显（例如数字被 min / max 夹取）；失败时 store 已回退内存态，
     * 这里把控件改回磁盘上的值，再把错误交给用户，不允许界面停在「看着改了、其实没存」的状态。
     */
    private async write(featureId: string, patch: FeatureConfig): Promise<void> {
        // 这次写盘只回显到此刻为止的输入：之后又来的改动序号更大，回显时必须跳过。
        const editSeq = this.editSeq;
        try {
            await this.options.store.patch(featureId, patch);
        } catch (error) {
            reportError(`settings.${featureId}`, error);
        } finally {
            this.settleEdits(featureId, patch, editSeq);
            this.syncControls(featureId);
        }
    }

    /**
     * 把某个功能的控件改回存储里的值（写盘失败后使用）。
     *
     * 只动这一个功能的控件：别的功能没有改动，不该被动过。
     */
    private syncControls(featureId: string): void {
        this.applyConfig(featureId, this.options.store.get(featureId));
    }

    /**
     * 把某个功能的控件改成给定配置里的值。
     *
     * 可用的功能拿 store 里的那份；不可用的功能拿从文件里读回来的那份（只读显示，控件是
     * `disabled`），两种情形共用这一段 —— 否则「界面上显示的值」会有两套走法。
     *
     * 有在途改动的控件跳过：写盘是异步的，用户可能在这次写盘途中又输入了新内容（还在
     * `pending` 里、没进 store），按存储回写会把他正在输入的内容覆盖掉，接着打字还会
     * 按被截断的值落盘。等它自己那次写盘完成时再对齐。
     * 值没变的控件也不赋值：给 `input.value` 赋值会把光标挪到末尾，等于打断正在编辑的输入。
     */
    private applyConfig(featureId: string, config: FeatureConfig): void {
        const root = this.dialog?.element;
        if (!root) {
            return;
        }
        const keyOf = (encoded: string | undefined): string | undefined => {
            if (typeof encoded !== "string") {
                return undefined;
            }
            const [id, key] = parseBindKey(encoded);
            return id === featureId ? key : undefined;
        };
        const inFlight = (encoded: string | undefined): boolean =>
            typeof encoded === "string" && this.dirtyControls.has(encoded);
        root.querySelectorAll<HTMLInputElement>("[data-ss-switch]").forEach((input) => {
            const key = keyOf(input.dataset.ssSwitch);
            if (key && !inFlight(input.dataset.ssSwitch)) {
                const next = config[key] === true;
                if (input.checked !== next) {
                    input.checked = next;
                }
            }
        });
        root.querySelectorAll<HTMLSelectElement>("[data-ss-select]").forEach((select) => {
            const key = keyOf(select.dataset.ssSelect);
            if (key && !inFlight(select.dataset.ssSelect)) {
                const next = String(config[key] ?? "");
                if (select.value !== next) {
                    select.value = next;
                }
            }
        });
        root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
            "[data-ss-number], [data-ss-text], [data-ss-textarea]",
        )
            .forEach((input) => {
                const encoded = input.dataset.ssNumber ?? input.dataset.ssText ?? input.dataset.ssTextarea;
                const key = keyOf(encoded);
                if (key && !inFlight(encoded)) {
                    const next = String(config[key] ?? "");
                    if (input.value !== next) {
                        input.value = next;
                    }
                }
            });
    }

    // ------------------------------------------------------------ 搜索

    /**
     * 绑定搜索框与快捷键。搜索只是面板自己的过滤机制；开关由 `settings-search` 功能承载，
     * 这里始终绑定，功能关着时由 `handleSearchKey()` 把快捷键交还宿主。
     *
     * 输入事件即时过滤，但**组合输入（中文输入法）期间什么都不做**：一个词还没上屏，
     * 过滤出来的是半成品，而且高亮会把正在拼的字拆散。
     */
    private bindSearch(panel: HTMLElement): void {
        const input = panel.querySelector<HTMLInputElement>("[data-ss-search]");
        if (!input) {
            return;
        }
        input.addEventListener("input", (event) => {
            if ((event as InputEvent).isComposing) {
                return;
            }
            this.updateSearch(input.value);
        });
        // 个别输入法在组合结束时不再补发 input，这里按最终文本再兜一次；文本没变就自己跳过。
        input.addEventListener("compositionend", () => this.updateSearch(input.value));

        // 一键清空：输入框里那颗图标按钮。点了等于把词删空 —— 回到搜索前的视图，焦点留在搜索框里。
        panel.querySelector<HTMLButtonElement>("[data-ss-search-clear]")?.addEventListener("click", () => {
            input.value = "";
            this.updateSearch("");
            this.focusSearch(input);
        });
        this.syncSearchClear();

        // 快捷键挂在面板自己那份文档的捕获阶段：宿主的「在文档里搜索」也听着 Ctrl/Cmd + F，
        // 只有捕获阶段才能赶在它前面把键拦下来。面板关闭时由 disposeSearch() 收掉。
        this.releaseSearchKeys();
        const onKeyDown = (event: KeyboardEvent): void => this.handleSearchKey(event);
        this.searchKeys = onKeyDown;
        this.searchKeysDocument = panel.ownerDocument;
        panel.ownerDocument.addEventListener("keydown", onKeyDown, true);
    }

    /**
     * 收掉快捷键监听；幂等。
     *
     * 必须记住当初挂在哪份文档上：独立设置窗口模式下它不是插件所属窗口的 `document`，
     * 照着 `document` 删会留下一个永远解不掉的监听。
     */
    private releaseSearchKeys(): void {
        if (!this.searchKeys) {
            return;
        }
        this.searchKeysDocument?.removeEventListener("keydown", this.searchKeys, true);
        this.searchKeys = undefined;
        this.searchKeysDocument = undefined;
    }

    /**
     * 面板打开期间的快捷键：`/` 与 `Ctrl/Cmd + F` 聚焦搜索框，`Esc` 分层清空。
     *
     * - `/` 在编辑控件（文本 / 数字 / 下拉 / 可编辑区）里是用户要输入的字符，不劫持
     * - `Esc` 有查询时只清空搜索、回到搜索前的视图并保留搜索框焦点，面板不关；
     *   没有查询时不拦，交还宿主原本的行为（关面板）
     * - 组合输入期间的按键属于输入法，一律不处理
     */
    private handleSearchKey(event: KeyboardEvent): void {
        // 面板没开（或正在关闭）时这些键不属于我们
        if (!this.setting || !this.dialog) {
            return;
        }
        // 搜索功能关着时一个键都不碰：`Ctrl/Cmd + F`、`/`、`Esc` 全部交还宿主。
        if (!isSearchEnabled()) {
            return;
        }
        if (event.isComposing || event.keyCode === 229) {
            return;
        }
        const input = this.dialog.element.querySelector<HTMLInputElement>("[data-ss-search]");
        if (!input) {
            return;
        }
        const withCommand = (event.ctrlKey || event.metaKey) && !event.altKey;
        if (withCommand && event.key.toLowerCase() === "f") {
            event.preventDefault();
            event.stopPropagation();
            this.focusSearch(input);
            return;
        }
        if (event.key === "Escape") {
            if (!this.searchActive) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            input.value = "";
            this.updateSearch("");
            this.focusSearch(input);
            return;
        }
        if (event.key === "/" && !withCommand) {
            if (isEditingControl(this.dialog.element.ownerDocument.activeElement)) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            this.focusSearch(input);
        }
    }

    /** 输入框里有内容才露出那颗一键清空按钮；空的时候整颗收起，不占位也不进 Tab 序。 */
    private syncSearchClear(): void {
        const root = this.dialog?.element;
        const input = root?.querySelector<HTMLInputElement>("[data-ss-search]");
        const clear = root?.querySelector<HTMLElement>("[data-ss-search-clear]");
        if (!input || !clear) {
            return;
        }
        clear.classList.toggle("fn__none", input.value === "");
    }

    /** 聚焦搜索框并选中已有查询：接着打字就是替换，按一次退格还能回到原来的词。 */
    private focusSearch(input: HTMLInputElement): void {
        input.focus();
        input.select();
    }

    /**
     * 输入变化的唯一入口：**文本真的变了才重算**。
     *
     * 同样的文本再触发一次（组合输入结束、`/` 选中已有查询）不重算 —— 期间改过的动态文案
     * （运行时下拉选项、函数型按钮文字）不打断当前结果；等下一次真正的输入再按最新索引算。
     */
    private updateSearch(raw: string): void {
        // 清空按钮跟着输入框里的内容走：不管这次是打字、点按钮还是 Esc 清的，都只在这里同步一次
        this.syncSearchClear();
        const keywords = parseQuery(raw);
        if (keywords.length === 0) {
            this.searchText = "";
            this.quitSearch();
            return;
        }
        if (this.searchActive && raw === this.searchText) {
            return;
        }
        if (!this.searchActive) {
            this.beginSearch();
        }
        this.searchText = raw;
        this.filterSearch(keywords);
    }

    /**
     * 进入搜索状态：记下滚动位置，收起分类导航，给面板根挂上结果视图的类。
     *
     * 只加类、不动内容 —— 面板结构原样留着，切回来时一点都不用重建。
     */
    private beginSearch(): void {
        const root = this.dialog?.element;
        if (!root) {
            return;
        }
        this.captureScroll(root);
        this.searchActive = true;
        // 分类导航给结果视图让位：桌面端整根收起左侧栏，移动端收起顶部页签栏，
        // 两者都只加这一个类，怎么收由 `--search` 那两段 CSS 决定（宽度 / 高度过渡）——
        // 这里刻意不加 fn__none：display:none 没有过渡，一开一收就是硬跳。
        // 页签栏的高度是内容撑出来的，收起前先把实测高度交给 CSS 当起点。
        this.lockTabBarHeight(root);
        this.panelElement(root)?.classList.add(SEARCH_CLASS);
        log.info("search started");
    }

    /**
     * 按查询显隐现成的行，不重建任何东西。
     *
     * 命中粒度是「功能」：分类名命中 → 该分类全部功能；功能或它的任一设置项命中 →
     * 显示该功能的**全部**可见设置项（包括没直接命中的字段）。分类与功能都按声明顺序排，
     * 不做相关度排序。每次过滤都现拼索引，所以拿到的是「最新」的动态文案。
     */
    private filterSearch(keywords: string[]): void {
        const root = this.dialog?.element;
        if (!root) {
            return;
        }
        const hits = matchIndex(this.buildSearchIndex(), keywords);
        this.clearHighlights(root);
        const showUnavailable = isShowUnavailable();
        const unavailableAll = this.unavailableFeaturesAll();
        const unavailableIds = new Set(unavailableAll.map((feature) => feature.id));
        const unavailableCategoriesOf = new Map(unavailableAll.map((feature) => [feature.id, feature.category]));
        let shown = 0;
        root.querySelectorAll<HTMLElement>("[data-ss-tab-panel]").forEach((pane) => {
            if (pane.dataset.ssTabPanel === UNAVAILABLE_PANE_ID) {
                // 汇总页在下面单独处理：它要按「开关 + 命中」决定，还要排在所有分类之后
                return;
            }
            const category = pane.dataset.ssTabPanel as string;
            const showAll = hits.categories.has(category);
            const featureRows = this.rowsByFeature(pane);
            let visible = 0;
            featureRows.forEach((rows, id) => {
                // 不可用条目统一在结果末尾的「不可用」分组里出现，分类页里那一份始终收起
                const show = !unavailableIds.has(id) && (showAll || hits.features.has(id));
                if (show) {
                    visible += 1;
                }
                rows.forEach((row) => row.classList.toggle("fn__none", !show));
            });
            pane.classList.toggle("fn__none", visible === 0);
            pane.querySelector<HTMLElement>("[data-ss-search-group]")?.classList.toggle("fn__none", visible === 0);
            if (visible === 0) {
                return;
            }
            shown += visible;
            this.refreshLastRow(pane);
            this.refreshChildMarks(featureRows);
            this.highlightPane(pane, keywords);
        });
        // 「不可用」分组：所有不可用的功能汇总在结果最底部，只有开关打开且真的命中时才出现。
        // 搜「不可用」这三个字（分组名本身）也命中这一组，与分类名命中的规则一致。
        const dedicated = root.querySelector<HTMLElement>(`[data-ss-tab-panel="${UNAVAILABLE_PANE_ID}"]`);
        if (dedicated) {
            const showAll = hits.categories.has(UNAVAILABLE_PANE_ID);
            const featureRows = this.rowsByFeature(dedicated);
            let visible = 0;
            featureRows.forEach((rows, id) => {
                // 分类名命中时，该分类里不可用的功能也跟着出现（与分类分组「命中即整组显示」一致）
                const show = showUnavailable &&
                    (showAll || hits.features.has(id) ||
                        (unavailableCategoriesOf.get(id) ?? []).some((category) => hits.categories.has(category)));
                if (show) {
                    visible += 1;
                }
                rows.forEach((row) => row.classList.toggle("fn__none", !show));
            });
            dedicated.classList.toggle("fn__none", visible === 0);
            dedicated.querySelector<HTMLElement>("[data-ss-search-group]")?.classList.toggle("fn__none", visible === 0);
            if (visible > 0) {
                shown += visible;
                this.refreshLastRow(dedicated);
                this.highlightPane(dedicated, keywords);
            }
        }
        // 无结果时只留这一行提示：空分类已经整页收起，这里也不挂清除按钮
        root.querySelector<HTMLElement>(`.${PANEL_CLASS}__search-empty`)?.classList.toggle("fn__none", shown > 0);
        log.info("search filtered", {keywords, features: shown, unavailable: showUnavailable});
    }

    /**
     * 退出搜索：恢复分类导航、当前页签、每一页的最后一行标记与搜索前的滚动位置。
     *
     * 只动显隐类与文字，不重建面板 —— 搜索结果里正在编辑的输入框、还没落盘的文本都留在原处。
     */
    private quitSearch(): void {
        if (!this.searchActive) {
            return;
        }
        this.searchActive = false;
        const root = this.dialog?.element;
        if (!root) {
            return;
        }
        // 去掉 `--search`：桌面端左侧栏、移动端页签栏一起按 CSS 过渡滑回来。
        // 页签栏的过渡起点还留着，展开完再把它删掉，让高度回到 auto。
        this.panelElement(root)?.classList.remove(SEARCH_CLASS);
        this.releaseTabBarHeight(root);
        root.querySelector<HTMLElement>(`.${PANEL_CLASS}__search-empty`)?.classList.add("fn__none");
        root.querySelectorAll<HTMLElement>("[data-ss-tab-panel]").forEach((pane) => {
            pane.classList.remove("fn__none");
            // 只有被搜索藏起来的行需要恢复：搜索之外没有任何代码给行加 fn__none
            pane.querySelectorAll<HTMLElement>(".config-item.fn__none").forEach((row) =>
                row.classList.remove("fn__none")
            );
            pane.querySelector<HTMLElement>("[data-ss-search-group]")?.classList.add("fn__none");
            this.refreshLastRow(pane);
            this.refreshChildMarks(this.rowsByFeature(pane));
        });
        this.clearHighlights(root);
        if (this.currentTab) {
            this.activateTab(this.currentTab);
        }
        // 搜索期间不可用条目一律收起（统一放在结果末尾的「不可用」分组里），
        // 回到分类视图时按开关的状态重新露出，并重算每一页的最后一行。
        this.applyUnavailableVisibility();
        this.restoreScroll(root);
        log.info("search cleared");
    }

    /**
     * 重新算出这一页里可见行的最后一行。
     *
     * 过滤后行会整块消失，渲染时打的 `config-item--last-visible` 就不一定还落在最后一个可见行上；
     * 这一页的下分割线、层级引导线的收尾都靠它，所以每次显隐变化后重算一遍。
     */
    private refreshLastRow(pane: HTMLElement): void {
        // 整页同时只有一行带这个标记（渲染时打一个，之后每次重算都先摘掉再打），
        // 所以摘标记只需要动那一行，不必把全部行扫一遍。
        pane.querySelector<HTMLElement>(`.${LAST_ROW_CLASS}`)?.classList.remove(LAST_ROW_CLASS);
        const rows = pane.querySelectorAll<HTMLElement>(".config-item:not(.fn__none)");
        rows[rows.length - 1]?.classList.add(LAST_ROW_CLASS);
    }

    /**
     * 重新算出每个功能里「最后一个子行」的收尾标记。
     *
     * 层级引导线在那个子行上画成 └。过滤只整块显隐功能，渲染时打的标记本来就还落在它的
     * 最后一个子行上；这里仍按同一套规则重算一遍，搜索与恢复走的是同一条路径，
     * 将来若出现「单独藏起某一行」的用法也不会漏。
     */
    private refreshChildMarks(features: Map<string, HTMLElement[]>): void {
        features.forEach((rows) => {
            let last: HTMLElement | undefined;
            rows.forEach((row) => {
                if (!row.classList.contains(CHILD_CLASS)) {
                    return;
                }
                // 每个功能里同样只有一行带收尾标记：只摘那一行，不给全部子行各写一次
                if (row.classList.contains(LAST_CHILD_CLASS)) {
                    row.classList.remove(LAST_CHILD_CLASS);
                }
                if (!row.classList.contains("fn__none")) {
                    last = row;
                }
            });
            last?.classList.add(LAST_CHILD_CLASS);
        });
    }

    /** 按功能 id 把一页里的行分组：显隐、收尾标记与高亮都按「一个功能」为单位处理。 */
    private rowsByFeature(pane: HTMLElement): Map<string, HTMLElement[]> {
        const cached = this.featureRowsCache.get(pane);
        if (cached) {
            return cached;
        }
        const features = new Map<string, HTMLElement[]>();
        pane.querySelectorAll<HTMLElement>(".config-item").forEach((row) => {
            const id = row.dataset.ssFeature;
            if (!id) {
                return;
            }
            const rows = features.get(id);
            if (rows) {
                rows.push(row);
                return;
            }
            features.set(id, [row]);
        });
        this.featureRowsCache.set(pane, features);
        return features;
    }

    /** 给一页里可见的行与分组标题上高亮；只有当前界面真的看得见的文字才高亮。 */
    private highlightPane(pane: HTMLElement, keywords: string[]): void {
        pane.querySelectorAll<HTMLElement>(".config-item").forEach((row) => {
            if (row.classList.contains("fn__none")) {
                return;
            }
            row.querySelectorAll<HTMLElement>(`.config-item__main, .${PANEL_CLASS}__note-body, .b3-button`)
                .forEach((target) => this.highlightText(target, keywords));
        });
        const group = pane.querySelector<HTMLElement>("[data-ss-search-group]");
        if (group && !group.classList.contains("fn__none")) {
            this.highlightText(group, keywords);
        }
    }

    /**
     * 把一段可见文案切成「命中 / 未命中」的片段写回 DOM。
     *
     * 只新建文本节点与 `<mark>`（`textContent` 赋值），**不拼 HTML 字符串**：
     * 关键词来自用户输入，走 innerHTML 就是一次注入。`<select>` 里的文本节点不动 ——
     * 下拉选项标签参与匹配，但那里塞不进标记。
     */
    private highlightText(element: HTMLElement, keywords: string[]): void {
        // 先用整块文字判一次：绝大多数元素里一个关键词都没有，省掉一次 TreeWalker
        // 与逐节点分段。命中的元素仍按 text node 走，切分结果不变。
        const text = element.textContent ?? "";
        if (text === "") {
            return;
        }
        const haystack = text.toLowerCase();
        if (!keywords.some((keyword) => haystack.includes(keyword))) {
            return;
        }
        const walker = element.ownerDocument.createTreeWalker(element, SHOW_TEXT);
        const nodes: Text[] = [];
        while (walker.nextNode()) {
            const node = walker.currentNode as Text;
            if (!node.parentElement?.closest("select, textarea")) {
                nodes.push(node);
            }
        }
        nodes.forEach((node) => {
            const segments = highlightSegments(node.data, keywords);
            if (!segments.some((segment) => segment.hit)) {
                return;
            }
            const fragment = element.ownerDocument.createDocumentFragment();
            segments.forEach((segment) => {
                if (!segment.hit) {
                    fragment.append(element.ownerDocument.createTextNode(segment.text));
                    return;
                }
                const mark = element.ownerDocument.createElement("mark");
                mark.className = HIT_CLASS;
                mark.textContent = segment.text;
                fragment.append(mark);
            });
            node.replaceWith(fragment);
        });
    }

    /** 拆掉所有高亮，把文本节点合回去（下一次过滤重新算，切回普通视图时也不留痕迹）。 */
    private clearHighlights(root: HTMLElement): void {
        // 只合并真正被切开过的元素：原先对整页每个行都 normalize 一遍，
        // 而没有被高亮过的子树里根本没有相邻文本节点，合并没有任何效果。
        const touched = new Set<Element>();
        root.querySelectorAll(`mark.${HIT_CLASS}`).forEach((mark) => {
            const parent = mark.parentElement;
            mark.replaceWith(root.ownerDocument.createTextNode(mark.textContent ?? ""));
            if (parent) {
                touched.add(parent);
            }
        });
        touched.forEach((element) => element.normalize());
    }

    /**
     * 生成只读索引：面板当前展示的每个分类、功能、字段各一个匹配域。
     *
     * 索引内容只有面板上能看到的东西：分类名；功能的 id / 名称 / 说明；设置项的 key / 标题 / 说明；
     * 输入框 placeholder；下拉选项标签；说明块的文字、值与标签；按钮的标题、说明与当前文字。
     * **不收**用户填写的值、开关状态、当前选中值，也不读任何配置文件。
     *
     * 静态 i18n 文案把各语言文件里的同一条都算进同一个匹配域（不同语言可混着搜），
     * 运行时才知道的文案（动态下拉候选集、函数型按钮文字）只收此刻解析出的可见内容。
     *
     * 每次过滤现算：查询一变就要用最新索引，改过设置之后再输入才能命中新文案。
     */
    private buildSearchIndex(): SearchIndex {
        const categories: Record<string, SearchField> = {};
        const features: SearchRecord[] = [];
        const unavailable = this.unavailableFeaturesAll();
        CATEGORY_ORDER.forEach((category) => {
            if (this.visibleFeatures(category).length === 0 && this.unavailableFeatures(category).length === 0) {
                return;
            }
            categories[category] = this.staticField(categoryKey(category));
        });
        // 「不可用」分组名本身也是一个匹配域：搜「不可用」就能把这一组整个翻出来，
        // 与分类名命中的规则一致（命中分组名 → 该组全部条目）。
        if (unavailable.length > 0) {
            categories[UNAVAILABLE_PANE_ID] = this.staticField("panel.unavailable.group");
        }
        this.visibleFeaturesAll().forEach((feature) => features.push(this.searchRecordOf(feature)));
        unavailable.forEach((feature) => features.push(this.searchRecordOf(feature)));
        return {categories, features};
    }

    /** 一个功能的匹配域：id、名称、说明，以及它每个设置项上看得见的文案。 */
    private searchRecordOf(feature: FeatureDefinition): SearchRecord {
        const fields: SearchField[] = [fieldOf(feature.id), this.staticField(feature.name)];
        if (feature.description) {
            fields.push(this.staticField(feature.description));
        }
        feature.settings.forEach((field) => {
            // 内部 key 始终可搜，与它有没有文案无关
            fields.push(fieldOf(field.key));
            if (field.kind === "note") {
                // 说明块：可见文字（各语言）+ 占位符的值与链接标签，算同一个字段
                fields.push(fieldOf(
                    ...this.localeTexts(field.text),
                    ...Object.values(field.values ?? {}),
                    ...Object.values(field.labels ?? {}),
                ));
                return;
            }
            fields.push(this.staticField(field.title));
            if (field.description) {
                fields.push(this.staticField(field.description));
            }
            if ((field.kind === "text" || field.kind === "textarea") && field.placeholder) {
                fields.push(this.staticField(field.placeholder));
            }
            if (field.kind === "select") {
                if (field.optionsProvider) {
                    // 候选集只有运行时才知道（笔记本、插件列表），只收此刻解析出的标签
                    fields.push(fieldOf(...this.selectOptionsOf(field).map((option) => option.label)));
                } else {
                    (field.options ?? []).forEach((option) => fields.push(this.staticField(option.label)));
                }
            }
            if (field.kind === "button") {
                // 字符串型按钮文字是 i18n key（各语言都收）；函数型跟着运行期状态变，
                // 只收此刻算出来的那一份
                fields.push(
                    typeof field.label === "function" ?
                        fieldOf(this.actionLabel(field.label, feature.id)) :
                        this.staticField(field.label),
                );
            }
        });
        return {id: feature.id, fields};
    }

    /** 一条静态 i18n 文案的匹配域：当前语言那一份，加上各语言文件里的同一条。 */
    private staticField(key: string): SearchField {
        return fieldOf(...this.localeTexts(key));
    }

    /**
     * 一个 i18n key 的全部语言版本。
     *
     * 当前语言取宿主给的 `plugin.i18n`（也就是面板上真正显示的那份），其余语言直接读插件自带的
     * 语言文件；查不到的 key 一律丢掉，不要让「找不到文案时回退成 key 本身」污染索引。
     */
    private localeTexts(key: string): string[] {
        const current = this.options.plugin.i18n?.[key];
        const texts = [current, ...LOCALE_TEXTS.map((locale) => locale[key])];
        return texts.filter((text): text is string => typeof text === "string" && text.trim() !== "");
    }

    /** 面板根元素（带布局类的那个 div）。 */
    private panelElement(root: HTMLElement): HTMLElement | null {
        return root.querySelector<HTMLElement>(`.${PANEL_CLASS}`);
    }

    /** 记下搜索前的滚动位置：桌面端每页自己滚，移动端滚的是宿主的内容区，两处都要记。 */
    private captureScroll(root: HTMLElement): void {
        const panes = new Map<string, number>();
        root.querySelectorAll<HTMLElement>("[data-ss-tab-panel]").forEach((pane) => {
            panes.set(pane.dataset.ssTabPanel as string, pane.scrollTop);
        });
        this.searchSnapshot = {
            content: root.querySelector<HTMLElement>(".b3-dialog__content")?.scrollTop ?? 0,
            views: root.querySelector<HTMLElement>(`.${PANEL_CLASS}__panes`)?.scrollTop ?? 0,
            panes,
        };
    }

    /**
     * 把滚动位置还给搜索前的视图。
     *
     * 刚显示回来的容器偶尔还量不到滚动高度（赋值被吞掉），所以下一帧再补一次：
     * 已经生效的内核上这一次是空操作，卡片关闭时由 `disposeSearch()` 收掉这一帧。
     */
    private restoreScroll(root: HTMLElement): void {
        const snapshot = this.searchSnapshot;
        if (!snapshot) {
            return;
        }
        this.searchSnapshot = undefined;
        const apply = (): void => {
            const content = root.querySelector<HTMLElement>(".b3-dialog__content");
            const views = root.querySelector<HTMLElement>(`.${PANEL_CLASS}__panes`);
            if (content) {
                content.scrollTop = snapshot.content;
            }
            if (views) {
                views.scrollTop = snapshot.views;
            }
            root.querySelectorAll<HTMLElement>("[data-ss-tab-panel]").forEach((pane) => {
                pane.scrollTop = snapshot.panes.get(pane.dataset.ssTabPanel as string) ?? 0;
            });
        };
        apply();
        if (typeof requestAnimationFrame !== "function") {
            return;
        }
        if (this.scrollFrame !== undefined) {
            window.cancelAnimationFrame(this.scrollFrame);
        }
        this.scrollFrame = requestAnimationFrame(() => {
            this.scrollFrame = undefined;
            if (root.isConnected) {
                apply();
            }
        });
    }

    /**
     * 收起移动端页签栏之前，把它此刻的真实高度写进 `--ss-tabbar-height`。
     *
     * 这条的高度由内容撑出来（`auto`），`auto → 0` 没法过渡；量成像素值当起点之后，
     * CSS 里那条 `height: var(--ss-tabbar-height, auto)` 就能从它平滑收到 0。
     * 桌面端没有这条页签栏，`querySelector` 直接取不到、什么都不做。
     *
     * 变量还在时不再重量：收起 / 展开的过渡途中量到的是动画中间的高度，
     * 拿它当起点会把下一次展开收到一半就停住。等展开结束（`releaseTabBarHeight`）再删。
     */
    private lockTabBarHeight(root: HTMLElement): void {
        const bar = root.querySelector<HTMLElement>(".layout-tab-bar");
        if (!bar || bar.style.getPropertyValue(TABBAR_HEIGHT_VAR)) {
            return;
        }
        // 正常状态下 offsetHeight 就是自然高度；已经在收起途中（高度 0）时退回 scrollHeight，
        // 它量的是内容高度、不受当前动画高度影响。量不到（0）就不写，CSS 退回 auto。
        const height = bar.offsetHeight || bar.scrollHeight;
        if (height > 0) {
            bar.style.setProperty(TABBAR_HEIGHT_VAR, `${height}px`);
            // 强制一次回流：自定义属性必须和后面的类分两次样式计算落地，否则浏览器只看到
            // 「auto → 0」——起点不可过渡，收起会直接跳过去。读一次 offsetHeight 就分开了。
            void bar.offsetHeight;
        }
    }

    /**
     * 展开过渡结束之后，删掉那个起点高度，让页签栏的高度回到 `auto`。
     *
     * 留着它也能用（它就是当时的自然高度），但方向变了、字号变了、页签折行了，
     * 这个像素值就成了死数 —— 过渡一完就交还给内容自己算。
     */
    private releaseTabBarHeight(root: HTMLElement): void {
        if (this.tabBarTimer !== undefined) {
            window.clearTimeout(this.tabBarTimer);
            this.tabBarTimer = undefined;
        }
        const bar = root.querySelector<HTMLElement>(".layout-tab-bar");
        if (!bar) {
            return;
        }
        this.tabBarTimer = window.setTimeout(() => {
            this.tabBarTimer = undefined;
            bar.style.removeProperty(TABBAR_HEIGHT_VAR);
        }, TABBAR_ANIM_MS);
    }

    /** 收掉搜索留下的东西：快捷键监听、补帧与状态；幂等，面板关闭与重新打开都会走这里。 */
    private disposeSearch(): void {
        this.releaseSearchKeys();
        if (this.scrollFrame !== undefined) {
            window.cancelAnimationFrame(this.scrollFrame);
            this.scrollFrame = undefined;
        }
        if (this.tabBarTimer !== undefined) {
            window.clearTimeout(this.tabBarTimer);
            this.tabBarTimer = undefined;
        }
        this.searchActive = false;
        this.searchText = "";
        this.searchSnapshot = undefined;
    }
}
