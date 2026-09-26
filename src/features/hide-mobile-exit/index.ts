/**
 * 界面：隐藏移动端侧面板里那个只有图标的「退出应用」按钮。
 *
 * 它是移动端右侧面板工具栏里的 `#sidebarRightExit`（图标为 `#iconQuit`），
 * 只在移动端 App 内才会被 `initFramework` 去掉 `fn__none` 显示出来，
 * 且始终只有图标、没有文字，极易误触。
 *
 * 选择器带上 `#sidebarRight > .toolbar` 提高优先级，避免和面板布局相关的
 * 规则打架；不使用 `!important`。
 */
import {defineFeature} from "../../core/types";
import {mountHideMobileExit} from "./style";

export default defineFeature({
    id: "hide-mobile-exit",
    category: "ui",
    name: "feature.hideMobileExit.name",
    description: "feature.hideMobileExit.desc",
    frontends: ["mobile"],
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            default: false,
        },
    ],
    mount: mountHideMobileExit,
});
