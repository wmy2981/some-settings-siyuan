/**
 * 文档树：自动收起闲置页签。
 *
 * 集市上的同类插件（`pakeh2866/sy-plugin-tab-close`）只开关闭间隔，这里按本插件的使用场景重做：
 * 默认 5 分钟（原插件建议 30 秒，正常读一篇笔记就会被关掉）、阈值按分钟给、桌面端与移动端都管；
 * 判定不只看宿主记的「最后切到前台的时间」，还会跟着指针与键盘的落点刷新，正在写的页签不会被收；
 * 钉住的、每个分屏最后一个、标题命中保留关键字的页签都不动；界面在后台时不动作，回到前台重新计时。
 *
 * 关闭一律走宿主自己的入口，不 patch 宿主的关闭方法：桌面端点页签的关闭按钮，移动端调页签模型的关闭。
 * 判定规则在 `policy.ts`（纯函数，可单测），采集与执行在 `tabs.ts`。
 */
import {defineFeature} from "../../core/types";
import {mountTabAutoClose} from "./tabs";

export default defineFeature({
    id: "tab-auto-close",
    category: "doc-tree",
    enabled: true,
    // 页签上的 data-activetime 与移动端的页签模型都在 3.8.10 才齐活，旧版本上判定会缺一条腿
    minAppVersion: "3.8.10",
    name: "feature.tabAutoClose.title",
    description: "feature.tabAutoClose.description",
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            default: false,
        },
        {
            kind: "number",
            key: "minutes",
            title: "feature.tabAutoClose.minutes",
            description: "feature.tabAutoClose.minutesTip",
            default: 5,
            min: 1,
            max: 240,
            step: 1,
            unit: "feature.tabAutoClose.minutesUnit",
        },
        {
            kind: "text",
            key: "keepKeywords",
            title: "feature.tabAutoClose.keepKeywords",
            description: "feature.tabAutoClose.keepKeywordsTip",
            placeholder: "feature.tabAutoClose.keepKeywordsPlaceholder",
            default: "",
        },
        {
            kind: "select",
            key: "notify",
            title: "feature.tabAutoClose.notify",
            description: "feature.tabAutoClose.notifyTip",
            default: "off",
            options: [
                {value: "off", label: "feature.tabAutoClose.notify.off"},
                {value: "on", label: "feature.tabAutoClose.notify.on"},
            ],
        },
    ],
    mount: mountTabAutoClose,
});
