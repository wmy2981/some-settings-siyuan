/**
 * 界面：代码片段编辑区域支持代码高亮，遵循思源自己的高亮设置。
 *
 * 思源的代码片段编辑区是一个纯 `<textarea>`——没有任何分色能力。所以这里用
 * 「透明 textarea + 底层高亮层」的经典做法：textarea 继续负责输入、光标、选区、
 * 撤销，只是把文字画成透明；它下面叠一层 `<pre><code class="hljs">`，
 * 用与 textarea 完全一致的字体和内边距渲染高亮结果，两层逐像素对齐。
 *
 * 高亮用的是思源自己那份 highlight.js 与它当前选中的主题样式表
 * （`appearance.codeBlockThemeLight/Dark`），所以"遵循思源高亮设置"是字面意义上的：
 * 换成任何一张思源内置主题，这里跟着变。
 *
 * 安全性：只有在高亮层已经渲染出内容之后才会把 textarea 的文字变透明；
 * highlight.js 迟迟加载不出来时会整个拆掉，绝不会留下一个看不见字的编辑框。
 */
import {defineFeature} from "../../core/types";
import {mountSnippetHighlight} from "./highlight";

export default defineFeature({
    id: "code-snippet-highlight",
    category: "ui",
    name: "feature.codeSnippetHighlight.name",
    description: "feature.codeSnippetHighlight.desc",
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            default: false,
        },
    ],
    mount: mountSnippetHighlight,
});
