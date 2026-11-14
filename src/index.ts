/**
 * 插件入口。
 *
 * 只做四件事：
 * 1. onload —— 建立功能装载器、注册内联图标、同步挂载各功能（顶栏/命令/停靠栏必须同步注册）
 * 2. onLayoutReady —— 挂上插件自己的顶栏入口，打开设置面板
 * 3. onunload —— 释放全部功能，幂等
 * 4. uninstall —— 删除插件自己的全部存储
 *
 * 任何功能的异常都在 core/error.ts 里被隔离，不允许冒泡到这里。
 */
import {
    Plugin,
    showMessage,
} from "siyuan";
import {FeatureManager} from "./core/bootstrap";
import {storageNameOf} from "./core/config";
import {
    guardAsync,
    reportError,
} from "./core/error";
import {currentFrontend} from "./core/frontend";
import {
    createLogger,
    isDetailedLogging,
    logLoaded,
} from "./core/log";
import {ALL_FEATURE_IDS} from "./core/registry";
import {
    CONFIG_IO_CONCURRENCY,
    listStoredFiles,
    mapLimit,
    removeStorageDir,
    removeStoredFile,
} from "./core/storage";
// 集市要求包根目录必须有 index.css；各功能自己的样式走 host.addStyle() 运行时注入
import "./index.scss";
import manifest from "../plugin.json";

const log = createLogger("core");

/** 插件在文档里内联注入的图标，24x24，viewBox 与思源内置图标一致。 */
const PLUGIN_ICONS = `<symbol id="iconSSSomeSettings" viewBox="0 0 32 32">
<path d="M16 10.667a5.333 5.333 0 1 0 0 10.666 5.333 5.333 0 0 0 0-10.666zm0 8a2.667 2.667 0 1 1 0-5.334 2.667 2.667 0 0 1 0 5.334z"></path>
<path d="M27.76 17.6l-2.08-1.2a9.6 9.6 0 0 0 0-.8l2.08-1.2a1.333 1.333 0 0 0 .48-1.813l-2.133-3.68a1.333 1.333 0 0 0-1.814-.494l-2.08 1.2a9.6 9.6 0 0 0-.693-.4l-.32-2.4A1.333 1.333 0 0 0 19.867 5.5h-4.267a1.333 1.333 0 0 0-1.32 1.147l-.32 2.4a9.6 9.6 0 0 0-.693.4l-2.08-1.2a1.333 1.333 0 0 0-1.814.494L7.24 12.42a1.333 1.333 0 0 0 .48 1.813l2.08 1.2a9.6 9.6 0 0 0 0 .8l-2.08 1.2a1.333 1.333 0 0 0-.48 1.814l2.133 3.68a1.333 1.333 0 0 0 1.814.493l2.08-1.2c.227.147.453.28.693.4l.32 2.4a1.333 1.333 0 0 0 1.32 1.147h4.267a1.333 1.333 0 0 0 1.32-1.147l.32-2.4c.24-.12.467-.253.693-.4l2.08 1.2a1.333 1.333 0 0 0 1.814-.493l2.133-3.68a1.333 1.333 0 0 0-.48-1.814zm-2.987 4.373l-1.853-1.067a1.333 1.333 0 0 0-1.6.2 6.4 6.4 0 0 1-1.44 1.04 1.333 1.333 0 0 0-.653 1.467l.28 2.133h-2.347l-.28-2.133a1.333 1.333 0 0 0-.653-1.467 6.4 6.4 0 0 1-1.44-1.04 1.333 1.333 0 0 0-1.6-.2l-1.853 1.067-1.174-2.027 1.854-1.067a1.333 1.333 0 0 0 .666-1.44 6.4 6.4 0 0 1 0-2.08 1.333 1.333 0 0 0-.666-1.44L8.547 12l1.173-2.027 1.854 1.067a1.333 1.333 0 0 0 1.6-.2 6.4 6.4 0 0 1 1.44-1.04 1.333 1.333 0 0 0 .653-1.467l-.28-2.133h2.347l.28 2.133a1.333 1.333 0 0 0 .653 1.467c.52.28 1 .627 1.44 1.04a1.333 1.333 0 0 0 1.6.2l1.853-1.067 1.174 2.027-1.854 1.067a1.333 1.333 0 0 0-.666 1.44 6.4 6.4 0 0 1 0 2.08 1.333 1.333 0 0 0 .666 1.44l1.854 1.067z"></path>
</symbol>`;

export default class SomeSettingsPlugin extends Plugin {
    private manager?: FeatureManager;

    async onload(): Promise<void> {
        log.info("onload started", {
            version: manifest.version,
            frontend: currentFrontend(),
            kernelVersion: window.siyuan?.config?.system?.kernelVersion ?? "unknown",
        });
        this.addIcons(PLUGIN_ICONS);
        const manager = new FeatureManager(this);
        this.manager = manager;
        await manager.load();
        if (isDetailedLogging()) {
            log.info("plugin loaded");
        } else {
            // 详细日志关着时控制台里只留这一行：它来自 i18n，随宿主语言变化
            logLoaded(`${this.i18n.helloPlugin ?? "some-settings-siyuan loaded"}`);
        }
    }

    async onunload(): Promise<void> {
        log.info("onunload started");
        try {
            this.manager?.dispose();
        } catch (error) {
            reportError("onunload", error, false);
        }
        this.manager = undefined;
    }

    /**
     * 卸载：删掉本插件存储目录下的全部配置文件。
     *
     * 目标按**目录里的文件**来，不按注册表里的功能来 —— 声明里的 enabled、前端适配、版本区间
     * 都只决定功能加不加载，退役的、甚至已经从插件里删掉的功能留下的配置文件同样是本插件的垃圾，
     * 宿主又只删 `data/plugins/<插件名>` 而不碰 petal 存储，不清掉它们就会一直躺在工作区里
     * 并跟着同步走。列目录失败时退回注册表清单：卸载里宁可少删几个，也不能一个都不删。
     */
    async uninstall(): Promise<void> {
        const storageNames = await this.storageNamesToRemove();
        log.info(`uninstall: removing ${storageNames.length} configuration file(s)`);
        // 宿主只给 5 秒预算，逐个 await 在大目录上会把预算吃光；文件之间互不依赖，
        // 按有限并发一起删。每个文件的结局单独收敛，一个失败不影响其余文件。
        await mapLimit(storageNames, CONFIG_IO_CONCURRENCY, async (storageName) => {
            await guardAsync(`uninstall.${storageName}`, async () => {
                const status = await removeStoredFile(this, storageName);
                if (!status.ok) {
                    log.warn(`uninstall could not remove ${storageName}: ${status.detail}`);
                } else {
                    log.info(`uninstall removed ${storageName}`);
                }
            }, false);
        });
        // 存储目录下可能还有功能自己建的子目录（例如自定义图标），逐个删文件清不掉它们；
        // 最后直接删整个目录收尾。整个卸载只有 5 秒预算，这一条也只发一次请求。
        await guardAsync("uninstall.storage", async () => {
            const status = await removeStorageDir(this);
            if (!status.ok) {
                log.warn(`uninstall could not remove the plugin storage directory: ${status.detail}`);
            } else {
                log.info("uninstall removed the plugin storage directory");
            }
        }, false);
        showMessage(`[${this.name}] ${this.i18n.byePlugin}`, 4000);
    }

    /** 卸载时要删的文件名：目录里的全部文件，列不出目录时退回注册表里的功能名单。 */
    private async storageNamesToRemove(): Promise<string[]> {
        try {
            return await listStoredFiles(this);
        } catch (error) {
            log.warn("uninstall could not list the plugin storage directory, falling back to the registry", error);
            return ALL_FEATURE_IDS.map(storageNameOf);
        }
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
