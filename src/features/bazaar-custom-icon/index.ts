/**
 * 功能：给「集市 → 已下载」里的集市包换一张自己的图标。
 *
 * 图标属于用户自己的客户端：文件存在本插件的存储目录（`icons/`）里，跟着思源同步，
 * 集市包目录与别人的显示都不受影响。管理入口是一行动作按钮，打开的窗口里按
 * 作者/包名选择图片或粘贴 base64；保存图标会自动打开本功能（默认关闭），
 * 之后的开关只控制「要不要把图标贴回集市列表」。
 */
import {defineFeature} from "../../core/types";
import {mountBazaarCustomIcon} from "./apply";
import {openIconManager} from "./manager";

export default defineFeature({
    id: "bazaar-custom-icon",
    category: "function",
    name: "feature.bazaarCustomIcon.name",
    description: "feature.bazaarCustomIcon.desc",
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            default: false,
        },
        {
            kind: "button",
            key: "manage",
            title: "bazaarIcon.manageTitle",
            description: "bazaarIcon.manageDesc",
            label: "bazaarIcon.manageAction",
            onClick: (context) => {
                openIconManager({
                    pluginName: context.pluginName,
                    i18n: context.i18n,
                    onUnload: context.onUnload,
                    isEnabled: () => context.configOf(context.featureId).enabled === true,
                    enable: () => context.updateConfig(context.featureId, {enabled: true}),
                });
            },
        },
        {
            kind: "note",
            key: "notice",
            text: "bazaarIcon.notice",
        },
    ],
    mount: mountBazaarCustomIcon,
});
