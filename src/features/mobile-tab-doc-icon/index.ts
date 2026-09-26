/**
 * 界面：移动端页签页的默认文档图标样式（SVG / emoji / 跟随思源设置）。
 *
 * 移动端的页签概览对没有图标的页签**强制**使用默认 SVG 图标（内核源码里明确写了
 * 这里不跟随 `fileTree.useSVGDefaultIcon`），所以桌面端设成 emoji 的用户在移动端
 * 看到的始终是 SVG。这个功能把选择权还回来：
 *
 * - `svg`：保持内核的默认 SVG
 * - `emoji`：换成思源自己的默认文档 emoji
 * - `follow`：跟随「设置 - 文件树 - 使用 SVG 图标」
 *
 * 只改默认占位图标，页签本身已经带 emoji 或自定义图片时一律不碰。
 */
import {defineFeature} from "../../core/types";
import {mountMobileTabDocIcon} from "./tabicon";

export default defineFeature({
    id: "mobile-tab-doc-icon",
    category: "ui",
    name: "feature.mobileTabDocIcon.name",
    description: "feature.mobileTabDocIcon.desc",
    frontends: ["mobile"],
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            default: false,
        },
        {
            kind: "select",
            key: "style",
            title: "mobileTabDocIcon.style",
            default: "follow",
            options: [
                {value: "follow", label: "mobileTabDocIcon.styleFollow"},
                {value: "svg", label: "mobileTabDocIcon.styleSvg"},
                {value: "emoji", label: "mobileTabDocIcon.styleEmoji"},
            ],
        },
    ],
    mount: mountMobileTabDocIcon,
});
