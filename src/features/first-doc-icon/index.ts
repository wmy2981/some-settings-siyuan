/**
 * 功能：为文档首次添加图标时，用设置里指定的 emoji，而不是随机一个。
 *
 * 思源的行为是：点标题区的「添加图标」按钮时，先取一个随机 emoji 写进 `icon` 属性，
 * 再弹出 emoji 选择面板（内核里没有「默认图标」这个配置项）。
 *
 * 插件不去抢这次点击——那会连带把「更新文件树/大纲图标 + 打开选择面板」一并丢掉。
 * 做法是在捕获阶段旁听这次点击，等内核自己的处理器跑完，再把 `icon` 属性覆盖成
 * 配置里的 emoji，并把标题区的图标同步过去。选择面板照旧打开，用户想换随时能换。
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
