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
    category: "ui",
    name: "feature.tabTitleMarkdown.name",
    description: "feature.tabTitleMarkdown.desc",
    isEnabled: (config) => config.scope !== "disabled",
    settings: [
        {
            kind: "select",
            key: "scope",
            title: "tabTitleMarkdown.scope",
            default: "disabled",
            options: [
                {value: "disabled", label: "tabTitleMarkdown.scopeDisabled"},
                {value: "desktop", label: "tabTitleMarkdown.scopeDesktop"},
                {value: "mobile", label: "tabTitleMarkdown.scopeMobile"},
                {value: "both", label: "tabTitleMarkdown.scopeBoth"},
            ],
        },
    ],
    mount: mountTabTitleMarkdown,
});
