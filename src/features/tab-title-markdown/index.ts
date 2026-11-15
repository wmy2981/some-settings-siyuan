/**
 * 界面：页签标题渲染行级 Markdown。
 *
 * 语法、样式与「文档树标题渲染行级 Markdown」完全一致（两者共用 core 里的同一个渲染器），
 * 区别只是作用对象：这里作用于页签。因为要区分桌面端与移动端，它没有独立的开关，
 * 而是用一个下拉当开关——「禁用」即不运行。
 */
import {defineFeature} from "../../core/types";
import {mountTabTitleMarkdown} from "./render";

export default defineFeature({
    id: "tab-title-markdown",
    category: "doc-tree",
    enabled: true,
    name: "feature.tabTitleMarkdown.title",
    description: "feature.tabTitleMarkdown.description",
    // 思源从 3.8.10-alpha.2 起自己把文档标题存成行级 AST，并把它投影进桌面页签条、
    // 移动端页签概览与大纲（`layout/Tab.ts` 的 `updateTitle`、`mobile/tabs/MobileTabs.ts`、
    // `protyle/header/documentTitlePreview.ts`）。标题里的行内格式从此由宿主负责，
    // 所以上限取它的前一个版本：到 3.8.10-alpha.1 为止这份补丁还有用，
    // 再往后插件不再加载它的配置、面板里也不再出现这一项。
    maxAppVersion: "3.8.10-alpha.1",
    isEnabled: (config) => config.scope !== "disabled",
    settings: [
        {
            kind: "select",
            key: "scope",
            title: "common.scope",
            default: "disabled",
            options: [
                {value: "disabled", label: "common.scope.disabled"},
                {value: "desktop", label: "common.scope.desktop"},
                {value: "mobile", label: "common.scope.mobile"},
                {value: "both", label: "common.scope.both"},
            ],
        },
    ],
    mount: mountTabTitleMarkdown,
});
