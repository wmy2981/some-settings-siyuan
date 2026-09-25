/**
 * 示例功能（分类：开发）。
 *
 * 验证「开发」分类：不放任何常驻 UI，只有日志相关的设置项，
 * 每次配置变更打印一次注册表快照，方便开发期排查。
 *
 * 默认 state 为 0（不加载配置、前端不显示），用于验证「不动源码即可禁用」这条路径。
 */
import {defineFeature} from "../../core/types";
import {mountDevDemo} from "./dev";

export default defineFeature({
    id: "dev-demo",
    category: "dev",
    name: "feature.devDemo.name",
    description: "feature.devDemo.desc",
    settings: [
        {
            kind: "switch",
            key: "debugLog",
            title: "devDemo.debugLog",
            description: "dev.debugLogTip",
            default: false,
        },
        {
            kind: "number",
            key: "logLimit",
            title: "devDemo.logLimit",
            description: "dev.logLimitTip",
            default: 50,
            min: 1,
            max: 1000,
            step: 1,
        },
    ],
    mount: mountDevDemo,
});
