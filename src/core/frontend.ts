/**
 * 前端判别。
 *
 * 插件里到处都要回答「现在是桌面端还是移动端」，但 `getFrontend()` 会返回四个值
 * （desktop / desktop-window / mobile / browser-mobile），每处各写一遍判断迟早会漏。
 * 这里收敛成一个二元结论，并把它带来的两个后果（面板要不要显示、功能要不要挂载）
 * 一并放在同一个文件里，避免两处判定不一致导致「显示了但没挂载」。
 */
import {getFrontend} from "siyuan";
import type {
    FeatureDefinition,
    FeatureFrontend,
} from "./types";

/** 当前前端，只区分桌面端与移动端。 */
export const currentFrontend = (): FeatureFrontend => {
    const frontend = getFrontend();
    return frontend === "mobile" || frontend === "browser-mobile" ? "mobile" : "desktop";
};

export const isMobile = (): boolean => currentFrontend() === "mobile";

/**
 * 移动端打开宿主浮层期间，临时禁止程序性聚焦可输入控件。
 *
 * 宿主的 `Setting.open()` 会把焦点交给正文里的第一个 `input` / `textarea`（挂载前由
 * `dialog.bindInput()` 放一次，挂载后再放一次）。移动端 WebView 一拿到焦点就顶起软键盘、
 * 压缩可视视口，浮层跟着重排 —— 这是「打开设置面板时键盘弹起 / 界面抖动」的来源。
 *
 * 只在本插件自己的**同步**打开流程内接管 `HTMLElement.prototype.focus`，`finally` 立刻还原：
 * - 只挡 `input` / `textarea`，容器等非输入控件的聚焦照常放行（宿主靠它把焦点收进对话框）；
 * - 只包住 `open()` 那一次调用，用户随后点输入框仍然能正常编辑、正常弹键盘；
 * - 桌面端直接执行，不碰宿主行为。
 */
export const withoutMobileInputFocus = <T>(run: () => T): T => {
    if (!isMobile()) {
        return run();
    }
    const originalFocus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function(this: HTMLElement, options?: FocusOptions): void {
        if (this instanceof HTMLInputElement || this instanceof HTMLTextAreaElement) {
            return;
        }
        originalFocus.call(this, options);
    };
    try {
        return run();
    } finally {
        HTMLElement.prototype.focus = originalFocus;
    }
};

/**
 * 该功能是否适用于当前前端。
 *
 * 不写 `frontends` 表示两端都适用；显式写空数组表示**两端都不适用**（用户级补丁用它把功能
 * 彻底关掉，见 `core/patch.ts`），所以这里不能把空数组当成「不写」——两者含义正好相反。
 */
export const supportsCurrentFrontend = (definition: FeatureDefinition): boolean => {
    if (!definition.frontends) {
        return true;
    }
    return definition.frontends.includes(currentFrontend());
};
