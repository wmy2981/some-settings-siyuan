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
 *
 * 移动端的位置每秒钟重算一次（`place()`）：底部操作条与键盘工具栏都不常驻、高度也不是常量，
 * 键盘弹起时后者还会盖住屏幕底部并把自己的层级抬到最高，所以浮窗既要把自己挪到它上面，
 * 也要重新抢回层级，否则就会像以前那样只露出一条边。
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
/** 移动端底部会占用高度的两个常驻/非常驻元素。 */
const KEYBOARD_TOOLBAR_ID = "keyboardToolbar";
const MOBILE_BOTTOM_BAR_ID = "mobileBottomBar";
/** 浮窗与它下方那件东西之间的空隙。 */
const GAP = 8;

const WINDOW_CSS = `
/* 浮窗本体：借用内核提示条（.b3-snackbar__content）的配色，看起来和思源自己的浮层一致。
   不铺遮罩、不占满屏，也不拦截事件，只占它自己那一小块。
   窗口里的东西一律不换行：它只有一行内容，折行只会让它变高、变丑。 */
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
    white-space: nowrap;
}

/* 移动端：底部居中，具体抬多高由 place() 现量现写。
   居中用 left/right + margin 而不是 left: 50% + translate —— 后者只给浮窗留下半屏
   可用宽度，内容一长就被压着换行，所以这里让它能用满整个视口宽度。 */
.ss-recording-window--mobile {
    right: 0;
    left: 0;
    width: fit-content;
    margin-inline: auto;
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

/* 文案与时长都不许被挤窄：挤窄了就会折行 */
.ss-recording-window__label,
.ss-recording-window__time {
    flex: 0 0 auto;
}

.ss-recording-window__time {
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

/** 元素当前占的高度；不存在或正被隐藏时算 0。 */
const heightOf = (id: string): number => {
    const element = document.getElementById(id);
    return element && !element.classList.contains("fn__none") ?
        element.getBoundingClientRect().height :
        0;
};

/**
 * 浮窗下沿要抬多高。
 *
 * 移动端屏幕底部会被两样东西占用：键盘工具栏（键盘弹起时出现，展开面板时还会变高）
 * 与底部操作条。两者都不常驻、高度也不是常量，所以每次摆位都现量一遍。
 * 移动端浏览器里键盘只遮住视觉视口、布局视口不变，那一段也要加上；
 * 原生 App 里 WebView 会被键盘顶小，这一段自然是 0。
 */
const bottomOffset = (): number => {
    const viewport = window.visualViewport;
    const covered = viewport ? Math.max(0, window.innerHeight - (viewport.offsetTop + viewport.height)) : 0;
    return covered + Math.max(heightOf(KEYBOARD_TOOLBAR_ID), heightOf(MOBILE_BOTTOM_BAR_ID)) + GAP;
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

    /** 把浮窗摆到当前该在的位置；移动端每次都要重算，桌面端交给 CSS。 */
    const place = () => {
        if (element && isMobile()) {
            element.style.bottom = `${bottomOffset()}px`;
        }
    };

    /** 抬到当前最高层：键盘工具栏出现时也会抬自己，不重新抢就会被它盖住。 */
    const raise = () => {
        if (element) {
            element.style.zIndex = String(++window.siyuan.zIndex);
        }
    };

    const tick = () => {
        const time = element?.querySelector<HTMLElement>(".ss-recording-window__time");
        if (time) {
            time.textContent = formatElapsed(Date.now() - startedAt);
        }
        // 底部那两件东西的高度会变（键盘工具栏展开面板、底部操作条出现或消失），跟着走
        place();
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
        element.innerHTML = `<span class="ss-recording-window__dot"></span>
<span class="ss-recording-window__label">${escapeHtml(String(window.siyuan.languages?.recording ?? ""))}</span>
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
        raise();
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

    // 键盘工具栏出现/收起时立刻重排，不等下一次 tick
    host.addEventBus("mobile-keyboard-show", () => {
        raise();
        place();
    });
    host.addEventBus("mobile-keyboard-hide", place);

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
