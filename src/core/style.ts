/**
 * 功能自带的 CSS 注入。
 *
 * 优先用 CSS 实现界面类功能：只往 <head> 追加一个带命名空间的 <style>，
 * 不动任何核心 DOM 结构。卸载时移除，保证可回退。
 *
 * 注入时可选带上主题作用域：思源给每个窗口/主题在 html 上有 data-theme-mode 等属性，
 * 这里不做额外处理，交由功能自己在 CSS 里用原生变量（如 var(--b3-theme-primary)）。
 */
const ATTR = "data-some-settings-style";

/**
 * 写入/更新某功能的一段 CSS。
 *
 * 同一个 owner 重复调用只会更新同一个 <style> 的内容，
 * 不会不断堆叠新的样式表——配置驱动界面时每次变更都要重新生成 CSS。
 * 返回的撤销函数是幂等的。
 */
export const addStyle = (owner: string, css: string): () => void => {
    if (!css.trim()) {
        return () => undefined;
    }
    let element = document.head.querySelector<HTMLStyleElement>(`style[${ATTR}="${CSS.escape(owner)}"]`);
    if (!element) {
        element = document.createElement("style");
        element.setAttribute(ATTR, owner);
        document.head.append(element);
    }
    element.textContent = css;

    return () => element?.remove();
};

/** 卸载某功能残留的全部样式（防御性清理，用于异常路径）。 */
export const removeStylesOf = (owner: string): void => {
    document.querySelectorAll(`style[${ATTR}="${CSS.escape(owner)}"]`).forEach((element) => element.remove());
};
