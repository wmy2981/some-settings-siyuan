/**
 * 功能：引用的资源文件在右键 / 长按菜单里显示文件大小与简单元数据。
 *
 * 图片走图片自己的右键（移动端是长按）菜单，音频 / 视频 / iframe 这类资源块走块标菜单。
 * 思源只允许插件把菜单项挂在「插件」子菜单里，所以这几行只读信息在那里。
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
