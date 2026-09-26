/**
 * 界面：桌面端命令面板瘦身。
 *
 * 命令面板是一张标准 Dialog（`data-key="dialog-commandpanel"`），内核给它的宽度是
 * 写死在容器内联样式里的 `80vw` —— 在宽屏上几乎横贯整个窗口，挡住正文。
 *
 * 这里只做一件事：把宽度按同一个基准值缩到指定百分比（默认 50%，即 `40vw`）。
 * 面板行为、行高、快捷键提示一律不动。
 */
import {defineFeature} from "../../core/types";
import {mountCommandPanelSlim} from "./slim";

export default defineFeature({
    id: "desktop-command-panel-slim",
    category: "ui",
    name: "feature.commandPanelSlim.name",
    description: "feature.commandPanelSlim.desc",
    frontends: ["desktop"],
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            default: false,
        },
        {
            kind: "number",
            key: "width",
            title: "commandPanelSlim.width",
            description: "commandPanelSlim.widthTip",
            default: 50,
            min: 20,
            max: 100,
            step: 5,
            unit: "%",
        },
    ],
    mount: mountCommandPanelSlim,
});
