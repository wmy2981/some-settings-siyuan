/**
 * 界面：集市详情页的版本号可以点开看发行说明。
 *
 * 集市里「在线集市 - 版本」那一行只给一个版本号，作者在这个版本里改了什么得自己跑去 GitHub 看，
 * 国内还常常打不开。这个功能把版本号变成链接，点开就是那个版本的发行说明（思源原生渲染
 * Markdown），顶部还能切换历史版本。
 */
import {defineFeature} from "../../core/types";
import {mountBazaarReleaseNotes} from "./notes";

export default defineFeature({
    id: "bazaar-release-notes",
    category: "ui",
    name: "feature.bazaarReleaseNotes.name",
    description: "feature.bazaarReleaseNotes.desc",
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            default: false,
        },
    ],
    mount: mountBazaarReleaseNotes,
});
