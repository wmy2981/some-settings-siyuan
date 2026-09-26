/**
 * 界面：modal 高斯模糊。
 *
 * 思源的弹窗遮罩 `.b3-dialog__scrim` 本身就是半透明的
 * （`--b3-mask-background` 为 `rgba(220,220,220,.4)` / `rgba(10,10,10,.4)`），
 * 在遮罩上加 `backdrop-filter` 就能把被遮住的编辑区虚化，
 * 而遮罩内的弹窗内容不属于"背景"，始终保持清晰。
 *
 * 例外：内核会把非模态浮层（emoji / 图标选择面板、发布权限浮层）的遮罩写成
 * 内联的透明底色 —— 那种遮罩只是用来接"点外面关掉"的，糊上去等于把背后的
 * 正文整片糊掉，所以按 `[style*="transparent"]` 排除掉。
 * 图标选择面板在移动端是底部弹层、遮罩并不透明，所以另外按它自己的
 * `data-key="dialog-emojis"` 排除一次。
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
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            default: false,
        },
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
