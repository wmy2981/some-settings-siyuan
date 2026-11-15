/**
 * 关于：本插件的说明块。
 *
 * 一块只读文字，外加它右侧的两颗按钮（去 GitHub 点星、给插件开发者捐赠；窄屏落在文字下面）：
 * 文字讲清这个插件是什么、为什么可能不稳、当前版本，以及去哪儿反馈。
 * 两者都只是打开一个网页，不读写配置、没有运行期行为，所以显式声明「永不挂载」，
 * 而不是加一个点了也没用的开关（开关代表「这个功能做不做」，这里根本没有可做的事）。
 *
 * 版本号与仓库地址不写死在文案里：两者都取自插件清单 plugin.json，
 * 由面板按 `{version}` / `{repo}` 占位符填进 i18n 文案，避免多出一份手写副本。
 * 仓库链接显示成 `owner/repo` 的短写，地址仍是清单里那个完整地址。
 */
import manifest from "../../../plugin.json";
import {defineFeature} from "../../core/types";
import {
    DONATE_ICON,
    hasDonateUrl,
    openDonate,
    openRepository,
} from "./links";

/** GitHub 仓库地址的短写：`https://github.com/owner/repo` -> `owner/repo`。 */
const shortRepo = (url: string): string =>
    url.replace(/^https?:\/\/(?:www\.)?github\.com\//i, "").replace(/\.git$/i, "").replace(/\/+$/, "");

export default defineFeature({
    id: "plugin-reminder",
    category: "plugin",
    enabled: true,
    name: "feature.pluginReminder.title",
    description: "feature.pluginReminder.description",
    isEnabled: () => false,
    settings: [
        {
            kind: "note",
            key: "notice",
            text: "feature.pluginReminder.notice",
            values: {
                version: manifest.version,
                repo: manifest.url,
            },
            labels: {
                repo: shortRepo(manifest.url),
            },
            // 两颗按钮挂在说明块上：桌面端排在文字右侧（与「导出配置」那些按钮同一列），
            // 上面去 GitHub 点星，下面给插件开发者捐赠；窄屏才落到文字下面、各占整行。
            // 两者都形制照思源「关于」页那颗捐赠按钮，只是底色一个取主题色、一个是那颗粉。
            actions: [
                {
                    key: "star",
                    label: "feature.pluginReminder.starAction",
                    appearance: "block" as const,
                    tone: "primary" as const,
                    icon: "iconGithub",
                    onClick: openRepository,
                },
                // 资助链接只从插件清单取；清单里没写时这颗按钮不出现
                ...(hasDonateUrl() ?
                    [{
                        key: "donate",
                        label: "feature.pluginReminder.donateAction",
                        appearance: "block" as const,
                        tone: "pink" as const,
                        // 官方那张图：思源「关于」页捐赠按钮用的同一张
                        iconSvg: DONATE_ICON,
                        onClick: openDonate,
                    }] :
                    []),
            ],
        },
    ],
});
