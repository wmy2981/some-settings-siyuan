/**
 * 插件核心类型与功能契约。
 *
 * 这里定义的东西是所有功能与核心机制之间的唯一接口：功能只依赖本文件，
 * 功能之间不互相依赖，跨功能协作一律经由 src/core/。
 */
import type {
    Plugin,
    Protyle,
    subMenu,
    TEventBus,
    IEventBusMap,
    ICommand,
    IPluginDockTab,
} from "siyuan";
import type {Logger} from "./log";

/**
 * 设置项分类：按功能**作用到的思源原生功能**划分，一个分类就是设置面板里的一个页签。
 *
 * 刻意不保留「功能 / 界面 / 关于」这种从插件视角出发的划分：它把同一块原生界面的设置
 * 拆到不同页签里（例如文档树的强调色在「界面」、文档树标题的 Markdown 也在「界面」，
 * 而文档树的图标却在「功能」），用户想找一个设置只能通读三个页签。按原生功能区划分后，
 * 「我要改文档树」这件事在同一个页签里就能办完。
 *
 * - ai：智能体面板与人工智能设置
 * - editor：正文编辑、资源与录音
 * - doc-tree：文档树、页签与文档图标
 * - appearance：弹窗、栏体、侧栏等界面外观
 * - connection：内核连接
 * - settings：思源的设置页与集市
 * - plugin：本插件自身的维护与说明
 */
export type FeatureCategory =
    | "ai"
    | "editor"
    | "doc-tree"
    | "appearance"
    | "connection"
    | "settings"
    | "plugin";

/** 页签顺序：面板照这份数组渲染，没内容的不出现。 */
export const FEATURE_CATEGORIES: FeatureCategory[] = [
    "ai",
    "editor",
    "doc-tree",
    "appearance",
    "connection",
    "settings",
    "plugin",
];

/**
 * 功能适用的前端。
 *
 * 不写表示「两端都适用」；写了则只在该前端注册面板、挂载实现。
 * 只有那些天生只对一个前端有意义的项才需要声明，例如只在移动端存在的入口。
 */
export type FeatureFrontend = "desktop" | "mobile";

/** 每个功能的配置值。字符串 key 与 SettingField.key 一一对应。 */
export type FeatureConfig = Record<string, unknown>;

/** 下拉选项。label 是 i18n key，不是字面量。 */
export interface SettingOption {
    value: string;
    label: string;
}

/**
 * 动作行能拿到的平台能力。
 *
 * 动作行是「点击立刻执行、没有可持久化取值」的入口，它不参与挂载，
 * 因此拿不到 FeatureHost。这里按需给出它真正要用的东西，
 * 一方面避免功能为了一个按钮去 import 注册表（那会形成 core ↔ feature 的循环依赖），
 * 一方面也不必让功能长期挂载只为了保存一个引用。
 */
export interface FeatureActionContext {
    /** 解析 i18n key，缺失时回落到 key 本身。 */
    readonly i18n: (key: string) => string;
    /** 这个动作行所属的功能 id。动作行拿到它才能改动自己的配置。 */
    readonly featureId: string;
    /**
     * 插件名。动作行不参与挂载，拿不到 FeatureHost；需要在插件自己的存储目录下
     * 读写额外文件（例如自定义图标）时，用它拼出 `data/storage/petal/<插件名>/…`。
     */
    readonly pluginName: string;
    /**
     * 注册「插件卸载 / 重载时」的清理回调，返回取消注册的函数。
     *
     * 动作行打开的窗口不属于任何挂载实例，插件卸载时不会自动消失；
     * 打开窗口的动作行必须用它把窗口收掉。
     */
    onUnload(listener: () => void): () => void;
    /** 读某个功能此刻的配置快照（只读副本，改了不落盘）。 */
    configOf(featureId: string): FeatureConfig;
    /**
     * 立即合并并落盘某个功能的配置，同时通知订阅者（开关变动会立刻挂载或卸载功能）。
     *
     * 写盘成功后订阅者会立刻收到通知，设置面板也据此把对应控件改成磁盘上的值，
     * 界面与磁盘不会各说各话。
     */
    updateConfig(featureId: string, patch: FeatureConfig): Promise<void>;
    /**
     * 清除本插件存储目录（`data/storage/petal/<插件名>/`）下的全部配置文件：
     * 逐个删除、回落默认值并通知各功能。目标是目录里的文件，与功能声明是否启用、
     * 当前前端是否适用、功能是否已退役都无关。有任何一个文件删不掉就抛出（附 problems），
     * 不允许静默通过。
     */
    clearAllConfigs(): Promise<void>;
    /** 导出存储目录下全部配置文件的当前内容，键是功能 id。 */
    exportConfigs(): Promise<Record<string, FeatureConfig>>;
    /**
     * 把一批配置写回各自的配置文件（导入）。认识的 id 按它的 schema 归一化，不认识的 id
     * 原样写回；值与 id 不合规的条目原样返回给调用方汇报。校验或写盘失败时抛出（附 problems）。
     */
    importConfigs(config: Record<string, unknown>): Promise<{applied: string[]; skipped: string[];}>;
}

/**
 * 说明块（`kind: "note"`）底部的一个动作按钮。
 *
 * 与独立的动作行是同一套东西：没有可持久化取值、不参与配置读写、
 * 只读 / 发布模式下禁用、点击由面板统一走 `bindPendingClick`。
 * 区别只在于它属于这段说明（「去点星」「捐赠」这类），单独占一行反而把一段话拆成了三条设置，
 * 所以它挂在 `note` 上：桌面端与其它行同构 —— 文字在左、按钮竖着叠在右侧（每颗 200px），
 * 窄屏放不下时才落到文字下面、各撑满整行。
 */
export interface NoteAction {
    /** 与动作行的 key 同一套规则：功能内唯一，面板按「功能 id + key」绑定点击。 */
    key: string;
    /** 按钮文字。字符串是 i18n key；函数型每次打开面板求值，返回值直接当文案。 */
    label: string | ((context: FeatureActionContext) => string);
    /** 与动作行相同的外观选项，见 `SettingField` 的 `button`。 */
    appearance?: "outline" | "block";
    tone?: "primary" | "pink";
    /** 文字前的思源内置 symbol 名（如 `iconGithub`）。 */
    icon?: string;
    /**
     * 文字前的现成 SVG 标记，原样插入 —— 思源自己那张赞助图标就没有对应 symbol。
     * 只能是代码里的常量，不要拼接运行期字符串。
     */
    iconSvg?: string;
    onClick: (context: FeatureActionContext) => void | Promise<void>;
}

/**
 * 设置面板里的一行控件。
 *
 * 刻意没有分组型字段：面板是「分类标题 + 设置行」的一层结构，
 * 任何嵌套分组都会重新引入层级，所以从类型上就不提供表达方式。
 */
export type SettingField =
    | {
        kind: "switch";
        key: string;
        title: string;
        description?: string;
        default: boolean;
    }
    | {
        kind: "text";
        key: string;
        title: string;
        description?: string;
        default: string;
        placeholder?: string;
    }
    | {
        /**
         * 多行文本。取值语义与 `text` 完全相同（存字符串），只是控件换成 `<textarea>`，
         * 供「一行一项」这类列表型输入（例如作者名单）使用；行的切分方式由功能自己解释。
         */
        kind: "textarea";
        key: string;
        title: string;
        description?: string;
        default: string;
        placeholder?: string;
        /** 可见行数，默认 6；写进 `rows` 属性，不随内容自适应。 */
        rows?: number;
    }
    | {
        kind: "number";
        key: string;
        title: string;
        description?: string;
        default: number;
        min?: number;
        max?: number;
        step?: number;
        unit?: string;
    }
    | {
        kind: "select";
        key: string;
        title: string;
        description?: string;
        default: string;
        /**
         * 静态选项。与 optionsProvider 二选一。
         */
        options?: SettingOption[];
        /**
         * 运行时生成的选项，面板每次打开时求值。
         * 用于「笔记本 / 插件 / 标签」这类只有运行时才知道的候选集；
         * 走这条路时不再做白名单校验，失效的值由功能自己兜底。
         */
        optionsProvider?: () => SettingOption[];
    }
    | {
        /**
         * 只读说明块：整行铺满的文字，没有任何控件，不参与配置的读写。
         * 只用于面向用户的说明（插件性质、版本号、仓库地址这类），不是设置项。
         *
         * `text` 是 i18n key；值按 `\n` 分段，其中的 `{name}` 占位符由 `values` 逐项替换，
         * 替换值本身是 http(s) 链接时渲染成可点的链接，链接文字默认就是地址本身，
         * `labels` 里给了同名的短写时用它。
         *
         * `actions` 是排在说明文字**下方**的一组按钮（见 `NoteAction`）：说明块长起来以后，
         * 与它配套的入口跟在文字后面比另起几行更清楚，也不会被当成三项独立的设置。
         */
        kind: "note";
        key: string;
        text: string;
        values?: Record<string, string>;
        labels?: Record<string, string>;
        actions?: NoteAction[];
    }
    | {
        /**
         * 纯动作行：点击立刻执行，不参与配置的读写。
         * 只允许用于「打开某个诊断窗口」这类没有可持久化取值的入口。
         */
        kind: "button";
        key: string;
        title: string;
        description?: string;
        /**
         * 按钮外观。默认 `outline` —— 内核设置里那种靠右的次要按钮，定宽 200px。
         * `block` 撑满这一格宽度，与思源「关于」页那颗捐赠按钮同构：
         * 桌面端 200px、窄屏由面板的媒体查询放开到整行。
         */
        appearance?: "outline" | "block";
        /** `block` 外观的底色：`primary`（默认，思源主题色）或 `pink`（思源捐赠按钮那颗粉）。 */
        tone?: "primary" | "pink";
        /** 按钮文字前的思源内置 symbol 名（如 `iconGithub`）；不写就只有文字。 */
        icon?: string;
        /** 按钮文字前的现成 SVG 标记，原样插入（思源自己那张赞助图标没有对应 symbol）。 */
        iconSvg?: string;
        /**
         * 按钮文字。字符串是 i18n key；给函数时每次打开面板求值，
         * **返回值直接当文案用**（函数内部自己取 i18n），用于文案要跟着运行期状态变的入口
         * —— 例如「目标插件装了没装」决定按钮是「打开设置」还是「去集市安装」。
         */
        label: string | ((context: FeatureActionContext) => string);
        onClick: (context: FeatureActionContext) => void | Promise<void>;
    };

/** 功能被启用时要处理的所有 UI 注册入口。 */
export interface FeatureHost {
    readonly plugin: Plugin;
    readonly id: string;
    /** 已经按 schema 归一化过的当前配置。 */
    readonly config: FeatureConfig;
    /** 插件卸载时 abort，功能应据此取消异步工作。 */
    readonly signal: AbortSignal;
    /** 解析 i18n key，缺失时回落到 key 本身。 */
    readonly i18n: (key: string) => string;
    /**
     * 本功能的分级日志器，头部自动带 `[some-settings-siyuan__<功能 id>]`。
     * 详细日志关着时什么都不输出；文案用英文，不参与 i18n。
     */
    readonly log: Logger;
    /** 落盘并通知功能自身，patch 会与当前配置合并。 */
    setConfig(patch: FeatureConfig): Promise<void>;
    /** 订阅本功能配置变化（设置面板落盘或动作行改动后触发），随插件卸载自动退订。 */
    onConfigChange(listener: () => void): void;
    /** 注入一段只属于该功能的 CSS，返回撤销函数。 */
    addStyle(css: string): () => void;
    /** 顶栏按钮。必须在 onload 阶段同步调用。 */
    addTopBar(options: {
        id?: string;
        icon: string;
        title: string;
        callback: (event: MouseEvent) => void;
        contextMenu?: (menu: subMenu) => void;
    }): HTMLElement | undefined;
    addCommand(options: ICommand): void;
    /**
     * 注册一条斜杠命令（在编辑器里输入 `/` 时出现在候选里）。
     *
     * 与 addTopBar / addCommand 不同，宿主的 `protyleSlash` 是**每次打开斜杠菜单时才读取**的
     * 数组，所以它可以在功能挂载后动态增删，不会错过 onload 那段同步注册窗口。
     * 必须在 mount 里同步调用；条目随功能卸载自动移除。
     */
    addProtyleSlash(options: {
        id: string;
        filter: string[];
        html: string;
        showInLite?: boolean;
        callback: (protyle: Protyle, nodeElement: HTMLElement) => void;
    }): void;
    /** 注册内联 SVG symbol，供顶栏/菜单图标引用。 */
    addIcons(svg: string): void;
    addStatusBar(options: {element: HTMLElement; position?: "right" | "left";}): HTMLElement | undefined;
    addDock(options: {
        id?: string;
        config: IPluginDockTab;
        data: unknown;
        type: string;
        init: (element: HTMLElement) => void;
    }): void;
    addTab(options: {type: string; destroy?: () => void; init: (element: HTMLElement) => void;}): void;
    addEventBus<K extends TEventBus>(type: K, listener: (event: CustomEvent<IEventBusMap[K]>) => unknown): void;
    showMessage(text: string): void;
}

/** 功能挂载后返回的清理接口；返回 void 表示无需额外清理。 */
export interface FeatureInstance {
    destroy?: () => void;
}

/** 每个功能文件夹 index.ts 的默认导出。 */
export interface FeatureDefinition {
    /** 必须等于功能文件夹名，也等于它自己的配置文件名（`feature-<id>`）。 */
    id: string;
    category: FeatureCategory;
    /** i18n key，不是字面量。 */
    name: string;
    description?: string;
    /**
     * 这个功能是否随插件一起交出：`false` 表示不加载它的配置、不在设置面板里出现、
     * 也不挂载（代码仍然在包里，只是不起作用）。
     *
     * 它只表达「这个功能还要不要」，**不是**用户那个「启用 / 关闭」开关：
     * 用户开关仍由功能自己的 `enabled` 设置项或 `isEnabled` 谓词决定，默认关闭。
     * 想要彻底退场（上游已原生实现）不要用它，用 `maxAppVersion`。
     */
    enabled: boolean;
    /** 不写表示桌面端与移动端都适用。 */
    frontends?: FeatureFrontend[];
    /**
     * 支持该功能的最低思源版本（含）。不写表示不限下限。
     *
     * 写法与思源版本号一致（如 `"3.8.7-alpha.2"`），按 semver 比较：
     * `alpha < beta < rc < 正式版`，同一段预发布内部数字越大越新。
     */
    minAppVersion?: string;
    /**
     * 支持该功能的最高思源版本（含）。不写表示不限上限。
     *
     * 用于「上游自己实现了」的退场：宿主版本一旦超过这个值，插件就不再加载它的配置、
     * 不再在设置面板里显示它、也不再挂载。若上游从 `3.8.10-alpha.2` 起已经实现，
     * 这里就写它的前一个版本 `"3.8.10-alpha.1"`。
     */
    maxAppVersion?: string;
    settings: SettingField[];
    /**
     * 该功能此刻是否应当运行。
     *
     * 不写表示看面板里那个 `enabled` 开关（默认关闭）。只有当开关不是一个布尔量时
     * 才需要自己声明，例如用一个 `select` 的「禁用」选项当开关的功能。
     */
    isEnabled?(config: FeatureConfig): boolean;
    /** 仅在功能生效（activeFeatures）且 isEnabled 为真时调用。 */
    mount?(host: FeatureHost): FeatureInstance | void;
}

/** 定义辅助函数：只做类型约束，不改变行为。 */
export const defineFeature = (definition: FeatureDefinition): FeatureDefinition => definition;
