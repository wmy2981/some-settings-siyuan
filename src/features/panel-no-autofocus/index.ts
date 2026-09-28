/**
 * 界面：打开设置面板时不把焦点落到第一个控件上。
 *
 * 两处设置面板都会自动聚焦：思源自己的设置弹窗在桌面端打开时把焦点放到侧栏搜索框上
 * （`initSettingSearch`），本插件的面板则可能被宿主的 `Dialog` 顺延到第一行开关上。
 * 面板刚打开、用户还没动手时，这两种焦点都不是用户要的：回车/空格会直接改掉开关的值，
 * 移动端还会把软键盘顶起来。
 *
 * 这里不去猜"焦点是谁放的"：只要在用户自己动手之前有控件拿到焦点，就把焦点还给弹窗容器。
 * 用户一旦在面板里点过、按过键，那焦点就是他要的，守护立即结束。
 */
import {defineFeature} from "../../core/types";
import {mountPanelNoAutofocus} from "./focus";

export default defineFeature({
    id: "panel-no-autofocus",
    category: "ui",
    name: "feature.panelNoAutofocus.name",
    description: "feature.panelNoAutofocus.desc",
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            default: false,
        },
    ],
    mount: mountPanelNoAutofocus,
});
