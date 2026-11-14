/**
 * 界面：文档树的笔记本与笔记标题渲染简单的行级 Markdown。
 *
 * 只认加粗、斜体、粗斜体、删除线、高亮、上标、下标与行级代码这几种写法，反斜杠
 * 转义的下一个字符不渲染；样式全部取自思源自己的行级主题变量，看起来与正文里的一致。
 */
import {defineFeature} from "../../core/types";
import {mountDocTreeTitleMarkdown} from "./render";

export default defineFeature({
    id: "doc-tree-title-markdown",
    category: "doc-tree",
    enabled: true,
    name: "feature.docTreeTitleMarkdown.title",
    description: "feature.docTreeTitleMarkdown.description",
    // 思源从 3.8.10-alpha.2 起自己把文档标题存成行级 AST，并把它投影进文档树的标题元素
    // （`protyle/header/documentTitlePreview.ts` + `layout/dock/docTree/DocTreeController.ts`）。
    // 标题里的行内格式从此由宿主负责，所以上限取它的前一个版本：
    // 到 3.8.10-alpha.1 为止这份补丁还有用，再往后插件不再加载它的配置、面板里也不再出现这一项。
    maxAppVersion: "3.8.10-alpha.1",
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
