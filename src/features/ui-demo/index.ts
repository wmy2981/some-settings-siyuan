/**
 * 示例功能（分类：界面）。
 *
 * 验证界面类功能的推荐做法：只注入一段带命名空间的 CSS，不去改写核心 DOM 结构。
 * 启停与换色都由配置驱动，卸载或关停时可完整回退。
 */
import {defineFeature} from "../../core/types";
import {mountUiDemo} from "./style";

export default defineFeature({
    id: "ui-demo",
    category: "ui",
    name: "feature.uiDemo.name",
    description: "feature.uiDemo.desc",
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "uiDemo.enabled",
            default: true,
        },
        {
            kind: "select",
            key: "accent",
            title: "uiDemo.accent",
            default: "red",
            options: [
                {value: "red", label: "uiDemo.accentRed"},
                {value: "orange", label: "uiDemo.accentOrange"},
                {value: "green", label: "uiDemo.accentGreen"},
                {value: "blue", label: "uiDemo.accentBlue"},
            ],
        },
    ],
    mount: mountUiDemo,
});
