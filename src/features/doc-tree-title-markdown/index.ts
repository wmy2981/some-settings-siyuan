/**
 * 界面：文档树的笔记本与笔记标题渲染简单的行级 Markdown。
 *
 * 只认加粗、斜体、粗斜体、删除线、高亮与行级代码这几种写法，反斜杠转义的下一个
 * 字符不渲染；样式全部取自思源自己的行级主题变量，看起来与正文里的效果一致。
 */
import {defineFeature} from "../../core/types";
import {mountDocTreeTitleMarkdown} from "./render";

export default defineFeature({
    id: "doc-tree-title-markdown",
    category: "ui",
    name: "feature.docTreeTitleMarkdown.name",
    description: "feature.docTreeTitleMarkdown.desc",
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            default: false,
        },
    ],
    mount: mountDocTreeTitleMarkdown,
});
