// @vitest-environment node
/**
 * `core/external-api.ts`：面向其他插件的配置控制 API、接管锁、多插件冲突与持久化提示。
 */
import type {Plugin} from "siyuan";
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import {ConfigStore} from "../../src/core/config";
import {
    EXTERNAL_API_VERSION,
    EXTERNAL_NOTICES_STORAGE,
    ExternalControlManager,
    resolveCallerDisplayName,
    resolveFeatureSwitch,
    resolveLocalizedReason,
    sanitizeReason,
} from "../../src/core/external-api";
import {setDetailedLogging} from "../../src/core/log";
import {
    resetEffectiveFeatures,
    setEffectiveFeatures,
} from "../../src/core/registry";
import type {FeatureDefinition} from "../../src/core/types";

class FakeHost {
    readonly name = "some-settings-siyuan";
    readonly displayName = "Some Settings";
    readonly app = {plugins: [] as Plugin[]};
    readonly files = new Map<string, unknown>();
    rejectWrites = false;
    corruptWrites = false;
    writeDelayMs = 0;

    loadData = vi.fn(async (name: string): Promise<unknown> =>
        this.files.has(name) ? JSON.parse(JSON.stringify(this.files.get(name))) : ""
    );

    saveData = vi.fn(async (name: string, value: unknown): Promise<unknown> => {
        if (this.writeDelayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, this.writeDelayMs));
        }
        if (this.rejectWrites) {
            return {code: 1, msg: "readonly"};
        }
        this.files.set(
            name,
            this.corruptWrites ? {corrupted: true} : JSON.parse(JSON.stringify(value)),
        );
        return {code: 0};
    });

    removeData = vi.fn(async (name: string): Promise<unknown> => {
        this.files.delete(name);
        return {code: 0};
    });

    asPlugin(): Plugin {
        return this as unknown as Plugin;
    }
}

const boolFeature: FeatureDefinition = {
    id: "modal-blur",
    category: ["appearance"],
    name: "feature.modalBlur.title",
    enabled: true,
    settings: [
        {kind: "switch", key: "enabled", title: "common.enabled", default: false},
        {kind: "number", key: "radius", title: "feature.modalBlur.radius", default: 4},
    ],
};

const selectFeature: FeatureDefinition = {
    id: "inline-code-copy",
    category: ["editor"],
    name: "feature.inlineCodeCopy.title",
    enabled: true,
    isEnabled: (config) => config.mode !== "off",
    settings: [
        {
            kind: "select",
            key: "mode",
            title: "feature.inlineCodeCopy.mode",
            default: "off",
            options: [
                {value: "off", label: "feature.inlineCodeCopy.mode.off"},
                {value: "hover", label: "feature.inlineCodeCopy.mode.hover"},
                {value: "always", label: "feature.inlineCodeCopy.mode.always"},
            ],
        },
    ],
};

const protectedFeature: FeatureDefinition = {
    id: "log-output",
    category: ["plugin"],
    name: "feature.logOutput.title",
    enabled: true,
    settings: [{kind: "switch", key: "enabled", title: "common.enabled", default: false}],
};

const unavailableFeature: FeatureDefinition = {
    id: "retired-feature",
    category: ["editor"],
    name: "feature.retiredFeature.title",
    enabled: false,
    settings: [{kind: "switch", key: "enabled", title: "common.enabled", default: false}],
};

const noSwitchFeature: FeatureDefinition = {
    id: "ref-crumbs-guide",
    category: ["editor"],
    name: "feature.refCrumbsGuide.title",
    enabled: true,
    isEnabled: () => false,
    settings: [{kind: "button", key: "open", title: "t", label: "l", onClick: () => undefined}],
};

const ALL_FEATURES = [boolFeature, selectFeature, protectedFeature, unavailableFeature, noSwitchFeature];

const setup = async (host = new FakeHost()) => {
    setEffectiveFeatures(ALL_FEATURES);
    const plugin = host.asPlugin();
    host.app.plugins.push(plugin);
    const store = new ConfigStore(plugin);
    await store.register(boolFeature);
    await store.register(selectFeature);
    await store.register(protectedFeature);
    await store.register(noSwitchFeature);
    const manager = new ExternalControlManager(plugin, store, Promise.resolve());
    await manager.loadNotices();
    return {host, plugin, store, manager, api: manager.createPublicApi()};
};

beforeEach(() => {
    setDetailedLogging(true);
});

afterEach(() => {
    resetEffectiveFeatures();
    setDetailedLogging(false);
});

describe("helpers", () => {
    it("resolves boolean and select switches accurately", () => {
        expect(resolveFeatureSwitch(boolFeature)).toEqual({key: "enabled", kind: "switch", offValue: false});
        expect(resolveFeatureSwitch(selectFeature)).toEqual({
            key: "mode",
            kind: "select",
            options: ["off", "hover", "always"],
            offValue: "off",
        });
        expect(resolveFeatureSwitch(noSwitchFeature)).toBeUndefined();
    });

    it("sanitizes and resolves localized reasons", () => {
        expect(sanitizeReason("  conflict  ")).toBe("conflict");
        expect(sanitizeReason("   ")).toBeUndefined();
        expect(sanitizeReason({"zh-CN": " 样式冲突 ", en: "Style conflict", empty: "  "})).toEqual({
            "zh-CN": "样式冲突",
            en: "Style conflict",
        });
        expect(resolveLocalizedReason({"zh-CN": "冲突", en: "Conflict"}, "zh_CN")).toBe("冲突");
        expect(resolveLocalizedReason({"zh-CN": "冲突", en: "Conflict"}, "en-US")).toBe("Conflict");
        expect(resolveLocalizedReason({default: "Fallback", fr: "Conflit"}, "ja-JP")).toBe("Fallback");
    });

    it("prefers live host displayName over fallback displayName and caller id", () => {
        const host = new FakeHost();
        host.app.plugins.push({name: "other-plugin", displayName: "其他插件"} as Plugin);
        expect(resolveCallerDisplayName(host.asPlugin(), "other-plugin", "Old Name")).toBe("其他插件");
        expect(resolveCallerDisplayName(host.asPlugin(), "missing-plugin", "Saved Name")).toBe("Saved Name");
        expect(resolveCallerDisplayName(host.asPlugin(), "missing-plugin")).toBe("missing-plugin");
    });
});

describe("ExternalControlManager", () => {
    it("controls boolean and select features, writes config files, and supports convenience helpers", async () => {
        const {host, store, api} = await setup();
        expect(api.version).toBe(EXTERNAL_API_VERSION);
        expect(api.pluginName).toBe("some-settings-siyuan");

        const enabledRes = await api.enableFeature("plugin-a", "modal-blur", {reason: "Need blur"});
        expect(enabledRes.ok).toBe(true);
        if (enabledRes.ok) {
            expect(enabledRes.changed).toBe(true);
            expect(enabledRes.value).toBe(true);
            expect(enabledRes.takeover).toBe(false);
        }
        expect(store.get("modal-blur").enabled).toBe(true);
        expect(host.files.get("feature-modal-blur")).toMatchObject({enabled: true});

        const selectRes = await api.enableFeature("plugin-a", "inline-code-copy", {value: "hover"});
        expect(selectRes.ok).toBe(true);
        expect(store.get("inline-code-copy").mode).toBe("hover");

        const disableSelect = await api.disableFeature("plugin-a", "inline-code-copy");
        expect(disableSelect.ok).toBe(true);
        if (disableSelect.ok) {
            expect(disableSelect.value).toBe("off");
            expect(disableSelect.changed).toBe(true);
        }
        expect(store.get("inline-code-copy").mode).toBe("off");
    });

    it("rejects invalid caller, unknown, protected, unavailable, switchless, invalid value, and readonly calls", async () => {
        const {api} = await setup();

        expect(await api.setFeature({caller: "   ", featureId: "modal-blur", enabled: true})).toMatchObject({
            ok: false,
            code: "invalid-caller",
        });
        expect(await api.setFeature({caller: "p", featureId: "no-such-feature", enabled: true})).toMatchObject({
            ok: false,
            code: "invalid-feature",
        });
        expect(await api.setFeature({caller: "p", featureId: "log-output", enabled: false})).toMatchObject({
            ok: false,
            code: "protected",
        });
        expect(await api.setFeature({caller: "p", featureId: "retired-feature", enabled: true})).toMatchObject({
            ok: false,
            code: "unavailable",
        });
        expect(await api.setFeature({caller: "p", featureId: "ref-crumbs-guide", enabled: true})).toMatchObject({
            ok: false,
            code: "no-switch",
        });
        expect(await api.setFeature({caller: "p", featureId: "modal-blur", enabled: "yes"})).toMatchObject({
            ok: false,
            code: "invalid-value",
        });
        expect(await api.setFeature({caller: "p", featureId: "inline-code-copy", enabled: true})).toMatchObject({
            ok: false,
            code: "invalid-value",
        });
        expect(await api.setFeature({caller: "p", featureId: "inline-code-copy", enabled: "bogus"})).toMatchObject({
            ok: false,
            code: "invalid-value",
        });

        window.siyuan.config.readonly = true;
        expect(await api.setFeature({caller: "p", featureId: "modal-blur", enabled: true})).toMatchObject({
            ok: false,
            code: "readonly",
        });
    });

    it("persists non-takeover notices only when config actually changed and restores them on reload", async () => {
        const host = new FakeHost();
        const {manager, api} = await setup(host);

        // modal-blur 默认已是 false：非接管关闭不会产生黄字
        const noop = await api.disableFeature("plugin-a", "modal-blur", {reason: "unused"});
        expect(noop.ok).toBe(true);
        if (noop.ok) {
            expect(noop.changed).toBe(false);
        }
        expect(manager.viewOf("modal-blur").notice).toBeUndefined();
        expect(host.files.has(EXTERNAL_NOTICES_STORAGE)).toBe(false);

        // 真正改变值：写入持久化提示
        const changed = await api.enableFeature(
            {name: "plugin-a", displayName: "Plugin A"},
            "modal-blur",
            {reason: {"zh-CN": "兼容需要", en: "Compatibility"}},
        );
        expect(changed.ok).toBe(true);
        expect(manager.viewOf("modal-blur").notice).toMatchObject({
            caller: "plugin-a",
            displayName: "Plugin A",
            key: "enabled",
            value: true,
        });
        expect(host.files.has(EXTERNAL_NOTICES_STORAGE)).toBe(true);

        // 模拟重启：新管理器应读回非接管提示，但不会继承内存态接管
        const reloadedStore = new ConfigStore(host.asPlugin());
        await reloadedStore.register(boolFeature);
        const reloadedManager = new ExternalControlManager(host.asPlugin(), reloadedStore, Promise.resolve());
        await reloadedManager.loadNotices();
        expect(reloadedManager.viewOf("modal-blur").notice).toMatchObject({
            caller: "plugin-a",
            value: true,
        });
        expect(reloadedManager.isTakenOver("modal-blur")).toBe(false);

        // 清除后删除文件不留空壳
        await reloadedManager.clearNotice("modal-blur");
        expect(reloadedManager.viewOf("modal-blur").notice).toBeUndefined();
        expect(host.files.has(EXTERNAL_NOTICES_STORAGE)).toBe(false);
    });

    it("handles shared compatible takeovers, rejects conflicts, and preserves config after release", async () => {
        const {store, manager, api} = await setup();
        await store.patch("modal-blur", {enabled: true});

        // 插件 A 接管关闭
        const resA = await api.disableFeature("plugin-a", "modal-blur", {takeover: true, reason: "A conflict"});
        expect(resA.ok).toBe(true);
        expect(store.get("modal-blur").enabled).toBe(false);
        expect(manager.isTakenOver("modal-blur")).toBe(true);

        // 插件 B 非接管修改被拒绝
        const nonTakeoverB = await api.enableFeature("plugin-b", "modal-blur");
        expect(nonTakeoverB).toMatchObject({ok: false, code: "conflict", holders: ["plugin-a"]});

        // 插件 B 接管开启（目标值冲突）被拒绝
        const conflictB = await api.enableFeature("plugin-b", "modal-blur", {takeover: true});
        expect(conflictB).toMatchObject({ok: false, code: "conflict", holders: ["plugin-a"]});

        // 插件 B 接管关闭（目标值一致）兼容共存
        const resB = await api.disableFeature("plugin-b", "modal-blur", {takeover: true, reason: "B conflict"});
        expect(resB.ok).toBe(true);
        if (resB.ok) {
            expect(resB.changed).toBe(false);
            expect(resB.takeover).toBe(true);
        }
        expect(manager.viewOf("modal-blur").takeovers.map((item) => item.caller)).toEqual(["plugin-a", "plugin-b"]);

        // 释放 A 后 B 仍持有接管
        if (resA.ok) {
            resA.release();
            resA.release(); // 幂等
        }
        expect(manager.isTakenOver("modal-blur")).toBe(true);
        expect(manager.viewOf("modal-blur").takeovers.map((item) => item.caller)).toEqual(["plugin-b"]);

        // 释放 B 后彻底解锁，配置值保持关闭（不自动回滚为 true）
        const relB = api.releaseAll("plugin-b");
        expect(relB).toEqual({released: 1, featureIds: ["modal-blur"]});
        expect(manager.isTakenOver("modal-blur")).toBe(false);
        expect(store.get("modal-blur").enabled).toBe(false);
    });

    it("auto-prunes stale takeovers when a tracked host plugin is unloaded", async () => {
        const host = new FakeHost();
        const pluginA = {name: "plugin-a", displayName: "Plugin A"} as Plugin;
        host.app.plugins.push(pluginA);
        const {manager, api} = await setup(host);

        await api.disableFeature(pluginA, "modal-blur", {takeover: true});
        await api.disableFeature("synthetic-script", "inline-code-copy", {takeover: true});
        expect(manager.isTakenOver("modal-blur")).toBe(true);
        expect(manager.isTakenOver("inline-code-copy")).toBe(true);

        // 模拟宿主卸载 plugin-a（从 app.plugins 中移除）
        const idx = host.app.plugins.indexOf(pluginA);
        host.app.plugins.splice(idx, 1);

        const state = await api.getFeatureState("modal-blur");
        expect(state.takeovers).toEqual([]);
        expect(manager.isTakenOver("modal-blur")).toBe(false);
        // 注册时不在 app.plugins 里的合成调用方不会被误清理
        expect(manager.isTakenOver("inline-code-copy")).toBe(true);
    });

    it("serializes concurrent calls on the same feature and returns write-failed without mutating state", async () => {
        const host = new FakeHost();
        host.writeDelayMs = 15;
        const {manager, api} = await setup(host);

        const [first, second] = await Promise.all([
            api.enableFeature("plugin-a", "modal-blur", {takeover: true}),
            api.disableFeature("plugin-b", "modal-blur", {takeover: true}),
        ]);
        expect(first.ok).toBe(true);
        expect(second).toMatchObject({ok: false, code: "conflict", holders: ["plugin-a"]});

        // 写盘失败时不记录接管或提示
        host.writeDelayMs = 0;
        host.rejectWrites = true;
        const failed = await api.enableFeature("plugin-c", "inline-code-copy", {value: "always", takeover: true});
        expect(failed).toMatchObject({ok: false, code: "write-failed"});
        expect(manager.isTakenOver("inline-code-copy")).toBe(false);
        expect(manager.viewOf("inline-code-copy").notice).toBeUndefined();
    });

    it("lists controllable features and rejects calls after dispose", async () => {
        const {manager, api} = await setup();
        const list = await api.listControllableFeatures();
        expect(list.map((item) => item.featureId)).toEqual(["modal-blur", "inline-code-copy"]);

        const protectedState = await api.getFeatureState("log-output");
        expect(protectedState).toMatchObject({
            featureId: "log-output",
            exists: true,
            available: true,
            controllable: false,
            uncontrollableReason: "protected",
        });

        manager.dispose();
        expect(await api.enableFeature("plugin-a", "modal-blur")).toMatchObject({ok: false, code: "disposed"});
    });

    it("does not resurrect a takeover released during an in-flight compatible write", async () => {
        const host = new FakeHost();
        const {manager, api} = await setup(host);

        const resA = await api.disableFeature("plugin-a", "modal-blur", {takeover: true});
        expect(resA.ok).toBe(true);

        // 模拟插件 B 兼容接管写盘较慢，期间插件 A 主动释放自己的接管
        host.writeDelayMs = 20;
        const pendingB = api.disableFeature("plugin-b", "modal-blur", {takeover: true});
        if (resA.ok) {
            resA.release();
        }
        const resB = await pendingB;
        expect(resB.ok).toBe(true);
        expect(manager.viewOf("modal-blur").takeovers.map((item) => item.caller)).toEqual(["plugin-b"]);
    });

    it("skips takeover lock if a host plugin unloads while its write is in flight", async () => {
        const host = new FakeHost();
        const pluginA = {name: "plugin-a", displayName: "Plugin A"} as Plugin;
        host.app.plugins.push(pluginA);
        const {manager, api} = await setup(host);

        host.writeDelayMs = 20;
        const pending = api.enableFeature(pluginA, "modal-blur", {takeover: true});
        // 写盘途中宿主把 pluginA 从 app.plugins 移除
        host.app.plugins.splice(host.app.plugins.indexOf(pluginA), 1);

        const res = await pending;
        expect(res.ok).toBe(true);
        if (res.ok) {
            expect(res.takeover).toBe(false);
        }
        expect(manager.isTakenOver("modal-blur")).toBe(false);
    });

    it("allows downgrading from takeover to non-takeover and removes stale notice file even when memory is empty", async () => {
        const host = new FakeHost();
        const {manager, api} = await setup(host);

        await api.enableFeature("plugin-a", "modal-blur", {takeover: true});
        expect(manager.isTakenOver("modal-blur")).toBe(true);

        const downgraded = await api.disableFeature("plugin-a", "modal-blur", {takeover: false});
        expect(downgraded.ok).toBe(true);
        expect(manager.isTakenOver("modal-blur")).toBe(false);
        expect(manager.viewOf("modal-blur").notice).toMatchObject({caller: "plugin-a", value: false});

        // 即使内存中 notices 为空，clearAllNotices 也要清掉可能残留的磁盘文件
        await manager.clearNotice("modal-blur");
        host.files.set(EXTERNAL_NOTICES_STORAGE, {
            "modal-blur": {caller: "ghost", key: "enabled", value: true, updatedAt: 1},
        });
        await manager.clearAllNotices();
        expect(host.files.has(EXTERNAL_NOTICES_STORAGE)).toBe(false);
    });

    it("returns write-failed if ConfigStore drops the patch during a bulk clear", async () => {
        const host = new FakeHost();
        const {store, manager, api} = await setup(host);
        // 模拟清空独占锁正在运行
        (store as unknown as {exclusive?: Promise<void>;}).exclusive = Promise.resolve();

        const res = await api.enableFeature("plugin-a", "modal-blur", {takeover: true});
        expect(res).toMatchObject({ok: false, code: "write-failed"});
        expect(manager.isTakenOver("modal-blur")).toBe(false);
    });
});
