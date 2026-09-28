/**
 * 录音浮窗的实现。
 *
 * 录音本身完全交给内核：麦克风权限、PCM→MP3 编码、停止后上传并插入音频块，
 * 都还是思源自己那条链路（原生录音器不支持暂停，所以这里也不提供暂停/继续）。
 * 本功能只换掉那段时间里的界面：
 *
 * - 内核开始录音后会弹一条永不消失的 toast（`#message` 里那段「录音中…」+「结束录音」），
 *   它就是"录音真的开始了"的唯一可靠信号（权限被拒时根本不会有它）。
 *   这里认出它之后把它藏起来，换成自己的小浮窗。
 * - 原生 toast **留在 DOM 里**，只是 `display: none`：它那个按钮是内核 `stopRecord()`
 *   的唯一入口，浮窗上的「结束录音」点一下就是去点它，停止/上传/插入全由内核完成。
 * - 录音结束（用户点停止、或用面包屑菜单里的「结束录音」、或麦克风中断）时内核会
 *   收掉那条 toast，这里以"它没了/正在淡出"作为收窗信号。
 */
import {isMobile} from "../../core/frontend";
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";
import {escapeHtml} from "../../core/ui";

/** 原生提示所在的容器。 */
const MESSAGE_SELECTOR = "#message";
/** 原生提示里的文字层。 */
const CONTENT_SELECTOR = ".b3-snackbar__content";
/** 藏起原生提示用的类（只加在它自己身上，不影响别的提示）。 */
const HIDDEN_CLASS = "ss-recording-window-native";
/** 淡出中的提示类，由内核 `hideMessage()` 加上。 */
const FADING_CLASS = "b3-snackbar--hide";

const WINDOW_CSS = `
/* 浮窗本体：借用内核提示条（.b3-snackbar__content）的配色，看起来和思源自己的浮层一致。
   不铺遮罩、不占满屏，也不拦截事件，只占它自己那一小块。 */
.ss-recording-window {
    position: fixed;
    right: 16px;
    bottom: 40px;
    display: flex;
    align-items: center;
    gap: 8px;
    box-sizing: border-box;
    max-width: calc(100vw - 32px);
    padding: 8px 12px;
    border-radius: var(--b3-border-radius-b);
    background-color: var(--b3-tooltips-background);
    color: var(--b3-tooltips-color);
    box-shadow: var(--b3-dialog-shadow);
    font-size: 12px;
    line-height: 18px;
}

/* 移动端放在底部操作条上方居中：那里是原生的浮动区，不压住正文。 */
.ss-recording-window--mobile {
    right: auto;
    bottom: calc(var(--mobile-bottom-bar-offset, 64px) + 8px);
    left: 50%;
    transform: translateX(-50%);
}

/* 录音指示点：呼吸感用来替代内核完全没有的"正在录音"视觉提示。 */
.ss-recording-window__dot {
    flex: 0 0 auto;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background-color: var(--b3-theme-error);
    animation: ss-recording-window-pulse 1.4s ease-in-out infinite;
}

@keyframes ss-recording-window-pulse {
    0%, 100% {
        opacity: 1;
    }

    50% {
        opacity: .35;
    }
}

.ss-recording-window__time {
    flex: 0 0 auto;
    min-width: 3.4em;
    font-variant-numeric: tabular-nums;
    text-align: center;
}

.ss-recording-window__stop {
    flex: 0 0 auto;
    white-space: nowrap;
}

/* 藏起来的原生提示：留在 DOM 里，按钮仍然可以被程序点。 */
.${HIDDEN_CLASS} {
    display: none;
}
`;

interface NativeToast {
    toast: HTMLElement;
    /** 原生提示里那个「结束录音」按钮。 */
    stopButton: HTMLButtonElement;
}

/** 秒数格式化成 `mm:ss`，超过一小时补上小时。 */
const formatElapsed = (milliseconds: number): string => {
    const total = Math.max(0, Math.floor(milliseconds / 1000));
    const seconds = String(total % 60).padStart(2, "0");
    const minutes = String(Math.floor(total / 60) % 60).padStart(2, "0");
    const hours = Math.floor(total / 3600);
    return hours > 0 ? `${hours}:${minutes}:${seconds}` : `${minutes}:${seconds}`;
};

export const mountRecordingWindow = (host: FeatureHost): FeatureInstance => {
    host.addStyle(WINDOW_CSS);

    let current: NativeToast | undefined;
    let element: HTMLElement | undefined;
    let timer = 0;
    let startedAt = 0;
    let frame = 0;

    /** 找出"正在录音"那条原生提示。 */
    const findToast = (): NativeToast | undefined => {
        const recording = window.siyuan.languages?.recording;
        if (typeof recording !== "string" || recording === "") {
            return undefined;
        }
        const toasts = document.querySelectorAll<HTMLElement>(`${MESSAGE_SELECTOR} .b3-snackbar`);
        for (const toast of toasts) {
            if (toast.classList.contains(FADING_CLASS)) {
                continue;
            }
            const content = toast.querySelector<HTMLElement>(CONTENT_SELECTOR);
            const stopButton = content?.querySelector<HTMLButtonElement>("button");
            if (content && stopButton && (content.textContent ?? "").includes(recording)) {
                return {toast, stopButton};
            }
        }
        return undefined;
    };

    const tick = () => {
        const time = element?.querySelector<HTMLElement>(".ss-recording-window__time");
        if (time) {
            time.textContent = formatElapsed(Date.now() - startedAt);
        }
    };

    const close = () => {
        if (timer) {
            window.clearInterval(timer);
            timer = 0;
        }
        element?.remove();
        element = undefined;
        // 还原本地藏起来的那条原生提示：功能被关掉时不能让它一直隐身
        current?.toast.classList.remove(HIDDEN_CLASS);
        current = undefined;
    };

    const open = (native: NativeToast) => {
        current = native;
        // 原生提示留着（它的按钮是停止录音的唯一入口），只是不再显示
        native.toast.classList.add(HIDDEN_CLASS);

        startedAt = Date.now();
        element = document.createElement("div");
        element.className = `ss-recording-window${isMobile() ? " ss-recording-window--mobile" : ""}`;
        // 与内核自己的浮层一样抬到当前最高层，避免被后开的弹窗盖住
        element.style.zIndex = String(++window.siyuan.zIndex);
        element.innerHTML = `<span class="ss-recording-window__dot"></span>
<span>${escapeHtml(String(window.siyuan.languages?.recording ?? ""))}</span>
<span class="ss-recording-window__time"></span>
<button class="b3-button b3-button--white ss-recording-window__stop" type="button" data-ss-stop>${
            escapeHtml(String(window.siyuan.languages?.endRecord ?? ""))
        }</button>`;
        const stopButton = element.querySelector<HTMLButtonElement>("[data-ss-stop]");
        stopButton?.addEventListener("click", () => {
            // 只是转手：停止、上传、插入音频块都由内核那条链路完成
            stopButton.disabled = true;
            native.stopButton.click();
        });
        document.body.append(element);
        tick();
        timer = window.setInterval(tick, 1000);
    };

    const sync = () => {
        // 跟丢了（提示被内核收掉，或正在淡出）= 录音结束
        if (current && (!current.toast.isConnected || current.toast.classList.contains(FADING_CLASS))) {
            close();
            return;
        }
        if (current) {
            return;
        }
        const native = findToast();
        if (native) {
            open(native);
        }
    };

    const schedule = () => {
        if (frame) {
            return;
        }
        frame = window.requestAnimationFrame(() => {
            frame = 0;
            sync();
        });
    };

    const observer = new MutationObserver(schedule);
    const container = document.querySelector(MESSAGE_SELECTOR) ?? document.body;
    observer.observe(container, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class"],
    });
    sync();

    return {
        destroy: () => {
            observer.disconnect();
            if (frame) {
                window.cancelAnimationFrame(frame);
                frame = 0;
            }
            close();
        },
    };
};
