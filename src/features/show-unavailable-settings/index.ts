/**
 * 显示不可用的设置。
 *
 * 设置面板默认只显示当前宿主上真正可用的功能。打开这个开关后，每个页签底部会把因
 * 开发者禁用、平台不符或思源版本区间不符而不可用的功能灰显出来并注明原因，
 * 搜索结果末尾也会单独分出一个「不可用」分组。
 *
 * 它没有自己的界面逻辑：开关就是功能自己的 `enabled`，挂载即打开、卸载即关闭，
 * 设置面板读 `core/availability.ts` 里的那个标记 —— 与「详细日志输出」同一套做法。
 */
import {setShowUnavailable} from "../../core/availability";
import {defineFeature} from "../../core/types";

export default defineFeature({
    id: "show-unavailable-settings",
    category: "plugin",
    enabled: true,
    name: "feature.showUnavailableSettings.title",
    description: "feature.showUnavailableSettings.description",
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            description: "feature.showUnavailableSettings.enabledTip",
            default: false,
        },
    ],
    mount: (host) => {
        setShowUnavailable(true);
        host.log.info("unavailable settings are shown in the panel");
        return {
            destroy: () => {
                setShowUnavailable(false);
                host.log.info("unavailable settings are hidden in the panel");
            },
        };
    },
});
