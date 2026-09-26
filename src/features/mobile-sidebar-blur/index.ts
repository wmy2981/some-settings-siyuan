/**
 * 界面：移动端侧面板高斯模糊。
 *
 * 移动端的左右侧面板是同一个类名下的两个元素（`#sidebar` / `#sidebarRight`），
 * 它们本身就盖满整屏并把内容推出视口。这里只做两件事：
 * 1. 给面板背景换成带透明度的同色，让背后的编辑区透出来；
 * 2. 在面板上开启 `backdrop-filter`，把透出来的部分虚化。
 *
 * 面板内部的工具栏有自己的底色，会挡住模糊，所以一并置为透明。
 */
import {defineFeature} from "../../core/types";
import {mountMobileSidebarBlur} from "./style";

export default defineFeature({
    id: "mobile-sidebar-blur",
    category: "ui",
    name: "feature.mobileSidebarBlur.name",
    description: "feature.mobileSidebarBlur.desc",
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
            title: "mobileSidebarBlur.radius",
            default: 14,
            min: 1,
            max: 40,
            step: 1,
            unit: "px",
        },
        {
            kind: "number",
            key: "opacity",
            title: "mobileSidebarBlur.opacity",
            default: 72,
            min: 0,
            max: 100,
            step: 1,
            unit: "%",
        },
    ],
    mount: mountMobileSidebarBlur,
});
