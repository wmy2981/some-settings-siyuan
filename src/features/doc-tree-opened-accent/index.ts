/**
 * 界面：文档树里当前打开的笔记左边缘显示一条贴合的强调色。
 *
 * 文档树里"当前打开的笔记"就是被标了 `b3-list-item--focus` 的那一条，
 * 桌面端在 `.sy__file` 面板里，移动端在侧面板的 `[data-type="sidebar-file"]` 里。
 *
 * 用 `box-shadow: inset` 而不是 `border-left`：前者不参与布局，
 * 加不加都不会让树里的文字横向位移，也不会因为 `border-radius` 在左缘留下圆角缺口。
 */
import {defineFeature} from "../../core/types";
import {mountDocTreeOpenedAccent} from "./style";

export default defineFeature({
    id: "doc-tree-opened-accent",
    category: "ui",
    name: "feature.docTreeOpenedAccent.name",
    description: "feature.docTreeOpenedAccent.desc",
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            default: false,
        },
        {
            kind: "text",
            key: "color",
            title: "docTreeOpenedAccent.color",
            description: "docTreeOpenedAccent.colorTip",
            default: "",
            placeholder: "docTreeOpenedAccent.colorPlaceholder",
        },
        {
            kind: "number",
            key: "width",
            title: "docTreeOpenedAccent.width",
            default: 3,
            min: 1,
            max: 10,
            step: 1,
            unit: "px",
        },
    ],
    mount: mountDocTreeOpenedAccent,
});
