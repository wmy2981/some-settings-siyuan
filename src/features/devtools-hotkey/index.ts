/**
 * 功能：桌面端用 F12 开关开发者工具。
 *
 * 思源只在应用菜单（默认隐藏）和状态栏右键菜单里提供开发者工具，键盘上够不到它；
 * 这里补一个 F12，行为与那两个入口一致：开着的关掉、关着的打开。
 */
import {defineFeature} from "../../core/types";
import {mountDevtoolsHotkey} from "./hotkey";

export default defineFeature({
    id: "devtools-hotkey",
    category: "function",
    name: "feature.devtoolsHotkey.name",
    description: "feature.devtoolsHotkey.desc",
    frontends: ["desktop"],
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            default: false,
        },
    ],
    mount: mountDevtoolsHotkey,
});
