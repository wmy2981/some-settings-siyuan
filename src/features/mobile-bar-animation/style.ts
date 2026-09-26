/**
 * 移动端栏体动画优化的实现：一段 CSS。
 *
 * 作用对象是滚动显隐的三块：顶栏 `#mobileTopBar`、面包屑
 * `#editor > .protyle-breadcrumb`、悬浮 dock 栏 `#mobileBottomBar`。
 *
 * 三者的位移都来自同一个 CSS 变量 `--mobile-bar-translate-y`，
 * 由 `mobileBars.ts` 在 rAF 里连续写入，因此这里只需要给 `transform`
 * 和 `opacity` 各加一条过渡，就能把"跟手但会停在半路"变成"平滑追上去"。
 *
 * 键盘弹起/收起以及划选时栏体用 `visibility: hidden` 直接进出，
 * 过渡对 `visibility` 不做处理，不会让栏体在键盘动画期间残留。
 */
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

const DEFAULT_DURATION = 200;

const EASINGS: Record<string, string> = {
    emphasized: "cubic-bezier(.2, 0, 0, 1)",
    standard: "cubic-bezier(.4, 0, .2, 1)",
    linear: "linear",
};

const durationOf = (host: FeatureHost): number => {
    const value = Number(host.config.duration);
    if (!Number.isFinite(value)) {
        return DEFAULT_DURATION;
    }
    return Math.min(600, Math.max(0, value));
};

const easingOf = (host: FeatureHost): string => {
    const value = String(host.config.easing ?? "emphasized");
    return EASINGS[value] || EASINGS.emphasized;
};

const buildCss = (duration: number, easing: string): string =>
    `/* 移动端标题栏 / 面包屑 / 悬浮 dock 栏的滚动显隐过渡 */
#mobileTopBar,
#editor > .protyle-breadcrumb,
#mobileBottomBar {
    transition: transform ${duration}ms ${easing}, opacity ${duration}ms ${easing};
}
`;

export const mountMobileBarAnimation = (host: FeatureHost): FeatureInstance => {
    const apply = () => {
        host.addStyle(buildCss(durationOf(host), easingOf(host)));
    };

    apply();
    host.onConfigChange(apply);

    return {};
};
