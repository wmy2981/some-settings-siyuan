/**
 * 界面：移动端悬浮 dock 栏高斯模糊。
 *
 * 悬浮 dock 栏就是 `#mobileBottomBar`（`.mobile-bottom-bar`），它是一个
 * 定宽浮动的胶囊，背景用的是 `--b3-theme-background`。把背景换成同色半透明
 * 再开 `backdrop-filter`，滚动的正文就会在胶囊底下虚化。
 *
 * 滚动显隐走的是 `opacity` 与 `transform`（不进 `display`），
 * 高斯模糊跟着透明度的变化一起淡出，不会留下硬边。
 */
import {defineFeature} from "../../core/types";
import {mountMobileDockBlur} from "./style";

export default defineFeature({
    id: "mobile-dock-blur",
    category: "ui",
    name: "feature.mobileDockBlur.name",
    description: "feature.mobileDockBlur.desc",
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            default: false,
        },
        {
            kind: "number",
            key: "radius",
            title: "mobileDockBlur.radius",
            default: 14,
            min: 1,
            max: 40,
            step: 1,
            unit: "px",
        },
        {
            kind: "number",
            key: "opacity",
            title: "mobileDockBlur.opacity",
            default: 70,
            min: 0,
            max: 100,
            step: 1,
            unit: "%",
        },
    ],
    mount: mountMobileDockBlur,
});
