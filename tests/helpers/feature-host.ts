/**
 * `FeatureHost` 的测试替身。
 *
 * 功能层（`src/features/`）拿不到插件实例，只通过 `FeatureHost` 跟平台打交道，
 * 所以测试里给它一份「记录 + 可驱动」的宿主：注册了什么、注入了哪段 CSS、订阅了
 * 哪些事件、`destroy()` 之后有没有拆干净，全部能从 `records` 里读到。
 *
 * 这里刻意照 `core/bootstrap.ts` 的 unmount 顺序实现 `dispose()`：
 * abort → teardown 倒序 → destroy → 移除样式。测试直接用 `dispose()` 断言「卸载无残留」，
 * 不必关心宿主内部字段。
 */
import {vi} from "vitest";
import {defaultConfig} from "../../src/core/config";
import {
    addStyle,
    removeStylesOf,
} from "../../src/core/style";
import type {
    FeatureActionContext,
    FeatureConfig,
    FeatureDefinition,
    FeatureHost,
    FeatureInstance,
    SettingField,
} from "../../src/core/types";

/** 只需要一个日志器的测试用的空实现（接口是分级的，直接写函数已经不合身）。 */
export const noopLogger = {
    scope: "test",
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
};

/** 一次 `addTopBar` / `addStatusBar` / `addDock` / `addTab` 的调用记录。 */
export interface RegistrationRecord {
    // 各注册入口的入参形状不同，测试按需取字段，这里不逐一收窄
    options: Record<string, any>;
    element?: HTMLElement;
}

/** 一次 `addEventBus` 的调用记录。 */
export interface BusRecord {
    type: string;
    listener: (event: any) => unknown;
}

/** 宿主替身记录下来的全部副作用。 */
export interface HostRecords {
    /** 每次 `addStyle` 的 CSS（按调用顺序）。 */
    styles: string[];
    topBars: RegistrationRecord[];
    statusBars: RegistrationRecord[];
    commands: Record<string, any>[];
    slashes: Record<string, any>[];
    icons: string[];
    docks: RegistrationRecord[];
    tabs: RegistrationRecord[];
    bus: BusRecord[];
    messages: string[];
    /** 每次 `setConfig` 的入参。 */
    patches: FeatureConfig[];
    /** `onConfigChange` 注册的回调。 */
    configListeners: (() => void)[];
    /** 每次 `host.log.*` 的入参（按调用顺序）。 */
    logs: unknown[][];
    /** 与 `logs` 一一对应的级别，用来断言某条记录走的是哪一档。 */
    logLevels: string[];
}

/** 测试里操作一个已挂载功能的句柄。 */
export interface HostHarness {
    host: FeatureHost;
    records: HostRecords;
    /** `mount()` 的返回值（功能没返回就是 undefined）。 */
    instance?: FeatureInstance;
    /** 当前配置（可直接改，再调 `notifyConfigChange()` 模拟面板保存）。 */
    config: FeatureConfig;
    /** 触发一次配置变化，等价于面板点了保存。 */
    notifyConfigChange(): void;
    /** 以功能身份派发一条事件总线消息。 */
    emitBus(type: string, detail?: unknown): void;
    /** 按宿主的卸载顺序释放，幂等。 */
    dispose(): void;
    /** 当前注入的 CSS（多次注入时拼在一起）。 */
    css(): string;
    /** 该功能注入的 `<style>` 元素。 */
    styleElement(): HTMLStyleElement | null;
}

export interface HostOptions {
    /** 覆盖默认配置里的若干项。 */
    config?: FeatureConfig;
    /** i18n 解析器，默认原样返回 key（断言里好认）。 */
    i18n?: (key: string) => string;
}

const createRecords = (): HostRecords => ({
    styles: [],
    topBars: [],
    statusBars: [],
    commands: [],
    slashes: [],
    icons: [],
    docks: [],
    tabs: [],
    bus: [],
    messages: [],
    patches: [],
    configListeners: [],
    logs: [],
    logLevels: [],
});

/** 造一个功能宿主；`mount` 由调用方（`mountFeature`）或测试自己决定何时调。 */
export const createHost = (definition: FeatureDefinition, options: HostOptions = {}): HostHarness => {
    const records = createRecords();
    const controller = new AbortController();
    const teardowns: (() => void)[] = [];
    const instanceRef: {current?: FeatureInstance;} = {};

    const config: FeatureConfig = {...defaultConfig(definition.settings), ...options.config};
    const i18n = options.i18n ?? ((key: string) => key);

    const addTeardown = (teardown: () => void) => {
        if (controller.signal.aborted) {
            teardown();
            return;
        }
        teardowns.push(teardown);
    };

    const host: FeatureHost = {
        plugin: {
            name: "some-settings-siyuan",
            i18n: {},
            protyleSlash: [],
        } as unknown as FeatureHost["plugin"],
        id: definition.id,
        get config(): FeatureConfig {
            return config;
        },
        signal: controller.signal,
        i18n,
        log: {
            scope: definition.id,
            info: (...args: unknown[]) => {
                records.logs.push(args);
                records.logLevels.push("info");
            },
            warn: (...args: unknown[]) => {
                records.logs.push(args);
                records.logLevels.push("warn");
            },
            error: (...args: unknown[]) => {
                records.logs.push(args);
                records.logLevels.push("error");
            },
        },
        setConfig: async (patch: FeatureConfig) => {
            records.patches.push(patch);
            Object.assign(config, patch);
            records.configListeners.slice().forEach((listener) => listener());
        },
        onConfigChange: (listener: () => void) => {
            records.configListeners.push(listener);
            addTeardown(() => {
                const index = records.configListeners.indexOf(listener);
                if (index >= 0) {
                    records.configListeners.splice(index, 1);
                }
            });
        },
        addStyle: (css: string) => {
            records.styles.push(css);
            const remove = addStyle(definition.id, css);
            addTeardown(remove);
            return remove;
        },
        addTopBar: (options_) => {
            const element = document.createElement("div");
            element.className = "ss-test-topbar";
            records.topBars.push({options: options_, element});
            addTeardown(() => element.remove());
            return element;
        },
        addCommand: (options_) => {
            records.commands.push(options_);
        },
        addProtyleSlash: (options_) => {
            records.slashes.push(options_);
            const plugin = host.plugin as unknown as {protyleSlash: unknown[];};
            plugin.protyleSlash.push(options_);
            addTeardown(() => {
                const index = plugin.protyleSlash.indexOf(options_);
                if (index >= 0) {
                    plugin.protyleSlash.splice(index, 1);
                }
            });
        },
        addIcons: (svg: string) => {
            records.icons.push(svg);
        },
        addStatusBar: (options_) => {
            const element = document.createElement("div");
            element.className = "ss-test-statusbar";
            records.statusBars.push({options: options_, element});
            addTeardown(() => element.remove());
            return element;
        },
        addDock: (options_) => {
            records.docks.push({options: options_});
        },
        addTab: (options_) => {
            records.tabs.push({options: options_});
        },
        addEventBus: (type, listener) => {
            records.bus.push({type, listener: listener as (event: any) => unknown});
            addTeardown(() => {
                const index = records.bus.findIndex((item) => item.listener === listener);
                if (index >= 0) {
                    records.bus.splice(index, 1);
                }
            });
        },
        showMessage: (text: string) => {
            records.messages.push(text);
        },
    };

    const harness: HostHarness = {
        host,
        records,
        config,
        get instance() {
            return instanceRef.current;
        },
        notifyConfigChange: () => {
            records.configListeners.slice().forEach((listener) => listener());
        },
        emitBus: (type, detail) => {
            const event = new CustomEvent(type, {detail});
            records.bus
                .filter((item) => item.type === type)
                .slice()
                .forEach((item) => item.listener(event));
        },
        dispose: () => {
            controller.abort();
            teardowns.splice(0).reverse().forEach((teardown) => teardown());
            instanceRef.current?.destroy?.();
            instanceRef.current = undefined;
            removeStylesOf(definition.id);
        },
        css: () => records.styles.join("\n"),
        styleElement: () =>
            document.head.querySelector<HTMLStyleElement>(`style[data-some-settings-style="${definition.id}"]`),
    };

    // mount 返回的实例要记在实例上，dispose 与断言都靠它
    Object.defineProperty(harness, "setInstance", {
        value: (instance: FeatureInstance | undefined) => {
            instanceRef.current = instance;
        },
        enumerable: false,
    });

    return harness;
};

/**
 * 挂载一个功能，返回它的宿主句柄。
 *
 * 功能声明里没写 `mount` 时这里会抛错 —— 那种功能只有设置行 / 动作行，
 * 应该用 `createActionContext()` 测它的 `onClick`。
 */
export const mountFeature = (definition: FeatureDefinition, options: HostOptions = {}): HostHarness => {
    const harness = createHost(definition, options);
    if (!definition.mount) {
        throw new Error(`feature "${definition.id}" 没有 mount，不能按挂载测试`);
    }
    const instance = definition.mount(harness.host);
    (harness as unknown as {setInstance: (value: FeatureInstance | undefined) => void;}).setInstance(
        instance || undefined,
    );
    return harness;
};

/** 动作行的 `onClick` 拿到的上下文。 */
export interface ActionContextHarness {
    context: FeatureActionContext;
    /** `updateConfig` 的入参记录。 */
    patches: {featureId: string; patch: FeatureConfig;}[];
    /** `clearAllConfigs` / `exportConfigs` / `importConfigs` 的调用次数。 */
    calls: {clear: number; export: number; import: unknown[];};
    /** 注册进来的卸载回调。 */
    unloads: (() => void)[];
}

export interface ActionContextOptions {
    featureId: string;
    config?: FeatureConfig;
    i18n?: (key: string) => string;
    pluginName?: string;
    exportConfigs?: () => Promise<Record<string, FeatureConfig>>;
    importConfigs?: (config: Record<string, unknown>) => Promise<{applied: string[]; skipped: string[];}>;
}

/** 造一个动作行上下文（清理配置 / 导入导出 / 说明块按钮这类没有挂载的入口要用）。 */
export const createActionContext = (options: ActionContextOptions): ActionContextHarness => {
    const i18n = options.i18n ?? ((key: string) => key);
    const patches: {featureId: string; patch: FeatureConfig;}[] = [];
    const calls = {clear: 0, export: 0, import: [] as unknown[]};
    const unloads: (() => void)[] = [];

    const context: FeatureActionContext = {
        i18n,
        featureId: options.featureId,
        pluginName: options.pluginName ?? "some-settings-siyuan",
        onUnload: (listener: () => void) => {
            unloads.push(listener);
            return () => {
                const index = unloads.indexOf(listener);
                if (index >= 0) {
                    unloads.splice(index, 1);
                }
            };
        },
        configOf: () => ({...options.config}),
        updateConfig: async (featureId: string, patch: FeatureConfig) => {
            patches.push({featureId, patch});
        },
        clearAllConfigs: async () => {
            calls.clear += 1;
        },
        exportConfigs: async () => {
            calls.export += 1;
            return options.exportConfigs ? options.exportConfigs() : {};
        },
        importConfigs: async (config: Record<string, unknown>) => {
            calls.import.push(config);
            return options.importConfigs ? options.importConfigs(config) : {applied: [], skipped: []};
        },
    };

    return {context, patches, calls, unloads};
};

/** 设置项的 key 列表（跳过 `note` / `button` 这两类不参与配置的行）。 */
export const configKeysOf = (settings: SettingField[]): string[] =>
    settings
        .filter((field) => field.kind !== "note" && field.kind !== "button")
        .map((field) => field.key);

/** 方便测试断言「没被调用」用的空实现。 */
export const noop = (): void => undefined;

export { vi };
