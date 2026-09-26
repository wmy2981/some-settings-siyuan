/**
 * 界面：桌面端命令面板瘦身。
 *
 * 命令面板是一张标准 Dialog（`data-key="dialog-commandpanel"`，尺寸由内核写成
 * 内联样式），内容由内核自己拼：搜索框 + 列表 + 底部快捷键提示条。
 * 每一项只有一行文字，外加可选的快捷键提示。
 *
 * 「瘦身」在这里只做三件可逆的事，全部走 CSS：
 * - 去掉底部那条占一整行高度的快捷键提示（键盘党并不需要它）
 * - 去掉每行右侧的快捷键提示，让文字有更多横向空间
 * - 压紧行高与行间距，同样高度里能多看几项
 *
 * 面板宽高是内联样式，插件不动它——改高度就得 `!important` 去覆盖内核的行内值，
 * 收益也只是"面板更小"，与"列表更紧凑"不是一回事。
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
            kind: "switch",
            key: "hideTip",
            title: "commandPanelSlim.hideTip",
            description: "commandPanelSlim.hideTipTip",
            default: true,
        },
        {
            kind: "switch",
            key: "hideMeta",
            title: "commandPanelSlim.hideMeta",
            description: "commandPanelSlim.hideMetaTip",
            default: false,
        },
        {
            kind: "number",
            key: "rowHeight",
            title: "commandPanelSlim.rowHeight",
            description: "commandPanelSlim.rowHeightTip",
            default: 24,
            min: 20,
            max: 32,
            step: 1,
            unit: "px",
        },
    ],
    mount: mountCommandPanelSlim,
});
