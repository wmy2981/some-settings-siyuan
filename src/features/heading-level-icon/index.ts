/**
 * 界面：引用列表与搜索面板里的标题图标带上层级。
 *
 * 这两处给标题块显示的都是一个通用的大写 H，看不出是 h1 还是 h6。
 * 打开后改用思源自己的 H1～H6 图标，层级数字画在 H 的右下角（即下角标的效果）。
 */
import {defineFeature} from "../../core/types";
import {mountHeadingLevelIcon} from "./level";

export default defineFeature({
    id: "heading-level-icon",
    category: "ui",
    name: "feature.headingLevelIcon.name",
    description: "feature.headingLevelIcon.desc",
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            default: false,
        },
    ],
    mount: mountHeadingLevelIcon,
});
