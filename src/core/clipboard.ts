/**
 * 复制纯文本到剪贴板。
 *
 * 移动端 WebView 里 `navigator.clipboard.writeText()` 是**不生效的**：安卓 / iOS 的
 * WebView 都没有把剪贴板写权限授给页面，调用会被拒绝（或者在非安全来源下
 * `navigator.clipboard` 干脆是 undefined）。所以这两个端必须走 App 注入的原生桥。
 *
 * 顺序与内核自己的复制通路一致：能用原生桥就用原生桥，其次是 Clipboard API，
 * 最后退回「隐藏 textarea + `document.execCommand("copy")`」。
 * 之前的实现只用 `navigator.clipboard?.writeText(...)`，而且用了可选链——
 * 桥不存在时整条链静默短路，连一句「复制失败」都不会提示。
 */
type NativeContainer = "android" | "ios" | "harmony";

interface ClipboardHost {
    JSAndroid?: {writeClipboard?: (text: string) => void;};
    JSHarmony?: {writeClipboard?: (text: string) => unknown;};
    webkit?: {messageHandlers?: {setClipboard?: {postMessage: (text: string) => void;};};};
    siyuan?: {config?: {system?: {container?: string;};};};
}

const hostOf = (): ClipboardHost => window as unknown as ClipboardHost;

/** App 容器类型；桌面端与浏览器为空串。 */
const containerOf = (): string => hostOf().siyuan?.config?.system?.container ?? "";

/**
 * 走 App 注入的原生桥。
 * 返回 undefined 表示当前环境没有可用的桥，调用方继续往下试。
 */
const writeViaNativeBridge = (text: string): boolean | undefined => {
    const host = hostOf();
    const container = containerOf() as NativeContainer | "";
    if (container === "android" && host.JSAndroid?.writeClipboard) {
        host.JSAndroid.writeClipboard(text);
        return true;
    }
    if (container === "ios" && host.webkit?.messageHandlers?.setClipboard) {
        host.webkit.messageHandlers.setClipboard.postMessage(text);
        return true;
    }
    if (container === "harmony" && host.JSHarmony?.writeClipboard) {
        // 鸿蒙的桥会明确返回 false 表示没写进去，其余情况按成功处理
        return host.JSHarmony.writeClipboard(text) !== false;
    }
    return undefined;
};

/**
 * 兜底：把文本放进一个不该被看见的 textarea，选中它再让浏览器执行复制。
 *
 * `readonly` 是为了不弹出软键盘；iOS 上 readonly 的 textarea 光靠 `select()`
 * 不一定产生选区，所以再补一次 `setSelectionRange`。
 */
const writeViaTextarea = (text: string): boolean => {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "true");
    area.style.position = "fixed";
    area.style.top = "0";
    area.style.left = "0";
    area.style.opacity = "0";
    area.style.setProperty("-webkit-user-select", "text");
    document.body.append(area);
    area.focus();
    area.select();
    area.setSelectionRange(0, text.length);
    let copied: boolean;
    try {
        copied = document.execCommand("copy");
    } catch {
        // 个别内核上 execCommand 会直接抛，按复制失败处理
        copied = false;
    }
    area.remove();
    return copied;
};

/** 复制成功返回 true。任何一步失败都继续往下兜底，不抛错。 */
export const copyText = async (text: string): Promise<boolean> => {
    if (!text) {
        return false;
    }
    const viaNative = writeViaNativeBridge(text);
    if (viaNative !== undefined) {
        return viaNative;
    }
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {
        // http 来源、没有写权限、文档失焦时都会拒绝，落到下面的兜底
    }
    return writeViaTextarea(text);
};
