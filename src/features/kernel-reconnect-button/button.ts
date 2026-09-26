/**
 * 「立即重连」按钮的实现。
 *
 * 关于"立即重连"能做什么：内核没有把 `openLink` 那样的重连入口给插件。
 * `window.siyuan.ws` 是主 WebSocket 的 Model 实例，但 `connect()` 需要原始
 * `msgCallback`，而它只存在于内核启动时那个闭包里——自己再调一次 `connect()`
 * 会换掉 socket 却拿不回消息回调，等于把内核推送全丢掉，因此绝对不能走。
 * 剩下的、既立即又干净的路径只有整页重载：重载会重新建立主 WebSocket。
 *
 * 所以按钮的语义是：先探一次内核是否真的回来了，回来了就重载前端；
 * 还没回来就明确告诉用户，而不是假装连上了。
 */
import {fetchPost} from "siyuan";
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

/** 断连面板的 id（挂在 Dialog 的外层 wrapper 上）。 */
const ERROR_LOG_ID = "errorLog";
/** 我们自己注入的按钮的标记，用来判断是否已经注入过。 */
const BUTTON_ATTR = "data-ss-reconnect";
/** 单次探活的超时。 */
const PROBE_TIMEOUT_MS = 2000;

/** 探一次内核是否已经恢复。请求超时、异常一律按"没恢复"处理。 */
export const probeKernel = (): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (alive: boolean) => {
            if (settled) {
                return;
            }
            settled = true;
            window.clearTimeout(timer);
            resolve(alive);
        };
        const timer = window.setTimeout(() => finish(false), PROBE_TIMEOUT_MS);
        try {
            fetchPost("/api/system/currentTime", {}, (response) => finish(response?.code === 0));
        } catch {
            finish(false);
        }
    });

/** 立即重连：先探活，活着就重载前端把主 WebSocket 重新拉起来。 */
export const reconnectNow = async (host: FeatureHost): Promise<boolean> => {
    const alive = await probeKernel();
    if (!alive) {
        return false;
    }
    host.log("内核已恢复，重载前端以重建 WebSocket");
    window.location.reload();
    return true;
};

export const mountReconnectButton = (host: FeatureHost): FeatureInstance => {
    const inject = (dialog: HTMLElement) => {
        if (dialog.querySelector(`[${BUTTON_ATTR}]`)) {
            return;
        }
        const button = document.createElement("button");
        button.type = "button";
        button.className = "b3-button b3-button--outline";
        button.setAttribute(BUTTON_ATTR, "true");
        button.textContent = host.i18n("kernelReconnectButton.label");

        button.addEventListener("click", () => {
            const idleLabel = button.textContent;
            button.disabled = true;
            button.textContent = host.i18n("kernelReconnectButton.working");
            void reconnectNow(host).then((alive) => {
                if (!button.isConnected) {
                    return;
                }
                button.disabled = false;
                button.textContent = idleLabel;
                if (!alive) {
                    host.showMessage(host.i18n("kernelReconnectButton.offline"));
                }
            });
        });

        // 桌面浏览器下断连面板根本没有动作区，这时自己补一个容器，
        // 插在正文之后，视觉上与内核自己的动作区一致。
        const action = dialog.querySelector<HTMLElement>(".b3-dialog__action");
        if (action) {
            action.prepend(button);
            return;
        }
        const body = dialog.querySelector<HTMLElement>(".b3-dialog__body");
        if (!body) {
            return;
        }
        const row = document.createElement("div");
        row.className = "b3-dialog__action";
        row.append(button);
        body.append(row);
    };

    const scan = () => {
        const dialog = document.getElementById(ERROR_LOG_ID);
        if (dialog) {
            inject(dialog);
        }
    };

    scan();
    // 面板在每次断连时都会重新创建，所以不能只注入一次。
    const observer = new MutationObserver(scan);
    observer.observe(document.body, {childList: true});

    return {
        destroy: () => {
            observer.disconnect();
            // 关掉功能时把已经注入的按钮一并摘掉，不留一个点了没反应的按钮
            document.querySelectorAll<HTMLElement>(`[${BUTTON_ATTR}]`).forEach((button) => button.remove());
        },
    };
};
