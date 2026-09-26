/**
 * 界面：行内代码复制按钮。
 *
 * 行内代码在编辑器里是 `<span data-type~="code">`，没有任何原生悬浮操作区
 * （原生 `.protyle-icons` 只服务块级渲染节点），所以按钮只能由插件自己提供。
 *
 * 按钮不插进行内代码元素内部：那是 `contenteditable` 的内容区，
 * 插进去的节点会被内核当成正文序列化。这里用挂在 body 上的浮动按钮，
 * 按行内代码的位置定位。
 */
import {defineFeature} from "../../core/types";
import {mountInlineCodeCopy} from "./copy";

export default defineFeature({
    id: "inline-code-copy",
    category: "ui",
    name: "feature.inlineCodeCopy.name",
    description: "feature.inlineCodeCopy.desc",
    isEnabled: (config) => config.mode !== "off",
    settings: [
        {
            kind: "select",
            key: "mode",
            title: "inlineCodeCopy.mode",
            default: "off",
            options: [
                {value: "off", label: "inlineCodeCopy.modeOff"},
                {value: "hover", label: "inlineCodeCopy.modeHover"},
                {value: "always", label: "inlineCodeCopy.modeAlways"},
            ],
        },
    ],
    mount: mountInlineCodeCopy,
});
