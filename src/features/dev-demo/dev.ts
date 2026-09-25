/**
 * 示例功能的实现（分类：开发）。
 *
 * 不放常驻 UI：只有日志开关，以及每次配置变更后打印一次注册表快照。
 * 顺带说明「面板保存后功能才看到新配置」这条时间线。
 *
 * 读取配置一律走 host / plugin 的官方 API，不引入 fs 或任何 Node API。
 */
import {storageNameOf} from "../../core/config";
import {FEATURES} from "../../core/registry";
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

const debugEnabled = (host: FeatureHost): boolean => host.config.debugLog === true;

const logLimitOf = (host: FeatureHost): number => {
    const value = Number(host.config.logLimit);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 50;
};

/** 打印注册表快照；条数受 logLimit 限制。 */
const dumpRegistry = (host: FeatureHost): void => {
    const limit = logLimitOf(host);
    const rows = FEATURES.slice(0, limit).map((feature) => ({
        id: feature.id,
        category: feature.category,
        configKey: storageNameOf(feature.id),
        settings: feature.settings.length,
    }));
    host.log(`注册表快照（${rows.length}/${FEATURES.length}，上限 ${limit}）`, rows);
    host.log("本次生效的配置", {...host.config});
};

export const mountDevDemo = (host: FeatureHost): FeatureInstance => {
    if (debugEnabled(host)) {
        dumpRegistry(host);
    }
    // 只在面板保存后触发：用来确认配置真的写进了内存与磁盘
    host.onConfigChange(() => {
        if (debugEnabled(host)) {
            dumpRegistry(host);
            return;
        }
        host.log(`配置已更新；debugLog=false 跳过快照（logLimit=${logLimitOf(host)}）`);
    });

    return {};
};
