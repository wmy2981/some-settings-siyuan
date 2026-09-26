/**
 * 命令面板瘦身的实现：一段 CSS。
 *
 * 选择器统一挂在 `[data-key="dialog-commandpanel"]` 上（那是 Dialog 外层 wrapper 的属性），
 * 不用 `.b3-dialog__container` 之类的通用类，避免顺手把别的弹窗也改了。
 *
 * 宽度是内核写在容器上的**内联样式**（`width: 80vw`），插件不去改内核的 DOM，
 * 所以只能靠 `!important` 压过它，并按同一个基准值等比缩放。
 */
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

/** 内核给命令面板的宽度，来自它的 `new Dialog({width: "80vw"})`。 */
const NATIVE_WIDTH_VW = 80;
const DEFAULT_PERCENT = 50;

const percentOf = (host: FeatureHost): number => {
    const value = Number(host.config.width);
    if (!Number.isFinite(value)) {
        return DEFAULT_PERCENT;
    }
    return Math.min(100, Math.max(20, Math.round(value)));
};

const buildCss = (percent: number): string =>
    `/* 桌面端命令面板瘦身：宽度按思源原生值等比缩放 */
[data-key="dialog-commandpanel"] .b3-dialog__container {
    width: ${NATIVE_WIDTH_VW * percent / 100}vw !important;
}
`;

export const mountCommandPanelSlim = (host: FeatureHost): FeatureInstance => {
    const apply = () => {
        host.addStyle(buildCss(percentOf(host)));
    };

    apply();
    host.onConfigChange(apply);

    return {};
};
