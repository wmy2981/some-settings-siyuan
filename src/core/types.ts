/**
 * 插件核心类型与功能契约。
 *
 * 这里定义的东西是所有功能与核心机制之间的唯一接口：功能只依赖本文件，
 * 功能之间不互相依赖，跨功能协作一律经由 src/core/。
 */
import type {
    Plugin,
    subMenu,
    TEventBus,
    IEventBusMap,
    ICommand,
    IPluginDockTab,
} from "siyuan";

/** 设置项分类，对应设置面板里的三个小节标题（不是页签）。 */
export type FeatureCategory = "function" | "ui" | "dev";

export const FEATURE_CATEGORIES: FeatureCategory[] = ["function", "ui", "dev"];

/**
 * 功能适用的前端。
 *
 * 不写表示「两端都适用」；写了则只在该前端注册面板、挂载实现。
 * 只有那些天生只对一个前端有意义的项才需要声明，例如只在移动端存在的入口。
 */
export type FeatureFrontend = "desktop" | "mobile";

/**
 * feature-control.json 中每个 id 的四态开关。
 *
 * - 0: 该功能不加载已有配置，前端不显示
 * - 1: 该功能加载已有配置，前端显示并可设置
 * - 2: 该功能加载已有配置，前端不显示
 * - 3: 该功能不加载已有配置，前端显示并可设置
 */
export enum ControlState {
    Disabled = 0,
    Enabled = 1,
    Hidden = 2,
    ConfigurationOnly = 3,
}

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
 * 因此拿不到 FeatureHost。这里按需给出它真正要用的三件事，
 * 一方面避免功能为了一个按钮去 import 注册表（那会形成 core ↔ feature 的循环依赖），
 * 一方面也不必让功能长期挂载只为了保存一个引用。
 */
export interface FeatureActionContext {
    /** 解析 i18n key，缺失时回落到 key 本身。 */
    readonly i18n: (key: string) => string;
    /**
     * 清除本插件存储目录（`data/storage/petal/<插件名>/`）下的全部配置文件：
     * 逐个删除、回落默认值并通知各功能。目标是目录里的文件，与四态、当前前端是否适用、
     * 功能是否已退役都无关。有任何一个文件删不掉就抛出（附 problems），不允许静默通过。
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
         * 只读说明块：整行铺满的文字，没有任何控件，不参与配置的读写与「保存 / 取消」语义。
         * 只用于面向用户的说明（插件性质、版本号、仓库地址这类），不是设置项。
         *
         * `text` 是 i18n key；值按 `\n` 分段，其中的 `{name}` 占位符由 `values` 逐项替换，
         * 替换值本身是 http(s) 链接时渲染成可点的链接，链接文字默认就是地址本身，
         * `labels` 里给了同名的短写时用它。
         */
        kind: "note";
        key: string;
        text: string;
        values?: Record<string, string>;
        labels?: Record<string, string>;
    }
    | {
        /**
         * 纯动作行：点击立刻执行，不参与配置的读写与「保存 / 取消」语义。
         * 只允许用于「打开某个诊断窗口」这类没有可持久化取值的入口。
         */
        kind: "button";
        key: string;
        title: string;
        description?: string;
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
    /** 已经按四态处理过的当前配置。 */
    readonly config: FeatureConfig;
    /** 插件卸载时 abort，功能应据此取消异步工作。 */
    readonly signal: AbortSignal;
    /** 解析 i18n key，缺失时回落到 key 本身。 */
    readonly i18n: (key: string) => string;
    readonly log: (...args: unknown[]) => void;
    /** 落盘并通知功能自身，patch 会与当前配置合并。 */
    setConfig(patch: FeatureConfig): Promise<void>;
    /** 订阅本功能配置变化（面板点「保存」后触发），随插件卸载自动退订。 */
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
    /** 必须等于功能文件夹名，也等于 feature-control.json 里的 key。 */
    id: string;
    category: FeatureCategory;
    /** i18n key，不是字面量。 */
    name: string;
    description?: string;
    /** 不写表示桌面端与移动端都适用。 */
    frontends?: FeatureFrontend[];
    /**
     * 从该思源版本起，上游的原生实现已经取代本功能：插件不再加载它的配置、
     * 不再在设置面板里显示它、也不再挂载。写法与思源版本号一致（如 "3.8.7-alpha.2"），
     * 按 semver 比较，预发布版本小于同号正式版。
     *
     * 只用于「上游自己做了」的功能退役，不要拿它当普通的兼容性开关。
     */
    deprecatedSince?: string;
    settings: SettingField[];
    /**
     * 该功能此刻是否应当运行。
     *
     * 不写表示看面板里那个 `enabled` 开关（默认关闭）。只有当开关不是一个布尔量时
     * 才需要自己声明，例如用一个 `select` 的「禁用」选项当开关的功能。
     */
    isEnabled?(config: FeatureConfig): boolean;
    /** 仅在 mountEnabled 为真、且 isEnabled 为真时调用。 */
    mount?(host: FeatureHost): FeatureInstance | void;
}

/** 定义辅助函数：只做类型约束，不改变行为。 */
export const defineFeature = (definition: FeatureDefinition): FeatureDefinition => definition;
