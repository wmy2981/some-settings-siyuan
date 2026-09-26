/**
 * 功能：移动端通过 `/` 直接调出桌面端那套「插入块」面板。
 *
 * 思源在移动端默认把 `/` 面板换成键盘工具栏里的另一套候选（`.keyboard__slash-*`），
 * 桌面端那套（`.protyle-hint` + `b3-list-item--two`）只在一个前端偏好打开时才用：
 * `window.siyuan.storage["local-mobile-slash-menu"].enabled === true`
 * （对应「设置 - 编辑器 - 移动端斜杠菜单」那个开关）。
 *
 * 所以这个功能不做任何界面改造，只把这个偏好打开并保持打开，让内核自己走桌面那条分支。
 * 关闭功能时把偏好恢复成原来的值。
 */
import {defineFeature} from "../../core/types";
import {mountMobileSlashPanel} from "./slash";

export default defineFeature({
    id: "mobile-slash-insert-panel",
    category: "function",
    name: "feature.mobileSlashPanel.name",
    description: "feature.mobileSlashPanel.desc",
    frontends: ["mobile"],
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            default: false,
        },
    ],
    mount: mountMobileSlashPanel,
});
