/**
 * 插件入口：卸载行为。
 *
 * 卸载只该落下一条提示，**不能**删插件私有目录里的任何东西 —— 配置与用户的
 * `.patch.yml` 都要留给重装后的自己。这里用宿主替身观察「有没有发删除请求」。
 */
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import {
    EXTERNAL_API_READY_EVENT,
    EXTERNAL_API_UNLOAD_EVENT,
    EXTERNAL_API_VERSION,
    type ExternalApiReadyDetail,
    type ExternalApiUnloadDetail,
} from "../src/core/external-api";
import {
    resetEffectiveFeatures,
    setEffectiveFeatures,
} from "../src/core/registry";
import type {FeatureDefinition} from "../src/core/types";
import SomeSettingsPlugin from "../src/index";
import {mockState} from "./mocks/siyuan";

const pluginOf = (): SomeSettingsPlugin =>
    new SomeSettingsPlugin(
        {
            name: "some-settings-siyuan",
            i18n: {"plugin.unloaded": "Some Settings unloaded", "plugin.loaded": "Some Settings loaded"},
        } as never,
    ) as SomeSettingsPlugin;

afterEach(() => {
    resetEffectiveFeatures();
});

describe("uninstall", () => {
    it("keeps the whole plugin storage directory", async () => {
        const plugin = pluginOf();
        mockState.fetchSyncPost.mockClear();
        await plugin.uninstall();
        // 既不列目录、也不删文件、更不删目录
        expect(mockState.fetchSyncPost).not.toHaveBeenCalled();
        expect(plugin.removeData).not.toHaveBeenCalled();
    });

    it("still tells the user the plugin is gone", async () => {
        await pluginOf().uninstall();
        expect(mockState.messages).toHaveLength(1);
        expect(mockState.messages[0].text).toContain("Some Settings unloaded");
    });
});

describe("external api lifecycle", () => {
    it("exposes plugin.api immediately, waits for onload, and dispatches ready/unload events", async () => {
        const feature: FeatureDefinition = {
            id: "demo-toggle",
            category: ["editor"],
            name: "demo.title",
            enabled: true,
            settings: [{kind: "switch", key: "enabled", title: "common.enabled", default: false}],
        };
        setEffectiveFeatures([feature]);

        const files = new Map<string, unknown>();
        const plugin = pluginOf();
        plugin.loadData = vi.fn(async (name: string) =>
            files.has(name) ? JSON.parse(JSON.stringify(files.get(name))) : ""
        );
        plugin.saveData = vi.fn(async (name: string, value: unknown) => {
            files.set(name, JSON.parse(JSON.stringify(value)));
            return {code: 0};
        });

        const readyEvents: ExternalApiReadyDetail[] = [];
        const unloadEvents: ExternalApiUnloadDetail[] = [];
        const onReady = (event: Event) => readyEvents.push((event as CustomEvent<ExternalApiReadyDetail>).detail);
        const onUnload = (event: Event) => unloadEvents.push((event as CustomEvent<ExternalApiUnloadDetail>).detail);
        window.addEventListener(EXTERNAL_API_READY_EVENT, onReady);
        window.addEventListener(EXTERNAL_API_UNLOAD_EVENT, onUnload);

        try {
            // onload 之前就能拿到 plugin.api，并异步等待初始化完成
            expect(plugin.api.version).toBe(EXTERNAL_API_VERSION);
            const earlyCall = plugin.api.enableFeature("external-plugin", "demo-toggle", {takeover: true});

            await plugin.onload();
            const result = await earlyCall;

            expect(result.ok).toBe(true);
            expect(files.get("feature-demo-toggle")).toEqual({enabled: true});
            expect(readyEvents).toHaveLength(1);
            expect(readyEvents[0]).toMatchObject({
                pluginName: "some-settings-siyuan",
                version: EXTERNAL_API_VERSION,
                api: plugin.api,
            });

            await plugin.onunload();
            expect(unloadEvents).toHaveLength(1);
            expect(unloadEvents[0]).toEqual({
                pluginName: "some-settings-siyuan",
                version: EXTERNAL_API_VERSION,
            });
            expect(await plugin.api.disableFeature("external-plugin", "demo-toggle")).toMatchObject({
                ok: false,
                code: "disposed",
            });
        } finally {
            window.removeEventListener(EXTERNAL_API_READY_EVENT, onReady);
            window.removeEventListener(EXTERNAL_API_UNLOAD_EVENT, onUnload);
        }
    });
});
