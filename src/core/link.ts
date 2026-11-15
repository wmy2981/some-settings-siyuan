/**
 * 打开 web 外链。
 *
 * 思源把「跳转前可否决」做成了插件事件：内核的 `openLink` 在真正交给浏览器之前会
 * `emit("open-link", …)`，任一插件 `preventDefault()` 就取消本次跳转 —— 本插件的
 * 「外链跳转前确认」正是这样拦下来的。
 *
 * 面板自己画出来的入口（说明块里的链接、动作行里的按钮）走不到内核那条路，
 * 所以按同样的顺序补问一次；没人拦下时才用思源重写过的 `window.open`
 * （桌面端交给系统浏览器，移动端交给原生桥）。
 *
 * `event` 是触发本次跳转的原始事件：插件可以靠它找回链接元素、在用户确认后补发一次点击。
 * 按钮这类没有链接元素的入口可以不传。
 */

import {reportError} from "./error";

export const openExternalLink = (href: string, event?: MouseEvent): void => {
    const detail = {href, originalHref: href, event};
    for (const plugin of window.siyuan?.ws?.app?.plugins ?? []) {
        if (plugin.eventBus?.emit("open-link", detail) === false) {
            return;
        }
    }
    try {
        window.open(href, "_blank");
    } catch (error) {
        // 弹窗被拦截、宿主没提供 window.open 时只记录，不弹提示：改动前的行为是
        // 「点了没反应 + 控制台一条未捕获异常」，用户看不到任何信息；这里保持一样的结果，
        // 但不再让异常冒到事件循环里把后面的处理器一起打断。
        reportError("core.link", error, false);
    }
};
