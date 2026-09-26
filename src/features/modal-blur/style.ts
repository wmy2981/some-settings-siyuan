/**
 * modal 高斯模糊的实现：只注入一段 CSS。
 *
 * 生成 CSS 时永远返回非空文本（哪怕只有注释）：`core/style.ts` 的 `addStyle`
 * 收到空串会直接返回，旧样式表不会被清掉，于是"把半径调到最小"看起来没生效。
 */
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

const DEFAULT_RADIUS = 10;

const radiusOf = (host: FeatureHost): number => {
    const value = Number(host.config.radius);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_RADIUS;
};

const buildCss = (radius: number): string => `/* modal 高斯模糊：只作用在遮罩层，弹窗自身不受影响 */
.b3-dialog__scrim {
    -webkit-backdrop-filter: blur(${radius}px);
    backdrop-filter: blur(${radius}px);
}
`;

export const mountModalBlur = (host: FeatureHost): FeatureInstance => {
    const apply = () => {
        host.addStyle(buildCss(radiusOf(host)));
    };

    apply();
    host.onConfigChange(apply);

    return {};
};
