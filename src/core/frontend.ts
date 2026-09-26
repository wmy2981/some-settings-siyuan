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
 * 该功能是否适用于当前前端。
 * 没声明 frontends 的功能两端都适用。
 */
export const supportsCurrentFrontend = (definition: FeatureDefinition): boolean => {
    if (!definition.frontends || definition.frontends.length === 0) {
        return true;
    }
    return definition.frontends.includes(currentFrontend());
};
