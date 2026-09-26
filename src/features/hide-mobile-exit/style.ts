/**
 * 隐藏移动端侧面板「退出应用」按钮：一段 CSS。
 *
 * 模块本体会把它重新显示出来（`classList.remove("fn__none")`），
 * 所以只能靠 CSS 压住；按钮本身仍留在 DOM 里，插件卸载后立刻恢复。
 */
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

const CSS = `/* 隐藏移动端侧面板里只有图标的退出应用按钮 */
#sidebarRight > .toolbar > #sidebarRightExit {
    display: none;
}
`;

export const mountHideMobileExit = (host: FeatureHost): FeatureInstance => {
    host.addStyle(CSS);
    return {};
};
