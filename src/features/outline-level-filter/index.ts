/**
 * 文档树：大纲只显示到指定标题级别。
 *
 * 思源原生大纲把 H1–H6 全部平铺出来，文档一旦用 H4–H6 做细分，大纲会变得很长，
 * 找章节反而更慢。原生 3.8.10 起有「展开到指定标题级别」，但那是**折叠**：
 * 更深的标题行还在，只是收在父级下面，换一篇文档还要再点一次。这里要的是**过滤**：
 * 超过所选层级的标题直接不出现，面板真正变短。
 *
 * 下拉本身就是开关，所以不额外加 `enabled` 开关：选「全部」等同于关闭，
 * 功能整个卸载、所有行原样回来。
 */
import {defineFeature} from "../../core/types";
import {mountOutlineLevelFilter} from "./style";

export default defineFeature({
    id: "outline-level-filter",
    category: "doc-tree",
    enabled: true,
    name: "feature.outlineLevelFilter.title",
    description: "feature.outlineLevelFilter.description",
    isEnabled: (config) => config.level !== "all",
    settings: [
        {
            kind: "select",
            key: "level",
            title: "feature.outlineLevelFilter.level",
            description: "feature.outlineLevelFilter.levelTip",
            default: "all",
            // 选项值不写成 2 / 3 / 4 / 5：选项文案的 key 由 `<设置项 key>.<选项值>` 机械拼出来，
            // 数字段不是合法的键名，所以这里用 h2–h5 与思源的标题级别同名。
            options: [
                {value: "all", label: "feature.outlineLevelFilter.level.all"},
                {value: "h2", label: "feature.outlineLevelFilter.level.h2"},
                {value: "h3", label: "feature.outlineLevelFilter.level.h3"},
                {value: "h4", label: "feature.outlineLevelFilter.level.h4"},
                {value: "h5", label: "feature.outlineLevelFilter.level.h5"},
            ],
        },
    ],
    mount: mountOutlineLevelFilter,
});
