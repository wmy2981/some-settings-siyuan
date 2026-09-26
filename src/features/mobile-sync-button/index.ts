/**
 * 界面：移动端右上角总是显示「立即同步」按钮。
 *
 * 移动端顶栏（`#mobileTopBar`）里本来就有同步按钮 `#toolbarSync`
 * （图标 `#iconCloudSucc`），点击会走 `syncGuide(app)` —— 也就是思源原生的
 * 同步引导。但它默认带 `fn__none`，只有当内核推过来"云同步可用且已登录"时才显示，
 * 于是没登录/云服务不可用时右上角是空的。
 *
 * 这里只做一件事：把 `fn__none` 摘掉并保持摘掉的状态。
 * 点击行为、图标语义、未登录时的提示全部沿用思源自己的逻辑，插件不复制一份。
 */
import {defineFeature} from "../../core/types";
import {mountMobileSyncButton} from "./sync";

export default defineFeature({
    id: "mobile-sync-button",
    category: "ui",
    name: "feature.mobileSyncButton.name",
    description: "feature.mobileSyncButton.desc",
    frontends: ["mobile"],
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            default: false,
        },
    ],
    mount: mountMobileSyncButton,
});
