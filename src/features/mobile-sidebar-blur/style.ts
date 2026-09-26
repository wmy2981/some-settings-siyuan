/**
 * 移动端侧面板高斯模糊的实现：一段 CSS，作用域限定在 `#sidebar` / `#sidebarRight`。
 *
 * 透明度用 `color-mix()` 从思源自己的 `--b3-theme-surface` 推导，
 * 这样白天/夜间主题与第三方主题都能跟着走，插件不写死任何色值。
 * `color-mix()` 不被支持时整段 `@supports` 不生效，面板回到原样，不会坏。
 */
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

const DEFAULT_RADIUS = 14;
const DEFAULT_OPACITY = 72;

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

const buildCss = (radius: number, opacity: number): string => `/* 移动端侧面板高斯模糊 */
@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    #sidebar,
    #sidebarRight {
        background-color: color-mix(in srgb, var(--b3-theme-surface) ${opacity}%, transparent);
        -webkit-backdrop-filter: blur(${radius}px);
        backdrop-filter: blur(${radius}px);
    }

    /* 面板自己的工具栏与列表底色会挡住模糊，一并透明 */
    #sidebar > .toolbar,
    #sidebarRight > .toolbar,
    #sidebar > .b3-list--mobile,
    #sidebarRight > .b3-list--mobile {
        background-color: transparent;
    }
}
`;

export const mountMobileSidebarBlur = (host: FeatureHost): FeatureInstance => {
    const apply = () => {
        host.addStyle(buildCss(radiusOf(host), opacityOf(host)));
    };

    apply();
    host.onConfigChange(apply);

    return {};
};
