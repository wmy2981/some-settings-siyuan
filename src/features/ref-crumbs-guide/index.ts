/**
 * 编辑器：指向同作者另一个插件的引导行（已退出）。
 *
 * 一行说明 + 一个按钮：装了目标插件就直接打开它的设置面板，没装就去集市里它的详情页。
 * 它不读写任何配置、没有任何运行期行为，所以显式声明「永不挂载」，
 * 而不是加一个点了也没用的开关（开关代表「这个功能做不做」）。
 *
 * 整条现在收回：`enabled: false` 之后它不加载、不进面板、不挂载，只有在「插件自身」页签
 * 打开「显示不可用的设置」时才以「已被开发者禁用」灰显。要重新交出，把这一行改回 true 即可。
 */
import {defineFeature} from "../../core/types";
import {
    openRefCrumbs,
    refCrumbsActionLabel,
} from "./guide";

export default defineFeature({
    id: "ref-crumbs-guide",
    category: "editor",
    enabled: false,
    name: "feature.refCrumbsGuide.title",
    description: "feature.refCrumbsGuide.description",
    isEnabled: () => false,
    settings: [
        {
            kind: "note",
            key: "notice",
            text: "feature.refCrumbsGuide.notice",
        },
        {
            kind: "button",
            key: "open",
            title: "feature.refCrumbsGuide.actionTitle",
            description: "feature.refCrumbsGuide.actionTip",
            label: refCrumbsActionLabel,
            onClick: openRefCrumbs,
        },
    ],
});
