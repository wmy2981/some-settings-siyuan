declare module "*.scss" {
    const content: Record<string, string>;
    export default content;
}

/**
 * 思源在前端启动时通过 `stage/protyle/js/protyle-html.js` 注入的消毒库（集市 README、
 * 资源预览都用它）。插件 API（`siyuan` 包）只声明了 `Lute`，这个得自己声明。
 */
interface Window {
    DOMPurify?: {
        sanitize(dirty: string, options?: unknown): string;
    };
}
