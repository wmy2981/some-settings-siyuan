/**
 * 界面：打开设置面板时不把焦点落到第一个控件上。
 *
 * 思源的 `Dialog` 自己只把焦点放在弹窗容器（`.b3-dialog__container`，`tabindex="-1"`）上，
 * 但容器一被重排、或者宿主换了个版本改成"聚焦第一个输入框"，焦点就会顺延给面板里第一个
 * 可聚焦控件：面板刚打开，第一行的开关已经带上焦点（回车/空格会直接改掉它的值），
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
