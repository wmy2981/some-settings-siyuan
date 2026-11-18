/**
 * 设置面板搜索。
 *
 * 设置面板顶部那个搜索框（桌面端在内容区顶部、移动端在标题下方）可以关掉：
 * 开关就是功能自己的 `enabled`，挂载即打开、卸载即关闭，面板读 `core/search.ts`
 * 里的那个标记 —— 与「显示不可用的设置」「详细日志输出」同一套做法。
 *
 * 默认开启：搜索在加这个开关之前一直存在，升级后不能让用户突然找不到它。
 * 关掉后搜索框整块收起，`Ctrl/Cmd + F` 与 `/` 也不再由面板接管。
 */
import {setSearchEnabled} from "../../core/search";
import {defineFeature} from "../../core/types";

export default defineFeature({
    id: "settings-search",
    category: "plugin",
    enabled: true,
    defaultOn: true,
    name: "feature.settingsSearch.title",
    description: "feature.settingsSearch.description",
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            description: "feature.settingsSearch.enabledTip",
            default: true,
        },
    ],
    mount: (host) => {
        setSearchEnabled(true);
        host.log.info("settings panel search enabled");
        return {
            destroy: () => {
                setSearchEnabled(false);
                host.log.info("settings panel search disabled");
            },
        };
    },
});
