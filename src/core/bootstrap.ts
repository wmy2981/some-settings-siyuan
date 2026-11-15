/**
 * 功能装载器：把「注册表 + 各功能的声明 + 配置存储 + 设置面板」串起来。
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
    guardSilent,
    reportError,
} from "./error";
import {
    currentFrontend,
    supportsCurrentFrontend,
} from "./frontend";
import {
    createLogger,
    isDetailedLogging,
    LOG_FEATURE_ID,
    setDetailedLogging,
} from "./log";
import {
    activeFeatures,
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

/**
 * 功能此刻是否应当运行。
 *
 * 默认看面板里那个 `enabled` 开关（每个功能都必须有一个，默认关闭）；
 * 用别的控件当开关的功能（例如拿 select 的「禁用」选项当开关）自己声明 isEnabled。
 */
const isEnabled = (definition: FeatureDefinition, config: FeatureConfig): boolean =>
    definition.isEnabled ? definition.isEnabled(config) : config.enabled === true;

/** 功能没被装载的原因，写进加载日志：排查「开关明明开着却没生效」时先看这一行。 */
const skipReason = (definition: FeatureDefinition): string => {
    if (!definition.enabled) {
        return "the declaration says enabled: false";
    }
    if (!supportsCurrentFrontend(definition)) {
        return `it does not apply to the ${currentFrontend()} frontend`;
    }
    return "the host version is outside its declared range";
};

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
    private readonly log = createLogger("core.bootstrap");
    private disposed = false;

    constructor(plugin: Plugin) {
        this.plugin = plugin;
        this.store = new ConfigStore(plugin);
        this.panel = new SettingsPanel({
            plugin,
            store: this.store,
            features: activeFeatures(),
        });
    }

    /**
     * 建立全部生效功能的配置内存态，并按各功能自己的开关决定挂不挂载。
     * 由插件在 onload 阶段调用一次。
     */
    async load(): Promise<void> {
        const active = activeFeatures();
        // 先把各功能的读盘请求并发发出去：每个功能一个文件、互不依赖，逐个 await 会把
        // N 次内核往返串成一条线。这里不等结果（每条请求各自兑现），所以某个文件读得慢
        // 不会拖住排在它前面的功能；下面的注册与挂载仍按注册表顺序逐个进行。
        await this.store.prefetch(active);
        // 「日志输出」必须先落地：它挂载时才打开详细日志，排在别的功能后面的话，
        // 它前面那些功能的装载日志会被开关吞掉。注册表里它也必须是第一个，
        // `tests/core/registry.test.ts` 守着这条约定。
        const logDefinition = active.find((definition) => definition.id === LOG_FEATURE_ID);
        if (logDefinition && await this.register(logDefinition)) {
            this.syncMount(logDefinition);
        }
        this.log.info(`loading ${active.length} of ${FEATURES.length} feature(s)`, {
            frontend: currentFrontend(),
            kernelVersion: window.siyuan?.config?.system?.kernelVersion ?? "unknown",
            detailedLogging: isDetailedLogging(),
        });
        // 不生效的功能（前端对不上、宿主版本超出支持区间、声明 enabled: false）根本不在
        // activeFeatures() 里：既不会读配置、也不会出现在面板里、更不会挂载。
        // 它们最容易被误当成「功能坏了」，所以逐条写明跳过的原因。
        FEATURES.filter((definition) => !active.includes(definition)).forEach((definition) => {
            this.log.info(`skip ${definition.id}: ${skipReason(definition)}`);
        });
        for (const definition of active) {
            if (definition === logDefinition) {
                continue;
            }
            if (await this.register(definition)) {
                this.syncMount(definition);
            }
        }
    }

    /**
     * 注册一个功能的配置并订阅它的开关。
     *
     * 面板一保存就立刻按新开关生效：打开即挂载、关闭即完整卸载，不需要重载插件。
     * 单个功能读配置失败只上报并跳过它，不影响其他功能。
     */
    private async register(definition: FeatureDefinition): Promise<boolean> {
        try {
            await this.store.register(definition);
        } catch (error) {
            reportError(`${definition.id}.config`, error);
            return false;
        }
        this.store.subscribe(definition.id, () => this.syncMount(definition));
        return true;
    }

    /** 按「该不该运行」调整挂载状态；幂等。 */
    private syncMount(definition: FeatureDefinition): void {
        const wanted = isEnabled(definition, this.store.get(definition.id));
        const mounted = this.mounted.has(definition.id);
        if (wanted === mounted) {
            return;
        }
        if (wanted) {
            this.mount(definition);
            return;
        }
        this.unmount(definition.id, "switch");
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
            createLogger(definition.id).info("mounted");
        } catch (error) {
            reportError(`${definition.id}.mount`, error);
            // 回滚该功能已经注册的 UI，其他功能不受影响
            this.unmount(definition.id, "rollback");
        }
    }

    /** 手动移除单个功能（开关关闭 / 异常回滚 / 插件卸载）。 */
    private unmount(id: string, reason: "switch" | "rollback" | "dispose"): void {
        const record = this.mounted.get(id);
        if (!record) {
            return;
        }
        createLogger(id).info(`unmounted (${reason})`);
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
            log: createLogger(definition.id),
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
            addProtyleSlash: (options) => {
                // 斜杠菜单每次都重新读这个数组，所以可以随功能挂载 / 卸载增删。
                // 这里保留条目对象本身：同一个功能重复注册同一个 id 时各自移除自己的那份。
                const entry = {
                    filter: options.filter,
                    html: options.html,
                    id: options.id,
                    showInLite: options.showInLite,
                    callback: options.callback,
                };
                plugin.protyleSlash.push(entry);
                addTeardown(() => {
                    const index = plugin.protyleSlash.indexOf(entry);
                    if (index >= 0) {
                        plugin.protyleSlash.splice(index, 1);
                    }
                });
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
        this.log.info(`disposing ${this.mounted.size} mounted feature(s)`);
        guardSilent("panel.close", () => this.panel.dispose());
        // 「日志输出」永远最后卸载：它的 destroy 会关掉详细日志，早一步关掉，
        // 后面那些功能的卸载日志就全没了。其余功能后挂载的先卸载。
        // 不能只靠倒序：用户中途关掉再打开日志功能时，它在 Map 里的位置会变到末尾。
        const ids = [...this.mounted.keys()];
        const logId = ids.includes(LOG_FEATURE_ID) ? LOG_FEATURE_ID : undefined;
        ids.filter((id) => id !== logId).reverse().forEach((id) => this.unmount(id, "dispose"));
        if (logId) {
            this.unmount(logId, "dispose");
        }
        guardSilent("config.dispose", () => this.store.dispose());
        setDetailedLogging(false);
    }
}
