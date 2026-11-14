/**
 * 功能：在文档里用斜杠命令新建任意后缀的空文件到 `assets/`。
 *
 * 文件名由内核按导入流程追加笔记 ID，链接插在命令文本原来的位置；
 * 插件只负责问名字、提交一个空文件、插链接。详见 mount.ts。
 */
import {defineFeature} from "../../core/types";
import {mountAssetsNewFile} from "./mount";

export default defineFeature({
    id: "assets-new-file",
    category: "editor",
    enabled: true,
    name: "feature.assetsNewFile.title",
    description: "feature.assetsNewFile.description",
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            default: false,
        },
    ],
    mount: mountAssetsNewFile,
});
