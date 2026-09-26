/**
 * 界面：移动端操作某个块时，保证它的块标一直显示。
 *
 * 思源的块标是一个 protyle 一个 `.protyle-gutters` 容器，`position: fixed`，
 * 由内核在触摸/移动时把当前块的块标渲染进去；一旦内核把容器加上 `fn__none`
 * 并清空 `innerHTML`，块标就没了——移动端在连续操作一个块的过程中会被反复清掉，
 * 于是图标"时而显示时而隐藏"。
 *
 * 插件不去重绘块标，也不去碰内核的渲染时机：只在容器被清掉的那一刻，
 * 把刚才那一份 `innerHTML` 与内联定位原样搬回去。这样搬回来的块标是**真的**
 * 内核块标——点击监听挂在内核的容器上而不是按钮上，所以点它照样弹原生菜单。
 *
 * 与「总是显示标题块块标」的关系：那一项经调研确认（纯 CSS 与官方扩展点都做不到
 * 常显，只能整页重写内核的块标渲染）已由用户决定跳过，因此这里不存在冲突。
 */
import {defineFeature} from "../../core/types";
import {mountMobileBlockIconAlways} from "./gutter";

export default defineFeature({
    id: "mobile-block-icon-always",
    category: "ui",
    name: "feature.mobileBlockIconAlways.name",
    description: "feature.mobileBlockIconAlways.desc",
    frontends: ["mobile"],
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            default: false,
        },
    ],
    mount: mountMobileBlockIconAlways,
});
