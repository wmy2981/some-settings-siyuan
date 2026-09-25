/**
 * 示例功能（分类：开发）。
 *
 * 验证「开发」分类与 action 型设置项：不放常驻 UI，只提供配置导出、
 * 注册表诊断快照和日志开关，方便开发期排查。
 *
 * 默认 state 为 0（不加载配置、前端不显示），用于验证「不动源码即可禁用」这条路径。
 */
import {defineFeature} from "../../core/types";
import {
    devHelpers,
    mountDevDemo,
} from "./dev";

export default defineFeature({
    id: "dev-demo",
    category: "dev",
    name: "feature.devDemo.name",
    description: "feature.devDemo.desc",
    settings: [
        {
            kind: "number",
            key: "logLimit",
            title: "devDemo.logLimit",
            default: 50,
            min: 1,
            max: 1000,
            step: 1,
        },
        {
            kind: "switch",
            key: "debugLog",
            title: "devDemo.debugLog",
            default: false,
        },
        {
            kind: "action",
            key: "exportAll",
            title: "dev.exportAll",
            button: "dev.exportAll",
            description: "dev.exportAllTip",
            handler: (host) => devHelpers.exportAll(host),
        },
        {
            kind: "action",
            key: "dumpRegistry",
            title: "dev.dumpRegistry",
            button: "dev.dumpRegistry",
            description: "dev.dumpRegistryTip",
            handler: (host) => devHelpers.dumpRegistry(host),
        },
    ],
    mount: mountDevDemo,
});
