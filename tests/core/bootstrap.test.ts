/**
 * `core/bootstrap.ts`：功能装载器。
 *
 * 核心承诺有三条，缺一条都会变成线上故障：
 * - 单个功能的任何异常都不影响其他功能与插件本体；
 * - 注册过的 UI（样式、顶栏、斜杠菜单、事件）随功能卸载**成对**撤掉；
 * - 开关一变就立刻挂载 / 完整卸载，且卸载幂等。
 *
 * 注册表与设置面板在这里被替换成可控替身：这份测试关心的是装载器，
 * 不是「当前有哪些功能」（那是 registry / setting-dialog 自己的测试）。
 */
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import {setDetailedLogging} from "../../src/core/log";
import type {
    FeatureDefinition,
    FeatureHost,
    FeatureInstance,
} from "../../src/core/types";
import {mockState} from "../mocks/siyuan";

const hoisted = vi.hoisted(() => ({
    active: [] as FeatureDefinition[],
    panels: [] as {shown: boolean; disposed: boolean;}[],
}));

vi.mock("../../src/core/registry", () => ({
    activeFeatures: () => hoisted.active,
    // 装载日志会遍历整张注册表来解释「谁被跳过」，测试里注册表就是这份清单
    get FEATURES() {
        return hoisted.active;
    },
    featureById: (id: string) => hoisted.active.find((feature) => feature.id === id),
}));

vi.mock("../../src/core/setting-dialog", () => ({
    SettingsPanel: class FakePanel {
        shown = false;
        disposed = false;

        constructor() {
            hoisted.panels.push(this);
        }

        show(): void {
            this.shown = true;
        }

        dispose(): void {
            this.disposed = true;
        }
    },
}));

// 依赖 mock 之后才能导入，所以放在 vi.mock 之后
const {FeatureManager} = await import("../../src/core/bootstrap");

const TAG = "[some-settings-siyuan__";

/** 宿主播件：记录全部注册 / 撤销调用，供断言「成对清理」。 */
class FakePlugin {
    readonly name = "some-settings-siyuan";
    readonly displayName = "some settings";
    i18n: Record<string, string> = {hello: "你好"};
    readonly files = new Map<string, unknown>();
    readonly protyleSlash: unknown[] = [];
    readonly topBars: {id?: string; title: string;}[] = [];
    readonly removedTopBars: string[] = [];
    readonly statusBars: HTMLElement[] = [];
    readonly docks: unknown[] = [];
    readonly removedDocks: unknown[] = [];
    readonly tabs: unknown[] = [];
    readonly commands: unknown[] = [];
    readonly icons: string[] = [];
    readonly eventBus = {on: vi.fn(), off: vi.fn()};
    /** 宿主是否在 addDock() 里回传 id；false 时模拟结构不同的宿主版本。 */
    dockReturnsId = true;

    loadData = vi.fn(async (name: string): Promise<unknown> => this.files.get(name) ?? "");
    saveData = vi.fn(async (name: string, value: unknown): Promise<unknown> => {
        this.files.set(name, JSON.parse(JSON.stringify(value)));
        return {code: 0};
    });
    removeData = vi.fn(async (name: string): Promise<unknown> => {
        this.files.delete(name);
        return {code: 0};
    });

    addTopBar(options: {id?: string; title: string;}): HTMLElement {
        this.topBars.push(options);
        const element = document.createElement("div");
        document.body.append(element);
        return element;
    }

    removeTopBar(id: string): void {
        this.removedTopBars.push(id);
    }

    addCommand(options: unknown): void {
        this.commands.push(options);
    }

    addIcons(svg: string): void {
        this.icons.push(svg);
    }

    addStatusBar(): HTMLElement {
        const element = document.createElement("div");
        element.remove = vi.fn(element.remove.bind(element)) as unknown as () => void;
        document.body.append(element);
        this.statusBars.push(element);
        return element;
    }

    addDock(options: unknown): {id: string;} | undefined {
        this.docks.push(options);
        return this.dockReturnsId ? {id: "dock-from-host"} : undefined;
    }

    removeDock(id: unknown): void {
        this.removedDocks.push(id);
    }

    addTab(options: unknown): void {
        this.tabs.push(options);
    }
}

const featureOf = (id: string, extra: Partial<FeatureDefinition> = {}): FeatureDefinition => ({
    id,
    category: "editor",
    name: `${id}.name`,
    enabled: true,
    settings: [{kind: "switch", key: "enabled", title: "common.enabled", default: false}],
    ...extra,
});

interface Harness {
    plugin: FakePlugin;
    manager: InstanceType<typeof FeatureManager>;
    host: (id: string) => FeatureHost;
}

/** 建一个已经 load 过的装载器，并拿到某个功能的 host。 */
const start = async (definitions: FeatureDefinition[], stored: Record<string, unknown> = {}): Promise<Harness> => {
    hoisted.active = definitions;
    const plugin = new FakePlugin();
    Object.entries(stored).forEach(([id, value]) => plugin.files.set(`feature-${id}`, value));
    const manager = new FeatureManager(plugin as never);
    await manager.load();
    const host = (id: string): FeatureHost => {
        const found = (manager as unknown as {mounted: Map<string, {host: FeatureHost;}>;}).mounted.get(id);
        if (!found) {
            throw new Error(`${id} is not mounted`);
        }
        return found.host;
    };
    return {plugin, manager, host};
};

beforeEach(() => {
    hoisted.active = [];
    hoisted.panels = [];
    // 详细日志默认关着，这份测试要观察控制台上的记录，所以显式打开
    setDetailedLogging(true);
});

afterEach(() => {
    setDetailedLogging(false);
});

describe("load", () => {
    it("只装载开关打开的功能", async () => {
        const mountEnabled = vi.fn();
        const mountDisabled = vi.fn();
        const {host} = await start([
            featureOf("alpha", {mount: mountEnabled}),
            featureOf("beta", {mount: mountDisabled}),
        ], {alpha: {enabled: true}, beta: {enabled: false}});

        expect(mountEnabled).toHaveBeenCalledTimes(1);
        expect(mountDisabled).not.toHaveBeenCalled();
        expect(host("alpha").id).toBe("alpha");
        expect(() => host("beta")).toThrow("beta is not mounted");
    });

    it("声明 isEnabled 的功能按谓词判定", async () => {
        const mount = vi.fn();
        const {host} = await start([featureOf("alpha", {
            settings: [{kind: "select", key: "scope", title: "scope", default: "disabled"}],
            isEnabled: (config) => config.scope === "both",
            mount,
        })], {alpha: {scope: "both"}});
        expect(mount).toHaveBeenCalledTimes(1);
        expect(host("alpha").config.scope).toBe("both");
    });

    it("没有 mount 的功能也能挂上 host", async () => {
        const {host} = await start([featureOf("alpha")], {alpha: {enabled: true}});
        expect(host("alpha").config.enabled).toBe(true);
    });

    it("构造时把生效功能交给设置面板", () => {
        hoisted.active = [featureOf("alpha")];
        const manager = new FeatureManager(new FakePlugin() as never);
        expect(hoisted.panels).toHaveLength(1);
        expect(manager.panel).toBe(hoisted.panels[0]);
    });
});

describe("开关变化", () => {
    it("保存开关后立即挂载", async () => {
        const mount = vi.fn();
        const {manager, host} = await start([featureOf("alpha", {mount})], {alpha: {enabled: false}});
        expect(mount).not.toHaveBeenCalled();

        await manager.store.patch("alpha", {enabled: true});
        expect(mount).toHaveBeenCalledTimes(1);
        expect(host("alpha").config.enabled).toBe(true);
    });

    it("关掉开关后完整卸载：signal、teardown、destroy、样式全部收掉", async () => {
        const destroy = vi.fn();
        const teardown = vi.fn();
        const {manager, plugin, host} = await start([featureOf("alpha", {
            mount: (h): FeatureInstance => {
                h.addStyle(".a{}");
                h.onConfigChange(() => undefined);
                h.addTopBar({id: "top", icon: "iconA", title: "A", callback: () => undefined});
                h.addEventBus("ws-main", () => undefined);
                return {destroy};
            },
        })], {alpha: {enabled: true}});
        const signal = host("alpha").signal;
        // 手动注册一条 teardown：动作行 / 功能内部都可能这样做
        host("alpha").addStyle(".b{}");

        await manager.store.patch("alpha", {enabled: false});

        expect(signal.aborted).toBe(true);
        expect(destroy).toHaveBeenCalledTimes(1);
        expect(teardown).not.toHaveBeenCalled();
        expect(plugin.removedTopBars).toEqual(["top"]);
        expect(plugin.eventBus.off).toHaveBeenCalledWith("ws-main", expect.any(Function));
        expect(document.head.querySelectorAll("style[data-some-settings-style]")).toHaveLength(0);
    });

    it("反复开关不会重复挂载或留下残留", async () => {
        const destroy = vi.fn();
        const mount = vi.fn((h: FeatureHost) => {
            h.addStyle(".a{}");
            return {destroy} satisfies FeatureInstance;
        });
        const {manager} = await start([featureOf("alpha", {mount})], {alpha: {enabled: false}});

        for (let round = 0; round < 3; round += 1) {
            await manager.store.patch("alpha", {enabled: true});
            await manager.store.patch("alpha", {enabled: false});
        }
        expect(mount).toHaveBeenCalledTimes(3);
        expect(destroy).toHaveBeenCalledTimes(3);
        expect(document.head.querySelectorAll("style[data-some-settings-style]")).toHaveLength(0);
    });
});

describe("异常隔离", () => {
    it("mount 抛错时上报并回滚该功能已注册的 UI", async () => {
        const {plugin} = await start([featureOf("alpha", {
            mount: (h) => {
                h.addStyle(".a{}");
                h.addTopBar({id: "top", icon: "iconA", title: "A", callback: () => undefined});
                throw new Error("mount failed");
            },
        })], {alpha: {enabled: true}});

        expect(vi.mocked(console.error)).toHaveBeenCalledWith(
            expect.stringContaining(`${TAG}alpha.mount] ERROR Error: mount failed`),
        );
        expect(mockState.messages[0].text).toContain("mount failed");
        expect(plugin.removedTopBars).toEqual(["top"]);
        expect(document.head.querySelectorAll("style[data-some-settings-style]")).toHaveLength(0);
    });

    it("一个功能挂了不影响另一个功能", async () => {
        const ok = vi.fn();
        await start([
            featureOf("broken", {
                mount: () => {
                    throw new Error("boom");
                },
            }),
            featureOf("fine", {mount: ok}),
        ], {broken: {enabled: true}, fine: {enabled: true}});
        expect(ok).toHaveBeenCalledTimes(1);
    });

    it("一个功能的配置文件读不出来时回落默认值，其他功能照常装载", async () => {
        const ok = vi.fn();
        hoisted.active = [featureOf("broken"), featureOf("fine", {mount: ok})];
        const plugin = new FakePlugin();
        plugin.loadData.mockImplementation(async (name: string) => {
            if (name === "feature-broken") {
                throw new Error("io error");
            }
            return name === "feature-fine" ? {enabled: true} : "";
        });

        const manager = new FeatureManager(plugin as never);
        await manager.load();

        expect(manager.store.get("broken")).toEqual({enabled: false});
        expect(vi.mocked(console.warn)).toHaveBeenCalledWith(
            expect.stringContaining(`${TAG}core.config] WARN cannot read feature-broken`),
        );
        expect(ok).toHaveBeenCalledTimes(1);
    });

    it("配置注册抛错时只跳过该功能，其余功能照常装载", async () => {
        const ok = vi.fn();
        hoisted.active = [featureOf("broken"), featureOf("fine", {mount: ok})];
        const plugin = new FakePlugin();
        const manager = new FeatureManager(plugin as never);
        const original = manager.store.register.bind(manager.store);
        manager.store.register = vi.fn(async (definition: FeatureDefinition) => {
            if (definition.id === "broken") {
                throw new Error("register failed");
            }
            return original(definition);
        });
        plugin.files.set("feature-fine", {enabled: true});

        await manager.load();

        expect(vi.mocked(console.error)).toHaveBeenCalledWith(
            expect.stringContaining(`${TAG}broken.config] ERROR Error: register failed`),
        );
        expect(ok).toHaveBeenCalledTimes(1);
    });

    it("teardown 与 destroy 里的异常不会冒泡，也不影响其余清理", async () => {
        const {manager} = await start([featureOf("alpha", {
            mount: (h) => {
                h.addStyle(".a{}");
                // 这条 teardown 在卸载时抛错
                h.addEventBus("ws-main", () => undefined);
                return {
                    destroy: () => {
                        throw new Error("destroy failed");
                    },
                };
            },
        })], {alpha: {enabled: true}});
        const plugin = new FakePlugin();
        expect(plugin.eventBus.off).not.toHaveBeenCalled();

        await expect(manager.store.patch("alpha", {enabled: false})).resolves.toBeUndefined();
        expect(vi.mocked(console.error)).toHaveBeenCalled();
        // 样式清理照常执行
        expect(document.head.querySelectorAll("style[data-some-settings-style]")).toHaveLength(0);
    });
});

describe("日志开关的时序", () => {
    /** 一个行为与真实「日志输出」功能一致的替身：挂载开、卸载关。 */
    const loggingFeature = (): FeatureDefinition =>
        featureOf("log-output", {
            mount: (host) => {
                setDetailedLogging(true);
                host.log.info("detailed logging enabled");
                return {
                    destroy: () => {
                        host.log.info("detailed logging disabled");
                        setDetailedLogging(false);
                    },
                };
            },
        });

    it("先挂载「日志输出」，装载概况与后续功能的日志才会出现", async () => {
        setDetailedLogging(false);
        await start([
            loggingFeature(),
            featureOf("alpha", {mount: () => undefined}),
        ], {"log-output": {enabled: true}, alpha: {enabled: true}});

        expect(vi.mocked(console.log)).toHaveBeenCalledWith(
            expect.stringContaining(`${TAG}core.bootstrap] INFO loading 2 of 2 feature(s)`),
        );
        expect(vi.mocked(console.log)).toHaveBeenCalledWith(`${TAG}alpha] INFO mounted`);
    });

    it("没有「日志输出」时，整个装载过程不写控制台", async () => {
        setDetailedLogging(false);
        await start([featureOf("alpha", {mount: () => undefined})], {alpha: {enabled: true}});

        expect(vi.mocked(console.log)).not.toHaveBeenCalled();
        expect(vi.mocked(console.warn)).not.toHaveBeenCalled();
        expect(vi.mocked(console.error)).not.toHaveBeenCalled();
    });

    it("中途关掉再打开后卸载，「日志输出」仍然最后收掉，其他功能的日志不丢", async () => {
        setDetailedLogging(false);
        const {manager} = await start([
            loggingFeature(),
            featureOf("alpha", {mount: () => undefined}),
        ], {"log-output": {enabled: true}, alpha: {enabled: true}});

        // 关掉再打开会把「日志输出」在 mounted 里的位置挪到末尾，倒序卸载就不够了
        await manager.store.patch("log-output", {enabled: false});
        await manager.store.patch("log-output", {enabled: true});

        // 只保留卸载期间产生的日志
        vi.mocked(console.log).mockClear();
        manager.dispose();

        const disposed = vi.mocked(console.log).mock.calls.map((call) => String(call[0]));
        const alphaIndex = disposed.findIndex((line) => line.includes(`${TAG}alpha] INFO unmounted (dispose)`));
        const logIndex = disposed.findIndex((line) => line.includes(`${TAG}log-output] INFO unmounted (dispose)`));
        expect(alphaIndex).toBeGreaterThanOrEqual(0);
        expect(logIndex).toBeGreaterThan(alphaIndex);
    });
});

describe("FeatureHost", () => {
    it("i18n 命中时返回译文，缺失时回落到 key", async () => {
        const {host} = await start([featureOf("alpha")], {alpha: {enabled: true}});
        expect(host("alpha").i18n("hello")).toBe("你好");
        expect(host("alpha").i18n("missing.key")).toBe("missing.key");
        expect(host("alpha").i18n("empty")).toBe("empty");
    });

    it("config 是实时快照，setConfig 会落盘并通知", async () => {
        const definitions = [featureOf("alpha", {
            settings: [
                {kind: "switch", key: "enabled", title: "common.enabled", default: false},
                {kind: "text", key: "label", title: "alpha.label", default: "默认"},
            ],
        })];
        const {plugin, host} = await start(definitions, {alpha: {enabled: true}});
        const listener = vi.fn();
        host("alpha").onConfigChange(listener);

        expect(host("alpha").config.label).toBe("默认");
        await host("alpha").setConfig({label: "改过的"});

        expect(listener).toHaveBeenCalledTimes(1);
        expect(host("alpha").config.label).toBe("改过的");
        expect(plugin.files.get("feature-alpha")).toMatchObject({enabled: true, label: "改过的"});
    });

    it("addStyle 返回撤销函数，且卸载时自动撤销", async () => {
        let remove: () => void = () => undefined;
        const {manager} = await start([featureOf("alpha", {
            mount: (h) => {
                remove = h.addStyle(".a{}");
            },
        })], {alpha: {enabled: true}});
        expect(document.head.querySelectorAll("style[data-some-settings-style]")).toHaveLength(1);
        remove();
        expect(document.head.querySelectorAll("style[data-some-settings-style]")).toHaveLength(0);

        // 卸载时对已撤销的样式再撤一次也不会抛
        await expect(manager.store.patch("alpha", {enabled: false})).resolves.toBeUndefined();
    });

    it("功能卸载后再注册 teardown 会立刻执行，不留残余", async () => {
        const {manager, host} = await start([featureOf("alpha")], {alpha: {enabled: true}});
        const featureHost = host("alpha");
        await manager.store.patch("alpha", {enabled: false});
        expect(featureHost.signal.aborted).toBe(true);

        featureHost.addStyle(".late{}");
        featureHost.addTopBar({id: "late", icon: "a", title: "late", callback: () => undefined});
        expect(document.head.querySelectorAll("style[data-some-settings-style]")).toHaveLength(0);
    });

    it("addTopBar 卸载时用 id 撤销，没有 id 时退回 title", async () => {
        const {manager, plugin} = await start([featureOf("alpha", {
            mount: (h) => {
                h.addTopBar({id: "with-id", icon: "a", title: "A", callback: () => undefined});
                h.addTopBar({icon: "b", title: "B", callback: () => undefined});
            },
        })], {alpha: {enabled: true}});
        await manager.store.patch("alpha", {enabled: false});
        // teardown 逆序执行：后注册的先撤
        expect(plugin.removedTopBars).toEqual(["B", "with-id"]);
    });

    it("addCommand 原样交给宿主，且不做单条撤销", async () => {
        const command = {langKey: "x", hotkey: "", callback: () => undefined};
        const {manager, plugin} = await start([featureOf("alpha", {
            mount: (h) => {
                h.addCommand(command);
            },
        })], {alpha: {enabled: true}});
        expect(plugin.commands).toEqual([command]);
        await manager.store.patch("alpha", {enabled: false});
        expect(plugin.commands).toEqual([command]);
    });

    it("addProtyleSlash 把条目塞进宿主数组，卸载时按对象移除自己那份", async () => {
        const {manager, plugin} = await start([featureOf("alpha", {
            mount: (h) => {
                h.addProtyleSlash({id: "ss-a", filter: ["abc"], html: "<div></div>", callback: () => undefined});
                h.addProtyleSlash({id: "ss-a", filter: ["abc"], html: "<div></div>", callback: () => undefined});
            },
        })], {alpha: {enabled: true}});
        expect(plugin.protyleSlash).toHaveLength(2);
        await manager.store.patch("alpha", {enabled: false});
        expect(plugin.protyleSlash).toHaveLength(0);
    });

    it("addIcons 转给宿主", async () => {
        const {host, plugin} = await start([featureOf("alpha")], {alpha: {enabled: true}});
        host("alpha").addIcons('<symbol id="iconX"></symbol>');
        expect(plugin.icons).toEqual(['<symbol id="iconX"></symbol>']);
    });

    it("addStatusBar 的元素随卸载一起移除", async () => {
        const {manager, host} = await start([featureOf("alpha")], {alpha: {enabled: true}});
        const element = host("alpha").addStatusBar({element: document.createElement("div")});
        expect(document.body.contains(element as HTMLElement)).toBe(true);

        await manager.store.patch("alpha", {enabled: false});
        expect(element?.remove).toHaveBeenCalled();
    });

    it("addProtyleSlash 的条目被别处先移除时，卸载不会误删别人的条目", async () => {
        const {manager, plugin} = await start([featureOf("alpha", {
            mount: (h) => {
                h.addProtyleSlash({id: "ss-a", filter: ["a"], html: "<div></div>", callback: () => undefined});
            },
        })], {alpha: {enabled: true}});
        const mine = plugin.protyleSlash[0];
        plugin.protyleSlash.length = 0;
        plugin.protyleSlash.push({id: "other"});

        await manager.store.patch("alpha", {enabled: false});
        expect(plugin.protyleSlash).toEqual([{id: "other"}]);
        expect(plugin.protyleSlash.includes(mine)).toBe(false);
    });

    it("addDock 用宿主给的 id 撤销，并且 init 拿到的是宿主的元素", async () => {
        const init = vi.fn();
        const {manager, plugin} = await start([featureOf("alpha", {
            mount: (h) => {
                h.addDock({id: "dock", config: {} as never, data: {}, type: "dock", init});
            },
        })], {alpha: {enabled: true}});

        const dockOptions = plugin.docks[0] as {init: (this: unknown, custom: {element: Element;}) => void;};
        const element = document.createElement("div");
        dockOptions.init.call({}, {element});
        expect(init).toHaveBeenCalledWith(element);

        await manager.store.patch("alpha", {enabled: false});
        expect(plugin.removedDocks).toEqual(["dock-from-host"]);
    });

    it("addDock 既没有返回 id 也没有声明 id 时退回 type", async () => {
        hoisted.active = [featureOf("alpha", {
            mount: (h) => {
                h.addDock({config: {} as never, data: {}, type: "custom-dock", init: () => undefined});
            },
        })];
        const plugin = new FakePlugin();
        plugin.dockReturnsId = false;
        plugin.files.set("feature-alpha", {enabled: true});
        const manager = new FeatureManager(plugin as never);
        await manager.load();

        await manager.store.patch("alpha", {enabled: false});
        expect(plugin.removedDocks).toEqual(["custom-dock"]);
    });

    it("addDock 没拿到返回 id 时退回功能声明的 id", async () => {
        hoisted.active = [featureOf("alpha", {
            mount: (h) => {
                h.addDock({id: "declared", config: {} as never, data: {}, type: "dock", init: () => undefined});
            },
        })];
        const plugin = new FakePlugin();
        plugin.dockReturnsId = false;
        plugin.files.set("feature-alpha", {enabled: true});
        const manager = new FeatureManager(plugin as never);
        await manager.load();

        await manager.store.patch("alpha", {enabled: false});
        expect(plugin.removedDocks).toEqual(["declared"]);
    });

    it("addTab 的 destroy 与 init 都转给宿主", async () => {
        const init = vi.fn();
        const destroy = vi.fn();
        const {host, plugin} = await start([featureOf("alpha")], {alpha: {enabled: true}});
        host("alpha").addTab({type: "custom", destroy, init});

        const tabOptions = plugin.tabs[0] as {
            type: string;
            destroy: () => void;
            init: (this: unknown, custom: {element: Element;}) => void;
        };
        expect(tabOptions.type).toBe("custom");
        expect(tabOptions.destroy).toBe(destroy);
        const element = document.createElement("div");
        tabOptions.init.call({}, {element});
        expect(init).toHaveBeenCalledWith(element);
    });

    it("addEventBus 卸载时 off 掉同一个监听", async () => {
        const listener = vi.fn();
        const {manager, plugin} = await start([featureOf("alpha", {
            mount: (h) => {
                h.addEventBus("ws-main", listener);
            },
        })], {alpha: {enabled: true}});
        expect(plugin.eventBus.on).toHaveBeenCalledWith("ws-main", listener);
        await manager.store.patch("alpha", {enabled: false});
        expect(plugin.eventBus.off).toHaveBeenCalledWith("ws-main", listener);
    });

    it("showMessage 按 4 秒提示", async () => {
        const {host} = await start([featureOf("alpha")], {alpha: {enabled: true}});
        host("alpha").showMessage("完成");
        expect(mockState.messages).toEqual([{text: "完成", timeout: 4000, type: undefined}]);
    });

    it("log 带功能 id 头部与级别", async () => {
        const {host} = await start([featureOf("alpha")], {alpha: {enabled: true}});
        host("alpha").log.info("step", 1);
        host("alpha").log.warn("careful");
        expect(vi.mocked(console.log)).toHaveBeenCalledWith(`${TAG}alpha] INFO step 1`);
        expect(vi.mocked(console.warn)).toHaveBeenCalledWith(`${TAG}alpha] WARN careful`);
    });
});

describe("openSettings / dispose", () => {
    it("openSettings 打开设置面板", async () => {
        const {manager} = await start([featureOf("alpha")], {alpha: {enabled: true}});
        manager.openSettings();
        expect(hoisted.panels[0].shown).toBe(true);
    });

    it("dispose 收掉面板、卸载全部功能、清掉订阅，且幂等", async () => {
        const mount = vi.fn();
        const {manager} = await start([featureOf("alpha", {mount})], {alpha: {enabled: true}});
        const panel = hoisted.panels[0];

        manager.dispose();
        manager.dispose();

        expect(panel.disposed).toBe(true);
        expect(hoisted.panels).toHaveLength(1);
        // 面板已 dispose，再次改配置不会再挂载
        mount.mockClear();
        await manager.store.patch("alpha", {enabled: false});
        await manager.store.patch("alpha", {enabled: true});
        expect(mount).not.toHaveBeenCalled();
    });

    it("dispose 时对每个已挂载功能都做完整清理", async () => {
        const destroy = vi.fn();
        const {manager, plugin} = await start([featureOf("alpha", {
            mount: (h) => {
                h.addStyle(".a{}");
                h.addTopBar({id: "top", icon: "a", title: "A", callback: () => undefined});
                return {destroy};
            },
        })], {alpha: {enabled: true}});
        manager.dispose();
        expect(destroy).toHaveBeenCalledTimes(1);
        expect(plugin.removedTopBars).toEqual(["top"]);
        expect(document.head.querySelectorAll("style[data-some-settings-style]")).toHaveLength(0);
    });
});

describe("load 的配置读取", () => {
    it("并发读盘，但挂载顺序仍是注册表顺序", async () => {
        const ids = ["alpha", "beta", "gamma", "delta"];
        const mounted: string[] = [];
        hoisted.active = ids.map((id) =>
            featureOf(id, {
                mount: () => {
                    mounted.push(id);
                    return {destroy: () => undefined};
                },
            })
        );
        const plugin = new FakePlugin();
        ids.forEach((id) => plugin.files.set(`feature-${id}`, {enabled: true}));

        const original = plugin.loadData.getMockImplementation() as (name: string) => Promise<unknown>;
        let running = 0;
        let peak = 0;
        plugin.loadData.mockImplementation(async (name: string) => {
            running += 1;
            peak = Math.max(peak, running);
            await new Promise((resolve) => setTimeout(resolve, 5));
            try {
                return await original(name);
            } finally {
                running -= 1;
            }
        });

        const manager = new FeatureManager(plugin as never);
        await manager.load();
        manager.dispose();

        // 读盘是并发的（逐个 await 时 peak 只能是 1）
        expect(peak).toBeGreaterThan(1);
        // 挂载顺序不受完成顺序影响
        expect(mounted).toEqual(ids);
    });
});
