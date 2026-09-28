/**
 * 功能：通过书签打开整篇笔记时，跳到上次读到的位置。
 *
 * 思源只在文档树那条路上恢复了上次位置，书签那条路没有，于是书签打开的笔记总是停在开头。
 * 本功能把书签的单击换成与文档树完全相同的打开动作。
 */
import {defineFeature} from "../../core/types";
import {mountBookmarkLastPosition} from "./bookmark";

export default defineFeature({
    id: "bookmark-last-position",
    category: "function",
    name: "feature.bookmarkLastPosition.name",
    description: "feature.bookmarkLastPosition.desc",
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            default: false,
        },
    ],
    mount: mountBookmarkLastPosition,
});
