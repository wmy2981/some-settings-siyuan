/**
 * 命令面板瘦身的实现：一段 CSS。
 *
 * 选择器统一挂在 `[data-key="dialog-commandpanel"]` 上（那是 Dialog 外层 wrapper 的属性），
 * 不用 `.b3-dialog__container` 之类的通用类，避免顺手把别的弹窗也改了。
 *
 * 底部的快捷键提示条只是移除显示，不删节点——面板的行为完全不受影响，
 * 插件卸载后立刻恢复原样。
 */
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

const DEFAULT_ROW_HEIGHT = 24;

const hideTipOf = (host: FeatureHost): boolean => host.config.hideTip !== false;

const hideMetaOf = (host: FeatureHost): boolean => host.config.hideMeta === true;

const rowHeightOf = (host: FeatureHost): number => {
    const value = Number(host.config.rowHeight);
    if (!Number.isFinite(value)) {
        return DEFAULT_ROW_HEIGHT;
    }
    return Math.min(32, Math.max(20, Math.round(value)));
};

const buildCss = (hideTip: boolean, hideMeta: boolean, rowHeight: number): string =>
    `/* 桌面端命令面板瘦身 */
${
        hideTip ?
            `[data-key="dialog-commandpanel"] .search__tip {
    display: none;
}
` :
            ""
    }${
        hideMeta ?
            `[data-key="dialog-commandpanel"] .b3-list-item__meta {
    display: none;
}
` :
            ""
    }[data-key="dialog-commandpanel"] #commands > .b3-list-item {
    min-height: ${rowHeight}px;
    line-height: ${rowHeight}px;
    margin: 0 6px;
}
`;

export const mountCommandPanelSlim = (host: FeatureHost): FeatureInstance => {
    const apply = () => {
        host.addStyle(buildCss(hideTipOf(host), hideMetaOf(host), rowHeightOf(host)));
    };

    apply();
    host.onConfigChange(apply);

    return {};
};
