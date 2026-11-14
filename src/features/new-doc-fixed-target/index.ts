/**
 * 功能：普通「新建文档」总是写到指定的笔记本或文档下。
 *
 * 目标留空时完全交回思源。实现见 target.ts：守在普通新建文档唯一的内核计划请求上，
 * 只换掉这次请求的目标位置；建文档、打开页签与提示仍走思源自己的链路，
 * 因此菜单、页签栏、空白页、搜索结果、快捷键与命令面板等原生入口一并覆盖；
 * 新建子文档、日记、引用类创建以及斜杠菜单里的「新建文档（插入块引用）」保持宿主行为。
 */
import {defineFeature} from "../../core/types";
import {mountNewDocFixedTarget} from "./target";

export default defineFeature({
    id: "new-doc-fixed-target",
    category: "editor",
    enabled: true,
    name: "feature.newDocFixedTarget.title",
    description: "feature.newDocFixedTarget.description",
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            default: false,
        },
        {
            kind: "text",
            key: "target",
            title: "feature.newDocFixedTarget.target",
            description: "feature.newDocFixedTarget.targetTip",
            default: "",
            placeholder: "feature.newDocFixedTarget.targetPlaceholder",
        },
    ],
    mount: mountNewDocFixedTarget,
});
