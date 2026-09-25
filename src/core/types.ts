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

/** 设置项分类，对应设置面板左侧的三个入口。 */
export type FeatureCategory = "function" | "ui" | "dev";

export const FEATURE_CATEGORIES: FeatureCategory[] = ["function", "ui", "dev"];

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

/** 设置面板里的一行（或一组）控件。 */
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
        options: {value: string; label: string;}[];
    }
    | {
        kind: "group";
        title: string;
        description?: string;
        children: SettingField[];
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
    settings: SettingField[];
    /** 仅在 mountEnabled 为真时调用。 */
    mount?(host: FeatureHost): FeatureInstance | void;
}

/** 定义辅助函数：只做类型约束，不改变行为。 */
export const defineFeature = (definition: FeatureDefinition): FeatureDefinition => definition;
