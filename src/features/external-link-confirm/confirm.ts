/**
 * 功能：跳转 web 链接前先弹一个 modal 询问，并在 modal 里显示原始链接。
 *
 * 内核为这件事提供了可取消的插件事件：`openLink()` 在真正调用系统浏览器之前会
 * `emit("open-link", {href, originalHref, event})`，插件只要 `preventDefault()`
 * 就能取消本次跳转。这条通路同时覆盖鼠标点击与键盘触发，比在 DOM 上拦 click 更完整
 * （键盘路径根本不经过 click）。
 *
 * 确认之后要"继续跳转"，但内核没有把 `openLink` 暴露给插件。这里的做法是：
 * 拿事件里带的原始事件对象找到那个链接元素，再补发一次同样的 click，
 * 同时用一个绕过标记让我们自己不再拦截第二次——跳转仍然是内核自己那条路。
 * 链接元素已经不在文档里（编辑器重绘过）时退回 `window.open`。
 */
import {Dialog} from "siyuan";
import {copyText} from "../../core/clipboard";
import {isMobile} from "../../core/frontend";
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

/** 只对真正的外链发问，站内资源和 siyuan:// 一律放行。 */
const WEB_LINK = /^https?:\/\//i;

interface OpenLinkDetail {
    href?: string;
    originalHref?: string;
    event?: MouseEvent | KeyboardEvent;
}

const escapeHtml = (value: string): string =>
    value.replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

/** 链接在编辑器里是 `span[data-type="a"][data-href]`，不是真正的 <a>。 */
const LINK_SELECTOR = "[data-type='a'][data-href], [data-type='a'][href], a[href]";

const URL_CSS = `
/* 提问那一行：左边是文案，右边是复制按钮。
   自己写这层 flex 而不是套 fn__flex：窄屏（移动端 92vw）下必须允许按钮换行，
   否则文案会把按钮挤出弹窗。 */
.ss-external-link__head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
}

.ss-external-link__prompt {
    flex: 1 1 auto;
    min-width: 0;
}

.ss-external-link__copy {
    flex: 0 0 auto;
}

.ss-external-link__url {
    box-sizing: border-box;
    max-height: 30vh;
    overflow: auto;
    padding: 8px 10px;
    border: 1px solid var(--b3-border-color);
    border-radius: var(--b3-border-radius);
    background-color: var(--b3-theme-background);
    color: var(--b3-theme-on-background);
    font-family: var(--b3-font-family-code);
    font-size: 12px;
    line-height: 18px;
    word-break: break-all;
    user-select: text;
    -webkit-user-select: text;
}
`;

export const mountExternalLinkConfirm = (host: FeatureHost): FeatureInstance => {
    host.addStyle(URL_CSS);

    let dialog: Dialog | undefined;
    let bypass = false;

    /**
     * 补发一次点击，让内核自己的 openLink 重新跑一遍。
     * 返回 false 表示没能补发（链接已经不在了），由调用方决定退路。
     */
    const reopen = (detail: OpenLinkDetail): boolean => {
        const source = detail.event;
        const target = source?.target;
        const anchor = target instanceof Element ? target.closest(LINK_SELECTOR) : null;
        if (!anchor || !anchor.isConnected) {
            return false;
        }
        bypass = true;
        try {
            anchor.dispatchEvent(
                new MouseEvent("click", {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    shiftKey: source instanceof MouseEvent ? source.shiftKey : false,
                    ctrlKey: source instanceof MouseEvent ? source.ctrlKey : false,
                    metaKey: source instanceof MouseEvent ? source.metaKey : false,
                }),
            );
        } finally {
            // dispatchEvent 是同步的，回来就能立刻复位
            bypass = false;
        }
        return true;
    };

    const ask = (detail: OpenLinkDetail, href: string) => {
        dialog = new Dialog({
            title: host.i18n("externalLinkConfirm.title"),
            // 移动端按约定用 92vw：520px 在手机上会整块溢出，复制按钮那一行也跟着看不见
            width: isMobile() ? "92vw" : "520px",
            content: `<div class="b3-dialog__content">
    <div class="ss-external-link__head">
        <div class="ss-external-link__prompt">${escapeHtml(host.i18n("externalLinkConfirm.prompt"))}</div>
        <button class="b3-button b3-button--outline ss-external-link__copy" type="button" data-ss-copy-link>
            <svg class="b3-button__icon"><use xlink:href="#iconCopy"></use></svg>${
                escapeHtml(host.i18n("externalLinkConfirm.copy"))
            }
        </button>
    </div>
    <div class="fn__hr"></div>
    <div class="ss-external-link__url">${escapeHtml(href)}</div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel" type="button" data-ss-cancel-link>${
                escapeHtml(host.i18n("externalLinkConfirm.cancel"))
            }</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text" type="button" data-ss-open-link>${
                escapeHtml(host.i18n("externalLinkConfirm.open"))
            }</button>
</div>`,
            destroyCallback: () => {
                dialog = undefined;
            },
        });
        // 按钮一律按自定义属性取：动作区里还有一个复制按钮，按 .b3-button 的下标取会错位
        dialog.element.querySelector<HTMLButtonElement>("[data-ss-copy-link]")?.addEventListener("click", () => {
            void copyText(href).then((ok) => {
                host.showMessage(
                    ok ? host.i18n("externalLinkConfirm.copied") : host.i18n("externalLinkConfirm.copyFailed"),
                );
            });
        });
        dialog.element.querySelector<HTMLButtonElement>("[data-ss-cancel-link]")?.addEventListener(
            "click",
            () => dialog?.destroy(),
        );
        dialog.element.querySelector<HTMLButtonElement>("[data-ss-open-link]")?.addEventListener("click", () => {
            const current = dialog;
            dialog = undefined;
            current?.destroy();
            if (!reopen(detail)) {
                // 找不到原始链接元素（编辑器重绘过）时的退路：
                // 内核已经重写过 window.open，移动端会交给原生桥，桌面端交给浏览器
                bypass = true;
                try {
                    window.open(href, "_blank");
                } finally {
                    bypass = false;
                }
            }
        });
    };

    host.addEventBus("open-link", (event) => {
        const detail = event.detail as unknown as OpenLinkDetail;
        const href = detail?.href ?? detail?.originalHref ?? "";
        if (bypass || !WEB_LINK.test(href)) {
            return;
        }
        event.preventDefault();
        if (dialog) {
            // 已经有询问窗口在等答复时，只取消本次跳转，不再叠加一个
            return;
        }
        ask(detail, href);
    });

    return {
        destroy: () => {
            dialog?.destroy();
            dialog = undefined;
        },
    };
};
