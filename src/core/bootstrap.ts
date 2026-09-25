/**
 * 功能装载器：把「注册表 + feature-control.json 四态 + 配置存储 + 设置面板」串起来。
 *
 * 关键约束：
 * - addTopBar / addStatusBar / addDock / addTab 必须同步注册，所以 mount 全部在 onload 阶段跑；
 * - 单个功能的任何异常都被隔离，绝不影响其他功能与插件本体；
 * - 卸载时按 signal → teardown → destroy 的顺序释放，且全部幂等。
 */
import type {
    ICommand,
    IEventBusMap,
    IPluginDockTab,
    Plugin,
    subMenu,
    TEventBus,
} from "siyuan";
import {showMessage} from "siyuan";
import {ConfigStore} from "./config";
import {
    controlOf,
    controlSnapshot,
    validateControl,
} from "./control";
import {
    guardSilent,
    reportError,
} from "./error";
import {
    ALL_FEATURE_IDS,
    FEATURES,
} from "./registry";
import {SettingsPanel} from "./setting-dialog";
import {
    addStyle,
    removeStylesOf,
} from "./style";
import type {
    FeatureConfig,
    FeatureDefinition,
    FeatureHost,
    FeatureInstance,
} from "./types";

interface MountedFeature {
    definition: FeatureDefinition;
    host: FeatureHost;
    instance?: FeatureInstance;
    controller: AbortController;
    teardowns: (() => void)[];
}

export class FeatureManager {
    private readonly plugin: Plugin;
    readonly store: ConfigStore;
    readonly panel: SettingsPanel;
    private readonly mounted = new Map<string, MountedFeature>();
    private disposed = false;

    constructor(plugin: Plugin) {
        this.plugin = plugin;
        this.store = new ConfigStore(plugin);
        this.panel = new SettingsPanel({
            plugin,
            store: this.store,
            features: FEATURES,
            controlOf: (id) => controlSnapshot(id),
        });
    }

    /**
     * 建立全部功能的配置内存态，并按四态真正启动功能。
     * 由插件在 onload 阶段调用一次。
     */
    async load(): Promise<void> {
        validateControl(ALL_FEATURE_IDS);
        for (const definition of FEATURES) {
            const control = controlOf(definition.id);
            // showUi 为真但 mountEnabled 为假（state 3）时也要有配置，才能显示和保存设置
            const loadEnabled = control.loadEnabled;
            try {
                await this.store.register(definition, loadEnabled);
            } catch (error) {
                reportError(`${definition.id}.config`, error);
                continue;
            }
            if (control.mountEnabled) {
                this.mount(definition);
            }
        }
    }

    private mount(definition: FeatureDefinition): void {
        const controller = new AbortController();
        const teardowns: (() => void)[] = [];
        const record: MountedFeature = {definition, controller, teardowns, host: undefined as unknown as FeatureHost};
        const host = this.createHost(record);
        record.host = host;
        this.mounted.set(definition.id, record);

        if (!definition.mount) {
            return;
        }
        try {
            const instance = definition.mount(host);
            if (instance && typeof instance.destroy === "function") {
                record.instance = instance;
            }
        } catch (error) {
            reportError(`${definition.id}.mount`, error);
            // 回滚该功能已经注册的 UI，其他功能不受影响
            this.unmount(definition.id);
        }
    }

    /** 手动移除单个功能（异常回滚用）。 */
    private unmount(id: string): void {
        const record = this.mounted.get(id);
        if (!record) {
            return;
        }
        this.mounted.delete(id);
        guardSilent(`${id}.abort`, () => record.controller.abort());
        record.teardowns.splice(0).reverse().forEach((teardown) => {
            guardSilent(`${id}.teardown`, teardown);
        });
        if (record.instance?.destroy) {
            guardSilent(`${id}.destroy`, () => record.instance?.destroy?.());
        }
        guardSilent(`${id}.style`, () => removeStylesOf(id));
    }

    private createHost(record: MountedFeature): FeatureHost {
        const {definition, controller} = record;
        const plugin = this.plugin;
        const store = this.store;
        const addTeardown = (teardown: () => void) => {
            if (controller.signal.aborted) {
                guardSilent(`${definition.id}.teardown`, teardown);
                return;
            }
            record.teardowns.push(teardown);
        };

        return {
            plugin,
            id: definition.id,
            get config(): FeatureConfig {
                return store.get(definition.id);
            },
            signal: controller.signal,
            i18n: (key: string) => {
                const value = plugin.i18n?.[key];
                return typeof value === "string" && value ? value : key;
            },
            log: (...args: unknown[]) => console.log(`[some-settings-siyuan][${definition.id}]`, ...args),
            setConfig: async (patch: FeatureConfig) => {
                await store.patch(definition.id, patch);
            },
            onConfigChange: (listener: () => void) => {
                addTeardown(store.subscribe(definition.id, listener));
            },
            addStyle: (css: string) => {
                const remove = addStyle(definition.id, css);
                addTeardown(remove);
                return remove;
            },
            addTopBar: (options) => {
                const element = plugin.addTopBar({
                    id: options.id,
                    icon: options.icon,
                    title: options.title,
                    callback: options.callback,
                    contextMenu: options.contextMenu as ((menu: subMenu) => void) | undefined,
                });
                addTeardown(() => plugin.removeTopBar(options.id || options.title));
                return element;
            },
            addCommand: (options: ICommand) => {
                plugin.addCommand(options);
                // 宿主没有提供单条命令的移除 API：命令随插件卸载一起释放，
                // 因此这里不做 teardown，避免误删其他功能注册的命令。
            },
            addIcons: (svg: string) => {
                plugin.addIcons(svg);
            },
            addStatusBar: (options) => {
                const element = plugin.addStatusBar(options);
                addTeardown(() => element?.remove());
                return element;
            },
            addDock: (options) => {
                const dock = plugin.addDock({
                    id: options.id,
                    config: options.config as IPluginDockTab,
                    data: options.data,
                    type: options.type,
                    init(this: unknown, custom: {element: Element;}) {
                        options.init(custom.element as HTMLElement);
                    },
                } as never);
                addTeardown(() => plugin.removeDock(dock?.id || options.id || options.type));
            },
            addTab: (options) => {
                plugin.addTab({
                    type: options.type,
                    destroy: options.destroy,
                    init(this: unknown, custom: {element: Element;}) {
                        options.init(custom.element as HTMLElement);
                    },
                } as never);
            },
            addEventBus: <K extends TEventBus>(type: K, listener: (event: CustomEvent<IEventBusMap[K]>) => unknown) => {
                plugin.eventBus.on(type, listener);
                addTeardown(() => plugin.eventBus.off(type, listener));
            },
            showMessage: (text: string) => showMessage(text, 4000),
        };
    }

    /** 设置面板入口。 */
    openSettings(): void {
        this.panel.show();
    }

    /** 插件卸载：释放全部功能与设置面板。幂等。 */
    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        guardSilent("panel.close", () => this.panel.close());
        [...this.mounted.keys()].forEach((id) => this.unmount(id));
        guardSilent("config.dispose", () => this.store.dispose());
    }
}
