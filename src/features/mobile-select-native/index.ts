/**
 * 界面：移动端下拉选择器改用思源原生样式。
 *
 * `<select>` 展开后的候选弹层是 WebView/系统自己画的，CSS 完全够不着，
 * 所以"让下拉用思源样式"只能换掉这个弹层本身：拦下指针事件，
 * 用思源自己的 `Menu` 把同样的候选项列出来，选中后把值写回 `<select>`
 * 并补发 `input` / `change`，插件设置面板以及内核各处依赖 change 的逻辑照常工作。
 *
 * 这是尽力而为的方案：能拦住 WebView 默认弹层就拦住，拦不住（个别内核/系统组合）
 * 也只是回到系统默认弹层，不会让选择器失效。
 */
import {defineFeature} from "../../core/types";
import {mountMobileSelectNative} from "./select";

export default defineFeature({
    id: "mobile-select-native",
    category: "appearance",
    enabled: true,
    name: "feature.mobileSelectNative.title",
    description: "feature.mobileSelectNative.description",
    frontends: ["mobile"],
    // 思源 v3.8.7-alpha.2 起自己统一了移动端下拉选择器（`mobile/util/nativeSelect.ts`，
    // 比这份补丁更完整：支持 optgroup、option 的 hidden/disabled 与键盘操作），
    // 所以上限取它的前一个版本：到 v3.8.7-alpha.2 为止这份补丁还有用，
    // 再往后插件不再加载它的配置，设置面板里也不再出现这一项。
    maxAppVersion: "3.8.7-alpha.2",
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            default: false,
        },
    ],
    mount: mountMobileSelectNative,
});
