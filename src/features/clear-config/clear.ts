/**
 * 「清除本插件配置」动作行的实现。
 *
 * 清除本身由 core 完成（ConfigStore.clearAll：逐个删除配置文件、回落默认值、通知各功能），
 * 这里只负责问一句、调一次，然后重新载入前端。
 *
 * 为什么必须重新载入：设置面板此刻还开着，它手里那份草稿是清除之前的值；
 * 用户只要再点一次「保存」，刚删掉的文件就会被原样写回来。重新载入是能同时
 * 收掉面板草稿、又让插件按默认配置重新装载的唯一可靠做法。
 */
import {
    confirm,
    showMessage,
} from "siyuan";
import {reportError} from "../../core/error";
import type {FeatureActionContext} from "../../core/types";

/** 重新载入前的等待：让「已清除」的提示先显示出来，用户能确认这一步做完了。 */
const RELOAD_DELAY_MS = 600;

export const clearAllConfigs = (context: FeatureActionContext): void => {
    const count = context.featureIds.length;
    confirm(
        context.i18n("clearConfig.confirmTitle"),
        context.i18n("clearConfig.confirmText").replace("${count}", String(count)),
        () => {
            context.clearAllConfigs().then(() => {
                showMessage(context.i18n("clearConfig.done"), 3000);
                window.setTimeout(() => window.location.reload(), RELOAD_DELAY_MS);
            }).catch((error: unknown) => {
                // 有的文件删不掉时不能装作清干净了：重新载入会把没删掉的那份又读回来
                reportError("clear-config.clear", error);
            });
        },
    );
};
