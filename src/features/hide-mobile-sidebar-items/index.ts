/**
 * 界面：隐藏移动端侧面板里的指定导航项。
 *
 * 移动端左右侧面板的导航项就是页签条里的那些图标（`data-type="sidebar-xxx-tab"`），
 * 插件 dock 用 `data-mobile-plugin-dock-tab`。隐藏靠加 `fn__none`——
 * 内核自己的切页签逻辑本来就会跳过带这个类的项，所以隐藏之后不会出现
 * 「切到一个空面板」的情况（这一点用 `display: none` 做不到）。
 *
 * 只添加、不摘除：内核为了「当前不可用」等原因主动给某个页签加上的 `fn__none`
 * 不归我们管，恢复时也只恢复我们自己加过的那些。
 */
import {defineFeature} from "../../core/types";
import {mountHideSidebarItems} from "./hide";

export default defineFeature({
    id: "hide-mobile-sidebar-items",
    category: "ui",
    name: "feature.hideMobileSidebarItems.name",
    description: "feature.hideMobileSidebarItems.desc",
    frontends: ["mobile"],
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            default: false,
        },
        {
            kind: "text",
            key: "items",
            title: "hideMobileSidebarItems.items",
            description: "hideMobileSidebarItems.itemsTip",
            default: "",
            placeholder: "hideMobileSidebarItems.itemsPlaceholder",
        },
    ],
    mount: mountHideSidebarItems,
});
