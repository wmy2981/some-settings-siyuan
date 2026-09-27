/**
 * 界面：移动端长按菜单里的纯图标按钮补上文字。
 *
 * 移动端长按选区弹出来的那排操作全是纯图标按钮（`.keyboard__action`），
 * 文字只写在 `aria-label` 上，DOM 里没有文本节点，所以看起来只有图标。
 *
 * 这里按需往按钮里补一个 `<span>`——内核同一个菜单里的「更多」二级项
 * （`copyPlainText` 等）本来就是这么写的，样式（`.keyboard__action span`）
 * 也已经存在，补上即可正常显示。
 *
 * 菜单每次打开都会重写 `innerHTML`，所以必须每次重新补。
 */
import {defineFeature} from "../../core/types";
import {mountLongpressMenuLabel} from "./label";

export default defineFeature({
    id: "mobile-longpress-menu-label",
    category: "ui",
    name: "feature.mobileLongpressMenuLabel.name",
    description: "feature.mobileLongpressMenuLabel.desc",
    frontends: ["mobile"],
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            default: false,
        },
    ],
    mount: mountLongpressMenuLabel,
});
