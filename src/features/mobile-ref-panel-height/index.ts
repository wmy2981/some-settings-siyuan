/**
 * 界面：增大移动端引用搜索面板的高度。
 *
 * 面板本体是每个 Protyle 上的 `.protyle-hint`。移动端的高度不是 CSS 决定的，
 * 而是 `Hint.setMobilePosition()` 算完之后写成的**内联** `max-height`
 * （`(视口高 / 3)`），CSS 里那条 `max-height` 基本不起作用。
 *
 * 所以这里在内联值被写入之后再放宽它：目标高度按设置里的视口百分比算，
 * 并且永远不会超过该面板当前位置到可视区底部之间的空间，
 * 保证不会把面板推出屏幕（软键盘或键盘工具栏弹起时按 `visualViewport` 算）。
 */
import {defineFeature} from "../../core/types";
import {mountRefPanelHeight} from "./height";

export default defineFeature({
    id: "mobile-ref-panel-height",
    category: "ui",
    name: "feature.mobileRefPanelHeight.name",
    description: "feature.mobileRefPanelHeight.desc",
    frontends: ["mobile"],
    settings: [
        {
            kind: "number",
            key: "maxHeight",
            title: "mobileRefPanelHeight.maxHeight",
            description: "mobileRefPanelHeight.maxHeightTip",
            default: 60,
            min: 20,
            max: 100,
            step: 5,
            unit: "vh",
        },
    ],
    mount: mountRefPanelHeight,
});
