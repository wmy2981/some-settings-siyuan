/**
 * 详细日志输出。
 *
 * 插件默认不在控制台留任何噪声，只输出一行加载提示；排查问题时到「插件自身」页签打开，
 * 之后 core 与每个功能的详细日志都会打到控制台（INFO / WARN / ERROR），
 * 每条都带 `[some-settings-siyuan__<功能 id>]` 头部。
 *
 * 开关就是功能自己的 `enabled`：挂载即打开、卸载即关闭，所以它和面板上的开关
 * 完全同步，不需要第二份状态。详细文案一律英文，不维护两套语言。
 */
import {setDetailedLogging} from "../../core/log";
import {defineFeature} from "../../core/types";

export default defineFeature({
    id: "log-output",
    category: "plugin",
    enabled: true,
    name: "feature.logOutput.title",
    description: "feature.logOutput.description",
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            description: "feature.logOutput.enabledTip",
            default: false,
        },
    ],
    mount: (host) => {
        setDetailedLogging(true);
        host.log.info("detailed logging enabled");
        return {
            destroy: () => {
                // 这一条要在关掉开关之前打，否则它自己也会被关掉
                host.log.info("detailed logging disabled");
                setDetailedLogging(false);
            },
        };
    },
});
