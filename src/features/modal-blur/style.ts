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

const buildCss = (radius: number): string =>
    `/* modal 高斯模糊：只作用在遮罩层，弹窗自身不受影响 */
.b3-dialog__scrim {
    -webkit-backdrop-filter: blur(${radius}px);
    backdrop-filter: blur(${radius}px);
}

/* 属性视图面板复用了同一个遮罩类名，但它不是 modal，不能被糊上 */
.av__panel > .b3-dialog__scrim {
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
}

/* 非模态浮层（emoji / 图标选择面板、发布权限浮层）由内核把遮罩写成内联的
   透明底色：它只是用来接"点外面关掉"的，糊上去会把背后的正文一起糊掉 */
.b3-dialog__scrim[style*="transparent"] {
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
}

/* 图标选择面板在移动端不是透明遮罩（是底部弹层），得按 dialog 自己的 data-key 排除；
   遮罩就在带 data-key 的那层里面，所以不需要 :has() */
[data-key="dialog-emojis"] .b3-dialog__scrim {
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
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
