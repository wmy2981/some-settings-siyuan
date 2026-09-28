/**
 * 开发：本插件全部配置的导入导出。
 *
 * 两行动作按钮：导出把每个功能的当前配置打成一个 JSON 文档，导入把一段 JSON 写回
 * 同一批配置文件。读写都走 `ConfigStore`，所以导入的校验与「保存」完全一致。
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
    category: "dev",
    name: "feature.configTransfer.name",
    description: "feature.configTransfer.desc",
    isEnabled: () => false,
    settings: [
        {
            kind: "button",
            key: "export",
            title: "configTransfer.exportTitle",
            description: "configTransfer.exportTip",
            label: "configTransfer.exportAction",
            onClick: exportConfigs,
        },
        {
            kind: "button",
            key: "import",
            title: "configTransfer.importTitle",
            description: "configTransfer.importTip",
            label: "configTransfer.importAction",
            onClick: importConfigs,
        },
    ],
});
