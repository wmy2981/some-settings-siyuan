import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

/**
 * 集市给有效赞助地址渲染链接，给其它地址渲染复制按钮；两种结构都没有独立类名。
 * 操作区里只有赞助链接使用新窗口打开，因此可以连同复制按钮精确选中，无需改写 DOM。
 */
const CSS = `/* 只隐藏已下载页卡片的捐赠按钮，保留详情页与其它操作 */
#configBazaarDownloaded > .b3-card > .b3-card__actions > a.block__icon[target="_blank"][href],
#configBazaarDownloaded > .b3-card > .b3-card__actions > span.block__icon[data-type="copy-funding"] {
    display: none;
}
`;

export const mountHideBazaarDownloadedDonate = (host: FeatureHost): FeatureInstance => {
    host.addStyle(CSS);
    return {};
};
