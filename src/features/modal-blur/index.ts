/**
 * 界面：modal 高斯模糊。
 *
 * 思源的弹窗遮罩 `.b3-dialog__scrim` 本身就是半透明的
 * （`--b3-mask-background` 为 `rgba(220,220,220,.4)` / `rgba(10,10,10,.4)`），
 * 在遮罩上加 `backdrop-filter` 就能把被遮住的编辑区虚化，
 * 而遮罩内的弹窗内容不属于"背景"，始终保持清晰。
 *
 * 只注册一段 CSS，不改动任何核心 DOM。
 */
import {defineFeature} from "../../core/types";
import {mountModalBlur} from "./style";

export default defineFeature({
    id: "modal-blur",
    category: "ui",
    name: "feature.modalBlur.name",
    description: "feature.modalBlur.desc",
    settings: [
        {
            kind: "number",
            key: "radius",
            title: "modalBlur.radius",
            default: 10,
            min: 1,
            max: 40,
            step: 1,
            unit: "px",
        },
    ],
    mount: mountModalBlur,
});
