/**
 * 界面：移动端滚动文档时标题栏与悬浮 dock 栏的动画优化。
 *
 * 思源自己的滚动显隐是"跟手"的：`mobileBars.ts` 在每个 rAF 里把
 * `--mobile-bar-translate-y` / `--mobile-bar-opacity` 写成滚动进度的百分比，
 * 于是快速滑动时栏体停在半路，看起来就是"只显示一部分"。
 *
 * 这里不改它的计算逻辑，只给栏体加一条 transform/opacity 过渡：
 * 进度值仍然是连续变化的，但渲染层会平滑地追上去，快速滑动时不再出现
 * 半个栏体挂在屏幕边缘的画面；停下后依然精确对齐。
 *
 * 时长刻意压在 200ms 上下，保证"现代"但不拖手。
 */
import {defineFeature} from "../../core/types";
import {mountMobileBarAnimation} from "./style";

export default defineFeature({
    id: "mobile-bar-animation",
    category: "ui",
    name: "feature.mobileBarAnimation.name",
    description: "feature.mobileBarAnimation.desc",
    frontends: ["mobile"],
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            default: false,
        },
        {
            kind: "number",
            key: "duration",
            title: "mobileBarAnimation.duration",
            default: 200,
            min: 0,
            max: 600,
            step: 20,
            unit: "ms",
        },
        {
            kind: "select",
            key: "easing",
            title: "mobileBarAnimation.easing",
            default: "emphasized",
            options: [
                {value: "emphasized", label: "mobileBarAnimation.easingEmphasized"},
                {value: "standard", label: "mobileBarAnimation.easingStandard"},
                {value: "linear", label: "mobileBarAnimation.easingLinear"},
            ],
        },
    ],
    mount: mountMobileBarAnimation,
});
