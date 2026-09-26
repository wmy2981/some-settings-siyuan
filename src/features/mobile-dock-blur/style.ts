/**
 * 移动端悬浮 dock 栏高斯模糊的实现：一段 CSS。
 *
 * dock 栏里的每个按钮自己有 hover/active 底色，不需要跟着改，
 * 只把胶囊自身的背景变半透明即可。
 */
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

const DEFAULT_RADIUS = 14;
const DEFAULT_OPACITY = 70;

const radiusOf = (host: FeatureHost): number => {
    const value = Number(host.config.radius);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_RADIUS;
};

const opacityOf = (host: FeatureHost): number => {
    const value = Number(host.config.opacity);
    if (!Number.isFinite(value)) {
        return DEFAULT_OPACITY;
    }
    return Math.min(100, Math.max(0, value));
};

const buildCss = (radius: number, opacity: number): string =>
    `/* 移动端悬浮 dock 栏高斯模糊 */
@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    .mobile-bottom-bar {
        background-color: color-mix(in srgb, var(--b3-theme-background) ${opacity}%, transparent);
        -webkit-backdrop-filter: blur(${radius}px);
        backdrop-filter: blur(${radius}px);
    }
}
`;

export const mountMobileDockBlur = (host: FeatureHost): FeatureInstance => {
    const apply = () => {
        host.addStyle(buildCss(radiusOf(host), opacityOf(host)));
    };

    apply();
    host.onConfigChange(apply);

    return {};
};
