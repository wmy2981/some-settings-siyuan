/**
 * 界面：指向同作者另一个插件的引导行。
 *
 * 一行说明 + 一个按钮：装了目标插件就直接打开它的设置面板，没装就去集市里它的详情页。
 * 它不读写任何配置、没有任何运行期行为，所以显式声明「永不挂载」，
 * 而不是加一个点了也没用的开关（开关代表「这个功能做不做」）。
 */
import {defineFeature} from "../../core/types";
import {
    openRefCrumbs,
    refCrumbsActionLabel,
} from "./guide";

export default defineFeature({
    id: "ref-crumbs-guide",
    category: "ui",
    name: "feature.refCrumbsGuide.name",
    description: "feature.refCrumbsGuide.desc",
    isEnabled: () => false,
    settings: [
        {
            kind: "note",
            key: "notice",
            text: "refCrumbsGuide.notice",
        },
        {
            kind: "button",
            key: "open",
            title: "refCrumbsGuide.actionTitle",
            description: "refCrumbsGuide.actionTip",
            label: refCrumbsActionLabel,
            onClick: openRefCrumbs,
        },
    ],
});
