/**
 * 关于：本插件的说明块。
 *
 * 只有一块只读文字：讲清这个插件是什么、为什么可能不稳、当前版本，以及去哪儿反馈。
 * 没有任何可执行的东西，所以显式声明「永不挂载」，而不是加一个点了也没用的开关
 * （开关代表「这个功能做不做」，这里根本没有可做的事）。
 *
 * 版本号与仓库地址不写死在文案里：两者都取自插件清单 plugin.json，
 * 由面板按 `{version}` / `{repo}` 占位符填进 i18n 文案，避免多出一份手写副本。
 * 仓库链接显示成 `owner/repo` 的短写，地址仍是清单里那个完整地址。
 */
import manifest from "../../../plugin.json";
import {defineFeature} from "../../core/types";

/** GitHub 仓库地址的短写：`https://github.com/owner/repo` -> `owner/repo`。 */
const shortRepo = (url: string): string =>
    url.replace(/^https?:\/\/(?:www\.)?github\.com\//i, "").replace(/\.git$/i, "").replace(/\/+$/, "");

export default defineFeature({
    id: "plugin-reminder",
    category: "about",
    name: "feature.pluginReminder.name",
    description: "feature.pluginReminder.desc",
    isEnabled: () => false,
    settings: [
        {
            kind: "note",
            key: "notice",
            text: "pluginReminder.notice",
            values: {
                version: manifest.version,
                repo: manifest.url,
            },
            labels: {
                repo: shortRepo(manifest.url),
            },
        },
    ],
});
