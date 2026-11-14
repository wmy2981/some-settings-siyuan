/**
 * 关于：本插件全部配置的导入导出。
 *
 * 两行动作按钮：导出把存储目录下每一个配置文件的当前内容打成一个 JSON 文档，
 * 导入把一段 JSON 写回各自的配置文件。读写都走 `ConfigStore`，
 * 所以导入的校验与设置面板改完即写走的是同一条路。
 *
 * 它没有任何运行期行为，也没有可持久化的取值，所以显式声明「永不挂载」，
 * 而不是加一个点了也没用的开关（开关代表「这个功能做不做」）。
 */
import {defineFeature} from "../../core/types";
import {
    exportConfigs,
    importConfigs,
} from "./transfer";

export default defineFeature({
    id: "config-transfer",
    category: "plugin",
    enabled: true,
    name: "feature.configTransfer.title",
    description: "feature.configTransfer.description",
    isEnabled: () => false,
    settings: [
        {
            kind: "button",
            key: "export",
            title: "feature.configTransfer.exportTitle",
            description: "feature.configTransfer.exportTip",
            label: "feature.configTransfer.exportAction",
            onClick: exportConfigs,
        },
        {
            kind: "button",
            key: "import",
            title: "feature.configTransfer.importTitle",
            description: "feature.configTransfer.importTip",
            label: "feature.configTransfer.importAction",
            onClick: importConfigs,
        },
    ],
});
