/**
 * 统一错误上报。
 *
 * 原则（可回退）：任何功能的异常都不允许冒泡到插件入口，
 * 更不允许让插件整体崩溃。这里提供最小的记录与提示能力。
 *
 * 记录走 `core/log.ts` 的分级日志：作用域就是出错的位置（`<功能 id>.<动作>`），
 * 这样打开详细日志后每条错误都带 `[some-settings-siyuan__<作用域>]` 头部；
 * 详细日志关着时控制台保持安静，但**给用户的提示照旧弹出** —— 提示是功能的一部分，
 * 不属于「详细日志」。
 */
import {showMessage} from "siyuan";
import {
    LOG_PREFIX,
    logError,
} from "./log";

/** 记录错误并尽力给用户一个可见提示；提示本身失败也不再抛。 */
export const reportError = (scope: string, error: unknown, notifyUser = true): void => {
    logError(scope, error);
    if (!notifyUser) {
        return;
    }
    const message = error instanceof Error ? error.message : String(error);
    try {
        showMessage(`[${LOG_PREFIX}] [${scope}] ${message}`, 6000, "error");
    } catch {
        // 提示失败无需处理
    }
};

/** 同步调用并隔离异常：返回是否成功。 */
export const guard = (scope: string, action: () => void, notifyUser = true): boolean => {
    try {
        action();
        return true;
    } catch (error) {
        reportError(scope, error, notifyUser);
        return false;
    }
};

/** 异步调用并隔离异常。 */
export const guardAsync = async (scope: string, action: () => Promise<void>, notifyUser = true): Promise<void> => {
    try {
        await action();
    } catch (error) {
        reportError(scope, error, notifyUser);
    }
};

/** 清理阶段专用：只记录，绝不提示、绝不抛出。 */
export const guardSilent = (scope: string, action: () => void): void => {
    try {
        action();
    } catch (error) {
        logError(scope, "cleanup failed", error);
    }
};
