/**
 * 功能：引用的资源文件在右键 / 长按菜单里显示文件大小与简单元数据。
 *
 * 图片走图片自己的右键（移动端是长按）菜单，指向资源的行内链接走链接菜单，
 * 音频 / 视频 / iframe 这类资源块以及引用了资源的块走块标菜单。
 * 这几行直接落在菜单里（和思源自己的「更新于 / 创建于」同级），不进「插件」子菜单。
 */
import {defineFeature} from "../../core/types";
import {mountAssetInfoMenu} from "./info";

export default defineFeature({
    id: "asset-info-menu",
    category: "function",
    name: "feature.assetInfoMenu.name",
    description: "feature.assetInfoMenu.desc",
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            default: false,
        },
    ],
    mount: mountAssetInfoMenu,
});
