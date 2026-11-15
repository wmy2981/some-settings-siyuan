/**
 * 编辑器：隐藏选中文字工具条。
 *
 * 桌面端选中文字后，思源会把 `.protyle-toolbar` 固定在选区上方弹出。对不常用格式按钮的
 * 人来说，它挡住了正文，每次选中都要先把它点掉。这里只提供一个开关，开启后这个工具条
 * 不再出现；快捷键（Ctrl/Cmd+B / I / U 等）、块菜单与右键菜单都不受影响。
 *
 * 表格单元格编辑、嵌入块编辑与文档标题复用同一个 `.protyle-toolbar`，会一起隐藏；
 * `.protyle-util`（字体 / 字号二级面板）与思维导图自己的 `.mindmap-view__toolbar` 不受影响。
 * 移动端本来就不显示这个工具条（用的是键盘上方 `keyboard__bar`），所以只声明桌面端。
 */
import {defineFeature} from "../../core/types";
import {mountHideSelectionToolbar} from "./style";

export default defineFeature({
    id: "hide-selection-toolbar",
    category: "editor",
    enabled: true,
    name: "feature.hideSelectionToolbar.title",
    description: "feature.hideSelectionToolbar.description",
    frontends: ["desktop"],
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            default: false,
            description: "feature.hideSelectionToolbar.enabledTip",
        },
    ],
    mount: mountHideSelectionToolbar,
});
