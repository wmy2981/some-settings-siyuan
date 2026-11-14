/**
 * 隐藏选中文字工具条的实现：只注入一段 CSS。
 *
 * 为什么只做显示层：
 * - 不改 `protyle.options.toolbar = []`：那会删掉工具栏条目，`Toolbar.update()` 会重建，
 *   而且影响所有编辑器实例，回退不干净。
 * - 不用 `visibility: hidden`：元素仍然占着 fixed 层，可能挡住点击。
 * - 不 patch `Toolbar.render()`：宿主每次选区变化都会调用它，CSS 最稳、也最容易回退。
 *
 * 宿主自己显隐工具条走的是 `fn__none` 类与内联 `style.display`，不会写 `display: block`，
 * 所以这里的 `display: none` 不会被它意外恢复；加 `!important` 是为了压过宿主样式表里
 * 那条同特异性的 `display` 声明（谁后注入谁赢，但重载插件后顺序不一定可靠）。
 */
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

const CSS = `/* 隐藏桌面端选中文字后弹出的格式工具条（表格单元格、嵌入块与标题里的复用实例一起隐藏） */
.protyle-toolbar {
    display: none !important;
}
`;

export const mountHideSelectionToolbar = (host: FeatureHost): FeatureInstance => {
    host.addStyle(CSS);
    host.log.info("mounted: the selection toolbar no longer pops up on desktop");

    return {
        destroy: () => {
            host.log.info("unmounted: the selection toolbar is back");
        },
    };
};
