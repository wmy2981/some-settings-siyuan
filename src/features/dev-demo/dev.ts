/**
 * 示例功能的实现（分类：开发）。
 *
 * 不放常驻 UI：只提供两个 action 型设置项（导出全部配置、打印注册表快照）
 * 和一个日志开关，用来演示开发类功能的写法。
 *
 * 读取全部功能配置时直接走 plugin.loadData（官方 API），
 * 不引入 fs / Node API，也不与其它功能模块产生耦合。
 */
import {
    saveExportFile,
    showMessage,
} from "siyuan";
import {storageNameOf} from "../../core/config";
import {reportError} from "../../core/error";
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

const readAllConfig = async (host: FeatureHost): Promise<Record<string, unknown>> => {
    const result: Record<string, unknown> = {};
    for (const feature of FEATURES) {
        try {
            const stored = await host.plugin.loadData(storageNameOf(feature.id));
            result[feature.id] = typeof stored === "object" && stored !== null ? stored : null;
        } catch (error) {
            // 单个文件读失败不影响整体导出
            result[feature.id] = {error: error instanceof Error ? error.message : String(error)};
            host.log(`读取 ${storageNameOf(feature.id)} 失败`, error);
        }
    }
    return result;
};

const exportAll = async (host: FeatureHost): Promise<void> => {
    const payload = {
        plugin: host.plugin.name,
        exportedAt: new Date().toISOString(),
        features: await readAllConfig(host),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], {type: "application/json"}));
    try {
        await saveExportFile(url);
        showMessage(host.i18n("dev.saved"), 4000);
    } catch (error) {
        reportError(`${host.id}.exportAll`, error);
        showMessage(host.i18n("dev.exportFailed"), 4000, "error");
    } finally {
        URL.revokeObjectURL(url);
    }
};

const dumpRegistry = async (host: FeatureHost): Promise<void> => {
    const rows = FEATURES.slice(0, logLimitOf(host)).map((feature) => ({
        id: feature.id,
        category: feature.category,
        configKey: storageNameOf(feature.id),
        settings: feature.settings.length,
    }));
    host.log("注册表快照", rows);
    const stored = await readAllConfig(host);
    host.log("磁盘上的配置", stored);
    host.log(`debugLog=${debugEnabled(host)} logLimit=${logLimitOf(host)}`);
    showMessage(host.i18n("dev.dumped"), 4000);
};

export const devHelpers = {exportAll, dumpRegistry};

export const mountDevDemo = (host: FeatureHost): FeatureInstance => {
    if (debugEnabled(host)) {
        host.log("开发示例已挂载（debugLog 打开）");
    }
    return {};
};
