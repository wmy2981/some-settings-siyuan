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
    logInfo,
    reportError,
} from "./core/error";
import {ALL_FEATURE_IDS} from "./core/registry";
// 集市要求包根目录必须有 index.css；各功能自己的样式走 host.addStyle() 运行时注入
import "./index.scss";

/** 插件在文档里内联注入的图标，24x24，viewBox 与思源内置图标一致。 */
const PLUGIN_ICONS = `<symbol id="iconSSSomeSettings" viewBox="0 0 32 32">
<path d="M16 10.667a5.333 5.333 0 1 0 0 10.666 5.333 5.333 0 0 0 0-10.666zm0 8a2.667 2.667 0 1 1 0-5.334 2.667 2.667 0 0 1 0 5.334z"></path>
<path d="M27.76 17.6l-2.08-1.2a9.6 9.6 0 0 0 0-.8l2.08-1.2a1.333 1.333 0 0 0 .48-1.813l-2.133-3.68a1.333 1.333 0 0 0-1.814-.494l-2.08 1.2a9.6 9.6 0 0 0-.693-.4l-.32-2.4A1.333 1.333 0 0 0 19.867 5.5h-4.267a1.333 1.333 0 0 0-1.32 1.147l-.32 2.4a9.6 9.6 0 0 0-.693.4l-2.08-1.2a1.333 1.333 0 0 0-1.814.494L7.24 12.42a1.333 1.333 0 0 0 .48 1.813l2.08 1.2a9.6 9.6 0 0 0 0 .8l-2.08 1.2a1.333 1.333 0 0 0-.48 1.814l2.133 3.68a1.333 1.333 0 0 0 1.814.493l2.08-1.2c.227.147.453.28.693.4l.32 2.4a1.333 1.333 0 0 0 1.32 1.147h4.267a1.333 1.333 0 0 0 1.32-1.147l.32-2.4c.24-.12.467-.253.693-.4l2.08 1.2a1.333 1.333 0 0 0 1.814-.493l2.133-3.68a1.333 1.333 0 0 0-.48-1.814zm-2.987 4.373l-1.853-1.067a1.333 1.333 0 0 0-1.6.2 6.4 6.4 0 0 1-1.44 1.04 1.333 1.333 0 0 0-.653 1.467l.28 2.133h-2.347l-.28-2.133a1.333 1.333 0 0 0-.653-1.467 6.4 6.4 0 0 1-1.44-1.04 1.333 1.333 0 0 0-1.6-.2l-1.853 1.067-1.174-2.027 1.854-1.067a1.333 1.333 0 0 0 .666-1.44 6.4 6.4 0 0 1 0-2.08 1.333 1.333 0 0 0-.666-1.44L8.547 12l1.173-2.027 1.854 1.067a1.333 1.333 0 0 0 1.6-.2 6.4 6.4 0 0 1 1.44-1.04 1.333 1.333 0 0 0 .653-1.467l-.28-2.133h2.347l.28 2.133a1.333 1.333 0 0 0 .653 1.467c.52.28 1 .627 1.44 1.04a1.333 1.333 0 0 0 1.6.2l1.853-1.067 1.174 2.027-1.854 1.067a1.333 1.333 0 0 0-.666 1.44 6.4 6.4 0 0 1 0 2.08 1.333 1.333 0 0 0 .666 1.44l1.854 1.067z"></path>
</symbol>`;

export default class SomeSettingsPlugin extends Plugin {
    private manager?: FeatureManager;

    async onload(): Promise<void> {
        this.addIcons(PLUGIN_ICONS);
        const manager = new FeatureManager(this);
        this.manager = manager;
        await manager.load();
        logInfo(`${this.i18n.helloPlugin}`);
    }

    onLayoutReady(): void {
        this.addTopBar({
            icon: "iconSSSomeSettings",
            title: this.i18n.topBarTip as string,
            position: "right",
            callback: () => this.openSettings(),
            contextMenu: (menu) => {
                menu.addItem({
                    id: `${this.name}-open-settings`,
                    icon: "iconSettings",
                    label: this.i18n.openSettings as string,
                    click: () => this.openSettings(),
                });
            },
        });
    }

    async onunload(): Promise<void> {
        try {
            this.manager?.dispose();
        } catch (error) {
            reportError("onunload", error, false);
        }
        this.manager = undefined;
        logInfo(`${this.i18n.byePlugin}`);
    }

    async uninstall(): Promise<void> {
        for (const id of ALL_FEATURE_IDS) {
            await guardAsync(`uninstall.${id}`, async () => {
                await this.removeData(storageNameOf(id));
            }, false);
        }
        showMessage(`[${this.name}] ${this.i18n.byePlugin}`, 4000);
    }

    openSettings(): void {
        if (!this.manager) {
            return;
        }
        this.manager.openSettings();
    }
}
