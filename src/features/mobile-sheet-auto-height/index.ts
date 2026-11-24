/**
 * 界面：移动端底部抽屉的高度按内容自适应。
 *
 * 宿主的 `bindMobileSheetLayout()` 会把面板高度定成「半屏（拖到全屏后是整屏）」，
 * 短内容的抽屉也被撑到半个屏幕，操作区上方留一大片空白。3.8.11 及以前是内容多高
 * 抽屉就多高，只受「完整视口高的 56%」封顶；这里把那套高度算法恢复回来。
 */
import {defineFeature} from "../../core/types";
import {mountMobileSheetAutoHeight} from "./height";

export default defineFeature({
    id: "mobile-sheet-auto-height",
    category: "appearance",
    enabled: true,
    name: "feature.mobileSheetAutoHeight.title",
    description: "feature.mobileSheetAutoHeight.description",
    frontends: ["mobile"],
    minAppVersion: "3.8.12-alpha.2",
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            default: false,
        },
    ],
    mount: mountMobileSheetAutoHeight,
});
