/**
 * 插件入口。
 *
 * 只做四件事：
 * 1. onload —— 建立功能装载器、注册内联图标、同步挂载各功能（顶栏/命令/停靠栏必须同步注册）
 * 2. onLayoutReady —— 挂上插件自己的顶栏入口，打开设置面板
 * 3. onunload —— 释放全部功能，幂等
 * 4. uninstall —— 保留插件自己的全部存储（不删数据目录）
 *
 * 任何功能的异常都在 core/error.ts 里被隔离，不允许冒泡到这里。
 */
import {
    Plugin,
    showMessage,
} from "siyuan";
import {FeatureManager} from "./core/bootstrap";
import {
    guardSilent,
    reportError,
} from "./core/error";
import {
    EXTERNAL_API_READY_EVENT,
    EXTERNAL_API_UNLOAD_EVENT,
    EXTERNAL_API_VERSION,
    type ExternalApiReadyDetail,
    type ExternalApiUnloadDetail,
    type SomeSettingsPublicApi,
} from "./core/external-api";
import {currentFrontend} from "./core/frontend";
import {
    createLogger,
    isDetailedLogging,
    logLoaded,
} from "./core/log";
// 集市要求包根目录必须有 index.css；各功能自己的样式走 host.addStyle() 运行时注入
import "./index.scss";
import manifest from "../plugin.json";

const log = createLogger("core");

/** 插件在文档里内联注入的图标，24x24，viewBox 与思源内置图标一致。 */
const PLUGIN_ICONS = `<symbol id="iconSSSomeSettings" viewBox="0 0 32 32">
<path d="M16 10.667a5.333 5.333 0 1 0 0 10.666 5.333 5.333 0 0 0 0-10.666zm0 8a2.667 2.667 0 1 1 0-5.334 2.667 2.667 0 0 1 0 5.334z"></path>
<path d="M27.76 17.6l-2.08-1.2a9.6 9.6 0 0 0 0-.8l2.08-1.2a1.333 1.333 0 0 0 .48-1.813l-2.133-3.68a1.333 1.333 0 0 0-1.814-.494l-2.08 1.2a9.6 9.6 0 0 0-.693-.4l-.32-2.4A1.333 1.333 0 0 0 19.867 5.5h-4.267a1.333 1.333 0 0 0-1.32 1.147l-.32 2.4a9.6 9.6 0 0 0-.693.4l-2.08-1.2a1.333 1.333 0 0 0-1.814.494L7.24 12.42a1.333 1.333 0 0 0 .48 1.813l2.08 1.2a9.6 9.6 0 0 0 0 .8l-2.08 1.2a1.333 1.333 0 0 0-.48 1.814l2.133 3.68a1.333 1.333 0 0 0 1.814.493l2.08-1.2c.227.147.453.28.693.4l.32 2.4a1.333 1.333 0 0 0 1.32 1.147h4.267a1.333 1.333 0 0 0 1.32-1.147l.32-2.4c.24-.12.467-.253.693-.4l2.08 1.2a1.333 1.333 0 0 0 1.814-.493l2.133-3.68a1.333 1.333 0 0 0-.48-1.814zm-2.987 4.373l-1.853-1.067a1.333 1.333 0 0 0-1.6.2 6.4 6.4 0 0 1-1.44 1.04 1.333 1.333 0 0 0-.653 1.467l.28 2.133h-2.347l-.28-2.133a1.333 1.333 0 0 0-.653-1.467 6.4 6.4 0 0 1-1.44-1.04 1.333 1.333 0 0 0-1.6-.2l-1.853 1.067-1.174-2.027 1.854-1.067a1.333 1.333 0 0 0 .666-1.44 6.4 6.4 0 0 1 0-2.08 1.333 1.333 0 0 0-.666-1.44L8.547 12l1.173-2.027 1.854 1.067a1.333 1.333 0 0 0 1.6-.2 6.4 6.4 0 0 1 1.44-1.04 1.333 1.333 0 0 0 .653-1.467l-.28-2.133h2.347l.28 2.133a1.333 1.333 0 0 0 .653 1.467c.52.28 1 .627 1.44 1.04a1.333 1.333 0 0 0 1.6.2l1.853-1.067 1.174 2.027-1.854 1.067a1.333 1.333 0 0 0-.666 1.44 6.4 6.4 0 0 1 0 2.08 1.333 1.333 0 0 0 .666 1.44l1.854 1.067z"></path>
</symbol>`;

const dispatchLifecycleEvent = (name: string, detail: ExternalApiReadyDetail | ExternalApiUnloadDetail): void => {
    if (
        typeof window === "undefined" || typeof window.dispatchEvent !== "function" || typeof CustomEvent !== "function"
    ) {
        return;
    }
    guardSilent(`api.event.${name}`, () => {
        window.dispatchEvent(new CustomEvent(name, {detail}));
    });
};

export default class SomeSettingsPlugin extends Plugin {
    private manager: FeatureManager = new FeatureManager(this);

    /** 面向其他思源插件的公开控制接口（通过 `app.plugins` 获取本插件实例后访问）。 */
    get api(): SomeSettingsPublicApi {
        return this.manager.api;
    }

    async onload(): Promise<void> {
        log.info("onload started", {
            version: manifest.version,
            frontend: currentFrontend(),
            kernelVersion: window.siyuan?.config?.system?.kernelVersion ?? "unknown",
        });
        this.addIcons(PLUGIN_ICONS);
        if (this.manager.isDisposed) {
            this.manager = new FeatureManager(this);
        }
        const manager = this.manager;
        await manager.load();
        if (this.manager !== manager || manager.isDisposed) {
            return;
        }
        dispatchLifecycleEvent(EXTERNAL_API_READY_EVENT, {
            pluginName: this.name,
            version: EXTERNAL_API_VERSION,
            api: manager.api,
        });
        if (isDetailedLogging()) {
            log.info("plugin loaded");
        } else {
            // 详细日志关着时控制台里只留这一行：它来自 i18n，随宿主语言变化
            logLoaded(`${this.i18n["plugin.loaded"] ?? "some-settings-siyuan loaded"}`);
        }
    }

    async onunload(): Promise<void> {
        log.info("onunload started");
        try {
            this.manager.dispose();
        } catch (error) {
            reportError("onunload", error, false);
        }
        dispatchLifecycleEvent(EXTERNAL_API_UNLOAD_EVENT, {
            pluginName: this.name,
            version: EXTERNAL_API_VERSION,
        });
    }

    /**
     * 卸载：本插件不删自己的存储目录。
     *
     * `data/storage/petal/<插件名>/` 里是各功能的配置、面板状态与用户自己维护的
     * `.patch.yml`。卸载插件不该连带删掉它们 —— 用户重装后应当拿回原来的设置与补丁，
     * 而不是从零开始。宿主只删插件包目录与集市元信息，petal 存储交给插件决定；
     * 这里刻意什么都不做，只写一条日志并照旧给出提示。
     */
    async uninstall(): Promise<void> {
        log.info("uninstall: keeping the plugin storage directory and every file in it");
        showMessage(`[${this.name}] ${this.i18n["plugin.unloaded"]}`, 4000);
    }

    /**
     * 覆盖基类的 openSetting：本插件不向顶栏/状态栏/停靠栏注册任何入口，
     * 设置面板只从思源内置入口打开——
     * 「设置 → 集市 → 已下载」里插件卡片上的「设置」按钮会调用本方法。
     * 宿主的 hasPluginSetting() 正是靠「覆盖了这个方法」来显示该按钮。
     */
    openSetting(): void {
        this.manager?.openSettings();
    }
}
