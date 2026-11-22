/**
 * 弹窗入场图层预热。
 *
 * 宿主的 `Dialog` 用 `transform` / `opacity` 做入场：`.b3-dialog__container` 从
 * `scale(.8)` / `opacity: 0` 过渡到 `transform: none` / `opacity: 1`。过渡期间浏览器会
 * 临时建层、结束时再拆层，WebView 在拆层那一帧只能提交拆层前的旧纹理，弹窗就会闪一帧
 * 旧画面（真机复现于移动端）。这里在过渡开始前就把动画容器、内容区和确有滚动正文的区域
 * 常驻提升为独立图层，入场期间不再建层/拆层。
 *
 * **只加图层提示**：不覆盖宿主的 `transition`，不改 `b3-dialog--open` 的切换时序，
 * 不在 `transitionend` 后移除，也不为每个控件盲目建层。宿主的 `Dialog` 在构造后
 * 50ms 才加 `b3-dialog--open`，所以 `new Dialog()` 返回后立刻调用本模块即可，
 * 样式一定在过渡开始前生效。
 *
 * 用法：每个自建 `Dialog` 在 `new Dialog()` 之后同步调一次 `preheatDialogLayer(dialog)`。
 */
import type {Dialog} from "siyuan";
import {PANEL_CLASS} from "./ui";

/**
 * 弹窗容器上的预热类。
 *
 * 只负责 `will-change`，不含任何布局样式：面板的间距、宽度都由行内样式决定，
 * 不能再有第二份靠类名生效的样式与它打架。
 */
export const LAYER_CLASS = "some-settings-layer";

const LAYER_CSS_ID = `${LAYER_CLASS}-local-css`;

/**
 * 预热的作用范围：动画容器、内容区，以及设置面板里真正滚动的页签内容。
 *
 * 最后一条只认桌面端的面板：桌面端是每一页自己滚（`.some-settings-panel__view`），
 * 移动端整块面板由宿主的内容区滚动（已经由第二条覆盖），页签内容本身不再是滚动区 ——
 * 给一个和正文一样高的静态元素建层只会白占内存，所以排除掉 `--mobile`。
 * 其它弹窗只有前两条生效。
 */
const LAYER_CSS = `
.${LAYER_CLASS}.b3-dialog__container,
.${LAYER_CLASS} .b3-dialog__content,
.${LAYER_CLASS} .${PANEL_CLASS}:not(.${PANEL_CLASS}--mobile) .${PANEL_CLASS}__view:not(.fn__none) {
    will-change: transform;
}
`;

/**
 * 注入（或重写）预热样式。
 *
 * 文档由对话框自己决定：独立设置窗口模式下它在另一个窗口的文档里，插件所属窗口的
 * `document` 管不到它。
 *
 * 每次都重写 `textContent`，不能在元素已存在时直接返回：禁用 / 启用、重载插件都不会
 * 重载页面，`<head>` 里的 `<style>` 会留下来，于是新代码会配上一份旧样式表。
 */
const ensureLayerCss = (doc: Document): void => {
    let element = doc.getElementById(LAYER_CSS_ID) as HTMLStyleElement | null;
    if (!element) {
        element = doc.createElement("style");
        element.id = LAYER_CSS_ID;
        doc.head.append(element);
    }
    if (element.textContent !== LAYER_CSS) {
        element.textContent = LAYER_CSS;
    }
};

/**
 * 给刚创建、尚未开始入场动画的弹窗挂上图层预热。
 *
 * 幂等：同一个弹窗重复调用只会补一次类、重写一次同样的样式内容。
 */
export const preheatDialogLayer = (dialog: Dialog): void => {
    ensureLayerCss(dialog.element.ownerDocument);
    dialog.element.querySelector<HTMLElement>(".b3-dialog__container")?.classList.add(LAYER_CLASS);
};
