/**
 * 开发：一键清除本插件写入的全部配置。
 *
 * 只有一行动作按钮：点击后确认、清除、重新载入。没有任何运行期行为，
 * 所以显式声明「永不挂载」，而不是加一个点了也没用的开关
 * （开关代表「这个功能做不做」，这里根本没有可做的事）。
 */
import {defineFeature} from "../../core/types";
import {clearAllConfigs} from "./clear";

export default defineFeature({
    id: "clear-config",
    category: "dev",
    name: "feature.clearConfig.name",
    description: "feature.clearConfig.desc",
    isEnabled: () => false,
    settings: [
        {
            kind: "button",
            key: "clear",
            title: "clearConfig.title",
            description: "clearConfig.tip",
            label: "clearConfig.action",
            onClick: clearAllConfigs,
        },
    ],
});
