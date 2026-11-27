/**
 * 集市 / 界面：移动端插件设置抽屉打开即全屏。
 *
 * 宿主的 `Setting` 在移动端被渲染成底部抽屉，高度固定按「半屏」写进内联样式；
 * 插件设置项一多，半屏只能看到两三行，还要先拖一下抓手才能展开。这里让插件设置抽屉
 * 一打开就铺满可用高度，与向上拖到全屏后的高度一致。
 *
 * 只认插件设置抽屉：标题是本机已装插件的显示名（或插件名）的抽屉才改。
 */
import {defineFeature} from "../../core/types";
import {mountMobilePluginSettingsFullscreen} from "./fullscreen";

export default defineFeature({
    id: "mobile-plugin-settings-fullscreen",
    category: ["bazaar", "appearance"],
    enabled: true,
    name: "feature.mobilePluginSettingsFullscreen.title",
    description: "feature.mobilePluginSettingsFullscreen.description",
    frontends: ["mobile"],
    // 底部抽屉（`.mobile-sheet-panel`）是宿主从 3.8.12-alpha.2 起才有的
    minAppVersion: "3.8.12-alpha.2",
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            default: false,
        },
    ],
    mount: mountMobilePluginSettingsFullscreen,
});
