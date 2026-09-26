/**
 * 文档树强调色的实现：一段 CSS，颜色与宽度都来自配置。
 *
 * 色值只做最基本的白名单过滤（`#rgb` / `#rrggbb` / 字母数字与 `()`、`-,.%` 这类
 * CSS 颜色函数字符），因为它是直接拼进样式表的；不合法时回落到思源主题主色。
 * 空串表示"跟随思源"，默认就是这条路。
 */
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

const FALLBACK_COLOR = "var(--b3-theme-primary)";
const DEFAULT_WIDTH = 3;

/** 允许的 CSS 颜色写法：十六进制色、颜色函数、具名颜色、CSS 变量、关键字。 */
const SAFE_COLOR =
    /^(#[0-9a-fA-F]{3,8}|[a-zA-Z-]+|(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color-mix|var)\([^;{}"']*\))$/;

const colorOf = (host: FeatureHost): string => {
    const raw = String(host.config.color ?? "").trim();
    if (!raw) {
        return FALLBACK_COLOR;
    }
    return SAFE_COLOR.test(raw) ? raw : FALLBACK_COLOR;
};

const widthOf = (host: FeatureHost): number => {
    const value = Number(host.config.width);
    if (!Number.isFinite(value)) {
        return DEFAULT_WIDTH;
    }
    return Math.min(10, Math.max(1, Math.round(value)));
};

const buildCss = (color: string, width: number): string =>
    `/* 文档树中当前打开笔记的左缘强调色 */
.sy__file .b3-list--background .b3-list-item--focus,
#sidebar .b3-list--mobile [data-type="sidebar-file"] .b3-list-item--focus {
    box-shadow: inset ${width}px 0 0 0 ${color};
}
`;

export const mountDocTreeOpenedAccent = (host: FeatureHost): FeatureInstance => {
    const apply = () => {
        host.addStyle(buildCss(colorOf(host), widthOf(host)));
    };

    apply();
    host.onConfigChange(apply);

    return {};
};
