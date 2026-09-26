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
 * dock 栏还多一步：内核把滚动进度**连续**写进 `--mobile-bar-opacity`，
 * 而进度是"每滚 48px 累加一次"的量，停在任意值上，栏体就停在
 * "半透明 + 只露出一部分"的中间状态上（这正是要消掉的那个观感）。
 * 所以这里先把进度折成 0 / 1 两档，再交给同一条过渡去补动画：
 * 栏体要么整体显示、要么整体隐藏，中间只有过渡那一小段时间。
 *
 * 键盘弹起/收起以及划选时栏体用 `visibility: hidden` 直接进出，
 * 过渡对 `visibility` 不做处理，不会让栏体在键盘动画期间残留。
 */
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

const DEFAULT_DURATION = 200;
/** 把连续进度折成开关的阈值：不透明度低于它就当作"已隐藏"。 */
const VISIBLE_THRESHOLD = 0.5;

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

const buildCss = (duration: number, easing: string): string => {
    const transition = `transition: transform ${duration}ms ${easing}, opacity ${duration}ms ${easing};`;
    // (不透明度 - 阈值) 放大 100 倍后夹在 0 / 1 之间：跨过阈值就整体切换
    const visible = `clamp(0, calc((var(--mobile-bar-opacity, 1) - ${VISIBLE_THRESHOLD}) * 100), 1)`;
    return `/* 移动端标题栏 / 面包屑的滚动显隐过渡 */
#mobileTopBar,
#editor > .protyle-breadcrumb {
    ${transition}
}

/* 悬浮 dock 栏：连续进度折成两档，不再停在半透明、只露出一部分的中间状态 */
#mobileBottomBar {
    --ss-mobile-bar-visible: ${visible};
    opacity: var(--ss-mobile-bar-visible);
    transform: translate3d(0, calc((1 - var(--ss-mobile-bar-visible)) * 100%), 0);
    ${transition}
}
`;
};

export const mountMobileBarAnimation = (host: FeatureHost): FeatureInstance => {
    const apply = () => {
        host.addStyle(buildCss(durationOf(host), easingOf(host)));
    };

    apply();
    host.onConfigChange(apply);

    return {};
};
