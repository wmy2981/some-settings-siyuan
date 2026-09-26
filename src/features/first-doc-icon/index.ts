/**
 * 功能：为文档首次添加图标时，用设置里指定的 emoji，而不是随机一个。
 *
 * 思源的行为是：点标题区的「添加图标」按钮时，先取一个随机 emoji 写进 `icon` 属性，
 * 再弹出 emoji 选择面板（内核里没有「默认图标」这个配置项）。
 *
 * 插件在捕获阶段把这次点击拦下来，改走内核选择面板里"点一个 emoji"的那条通路：
 * 只写配置好的图标，再从面板自己的原生入口把它打开 —— 随机图标不会再出现，
 * 用户想换也随时能换。
 */
import {defineFeature} from "../../core/types";
import {mountFirstDocIcon} from "./icon";

export default defineFeature({
    id: "first-doc-icon",
    category: "function",
    name: "feature.firstDocIcon.name",
    description: "feature.firstDocIcon.desc",
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            default: false,
        },
        {
            kind: "text",
            key: "emoji",
            title: "firstDocIcon.emoji",
            description: "firstDocIcon.emojiTip",
            default: "📄",
            placeholder: "firstDocIcon.emojiPlaceholder",
        },
    ],
    mount: mountFirstDocIcon,
});
