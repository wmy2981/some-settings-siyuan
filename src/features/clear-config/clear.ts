/**
 * 「清除本插件配置」动作行的实现。
 *
 * 清除本身由 core 完成（ConfigStore.clearAll：列出存储目录下的每一个配置文件、
 * 逐个删除、回落默认值、通知各功能），这里只负责问一句、调一次，然后重新载入前端。
 *
 * 清的是目录里的文件，不是代码里注册的功能：当前客户端不加载的功能、已经退役的、
 * 甚至已经从插件里删掉的功能留下的配置文件同样会被清掉，这与四态无关。
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

/**
 * 宿主的 `confirm` 在第 5 个参数上支持「删除型」按钮（红色线框 + 原生删除文案），
 * 但 `siyuan` 包只声明了前 4 个参数。这里按运行期真实签名补一个窄类型，
 * 不改全局声明，也不用 any。
 */
const confirmDelete = confirm as unknown as (
    title: string,
    text: string,
    confirmCallback?: () => void,
    cancelCallback?: () => void,
    isDelete?: boolean,
) => void;

/**
 * 取消删除型确认按钮「聚焦、但指针不在它上面」时的填充底色。
 *
 * `b3-button--remove` 只在 `:hover` / `:focus` 下填浅红底色，而 `confirm` 一打开就把焦点
 * 放在确认按钮上 —— 红色线框于是看起来像一颗实心红按钮。这里只覆盖这一种状态：
 * 悬停与按下仍旧走内核原本的样式，删除按钮该有的反馈一个都不少。
 *
 * 弹窗是宿主创建的，事先没有给它加类名的机会，所以把这段规则作为 `<style>` 塞进这个弹窗
 * 元素里：弹窗销毁时规则跟着一起消失，不会影响别的确认框。用最后一个匹配：弹窗可以叠加，
 * 最后进 DOM 的那个才是这次 `confirm` 创建的。
 */
const flattenFocusedRemoveButton = (): void => {
    const dialogs = document.querySelectorAll<HTMLElement>('[data-key="dialog-confirm"]');
    const scope = dialogs[dialogs.length - 1];
    if (!scope) {
        return;
    }
    const style = document.createElement("style");
    style.textContent = "#confirmDialogConfirmBtn:focus:not(:hover):not(:active) { background-color: transparent; }";
    scope.append(style);
};

export const clearAllConfigs = (context: FeatureActionContext): void => {
    // 清除配置是破坏性操作：确认按钮用思源自己的删除按钮（b3-button--remove），
    // 而不是默认的蓝色文字按钮。第 5 个参数为 true 时内核还会把文案换成「删除」。
    confirmDelete(
        context.i18n("clearConfig.confirmTitle"),
        context.i18n("clearConfig.confirmText"),
        () => {
            context.clearAllConfigs().then(() => {
                showMessage(context.i18n("clearConfig.done"), 3000);
                window.setTimeout(() => window.location.reload(), RELOAD_DELAY_MS);
            }).catch((error: unknown) => {
                // 有的文件删不掉时不能装作清干净了：重新载入会把没删掉的那份又读回来
                reportError("clear-config.clear", error);
            });
        },
        undefined,
        true,
    );
    // confirm 是同步创建并聚焦的，这一行一定作用在刚打开的那个弹窗上
    flattenFocusedRemoveButton();
};
