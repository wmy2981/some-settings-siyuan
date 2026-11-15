/**
 * 退出确认的实现。
 *
 * 思源没有给插件留任何"要退出了"的钩子：没有事件、没有可否决的 IPC，
 * 主进程最终是 `app.exit()`，连渲染进程的卸载生命周期都不走。三条退出入口
 * （主菜单的「退出应用」、桌面托盘右键的退出、以及"关闭窗口＝退出应用"时的关窗）
 * 唯一的公共汇聚点是渲染进程发出的那一次 `POST /api/system/exit`，
 * 所以这里就守在那里：临时接管 `window.fetch`，认出这次退出请求后先问一句，
 * 用户点了取消就让这次请求以 `AbortError` 结束 —— 宿主的 fetchPost 明确把
 * `AbortError` 当作"用户主动取消"（不回调、不提示、也不会在超时后补一次退出）。
 *
 * 只认「真的退出应用」那一次：
 * - `force === true` 的不问（内核同步失败后用户已经点过「强制退出」了）；
 * - `setCurrentWorkspace === false` 的不问（那是"切换工作空间 / 需要重启"这类
 *   应用内动作，它们有自己的确认流程，弹一句"确定退出思源吗"只会让人困惑）。
 *
 * 托盘退出不打扰用户：思源把上面三条路汇到同一个请求上，请求体一字不差，
 * 插件没有别的办法区分它们；还留在渲染进程里的唯一差别是窗口状态 ——
 * 从托盘退出时窗口要么已经收进托盘（`visibilityState` 不是 visible），
 * 要么至少不在前台（点托盘菜单会让窗口失焦），而在应用里点退出时窗口一定在前台。
 * 所以桌面上只对前台的窗口发问。移动端没有托盘，这个判据不适用，照常发问。
 *
 * 覆盖不到的两条路（都在思源内部，官方 API 碰不到）：
 * - 连接远程内核时（`ownsKernel` 为假）退出根本不发这个请求；
 * - 请求本身失败时宿主的兜底是直接 `ipcRenderer.send("siyuan-quit")`；
 * 另外系统关机走主进程，也不经过这里。
 */
import {confirm} from "siyuan";
import {isMobile} from "../../core/frontend";
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

/** 退出接口。渲染进程里所有"退出应用"最后都落到这一次 POST 上。 */
const EXIT_PATH = "/api/system/exit";

/**
 * 宿主在发出退出请求**之前**就建立的东西。
 *
 * 3.8.7-beta.4 起，退出改走 `requestSystemExit()`：它先 `progressLoading(…, "exitProgress")`
 * 铺一张全屏「正在退出」遮罩，再在 window 捕获阶段拦下 keydown / beforeinput / paste / drop
 * 并 `stopImmediatePropagation()`，最后才发这一次 POST。也就是说我们的确认框弹出时，
 * 屏幕上还压着宿主的遮罩，键盘也已经被封锁：
 * - 遮罩：自己收掉（宿主随后用 `progressLoading({code:2})` 关的是 `?.remove()`，元素不在也不报错）；
 * - 键盘：在 mount 阶段就注册一个 window 捕获期 keydown，它比宿主那批晚注册的先执行，
 *   只把 Enter / Escape 交还给确认框，其余按键照旧让宿主封住（遮罩下面本来就不该能编辑）。
 */
const EXIT_PROGRESS_ID = "exitProgress";
/** 确认框（宿主的 `confirmDialog`）：`data-key` 与两个按钮 id 都是内核写死的。 */
const CONFIRM_DIALOG_SELECTOR = '[data-key="dialog-confirm"]';
const CONFIRM_BUTTON_ID = "confirmDialogConfirmBtn";
const CANCEL_BUTTON_ID = "cancelDialogConfirmBtn";

/** 收掉宿主那张「正在退出」遮罩；不在就什么也不做。 */
const dismissExitOverlay = (): void => {
    document.getElementById(EXIT_PROGRESS_ID)?.remove();
};

const urlOf = (input: RequestInfo | URL): string => {
    if (typeof input === "string") {
        return input;
    }
    if (input instanceof URL) {
        return input.href;
    }
    return input.url;
};

/** 这次请求是不是"退出应用"。 */
const isQuitRequest = (input: RequestInfo | URL, init?: RequestInit): boolean => {
    if (!urlOf(input).endsWith(EXIT_PATH) || (init?.method ?? "").toUpperCase() !== "POST") {
        return false;
    }
    if (typeof init?.body !== "string") {
        return false;
    }
    try {
        const body = JSON.parse(init.body) as {force?: unknown; setCurrentWorkspace?: unknown;};
        return body.force !== true && body.setCurrentWorkspace === true;
    } catch {
        return false;
    }
};

/** 「用户取消」在这次请求上的表达：旧宿主把它当作主动取消；新宿主会弹失败窗，由 `dismissExitFailure` 收掉。 */
const cancelled = (): DOMException => new DOMException("exit cancelled by the user", "AbortError");

/**
 * 取消之后收掉宿主新加的「退出等待失败」弹窗。
 *
 * 3.8.7-beta.4 起，宿主的退出请求改走 `requestSystemExit()`：它不再像原来的 `fetchPost`
 * 那样把 `AbortError` 当成静默取消，而是统一 catch 后弹一个「退出等待失败 / 重试」的窗口。
 * 我们仍然用 `AbortError` 表示取消，所以得在它出现时替用户点掉「关闭」，
 * 否则用户刚点完取消就会看到一个莫名其妙的失败提示。只关掉取消后 1 秒内出现的第一个
 * 同文案窗口：真正的退出失败发生在用户确认之后，正常不会落进这段窗口。
 */
const dismissExitFailure = (): void => {
    const text = window.siyuan?.languages?.exitWaitFailed;
    if (typeof text !== "string" || !text) {
        return;
    }
    let observer: MutationObserver | undefined;
    let timer = 0;
    const stop = () => {
        observer?.disconnect();
        observer = undefined;
        window.clearTimeout(timer);
        timer = 0;
    };
    const scan = () => {
        const dialogs = document.querySelectorAll<HTMLElement>(".b3-dialog");
        for (const dialog of dialogs) {
            const content = dialog.querySelector<HTMLElement>('.b3-dialog__content[role="alert"]');
            if (content?.textContent?.trim() !== text) {
                continue;
            }
            const close = dialog.querySelector<HTMLButtonElement>(".b3-dialog__action button");
            if (!close) {
                continue;
            }
            close.click();
            stop();
            return;
        }
    };
    observer = new MutationObserver(scan);
    observer.observe(document.body, {childList: true, subtree: true});
    timer = window.setTimeout(stop, 1000);
    scan();
};

/** 这次退出是不是用户在本窗口里发起的；不是就不问（见文件头）。 */
const fromWindow = (): boolean => isMobile() || (document.visibilityState === "visible" && document.hasFocus());

export const mountExitConfirm = (host: FeatureHost): FeatureInstance => {
    const original = window.fetch;
    /** 已经有一个确认框在等答复。 */
    let asking = false;

    const ask = (): Promise<boolean> =>
        new Promise((resolve) => {
            // 这个确认框无论是点取消、按 Esc、点遮罩还是点关闭，都会走到 cancel 回调
            confirm(
                host.i18n("feature.exitConfirm.dialogTitle"),
                host.i18n("feature.exitConfirm.text"),
                () => resolve(true),
                () => resolve(false),
            );
        });

    /** 把 Enter / Escape 交还给正在等的那个确认框；其余按键仍旧留给宿主的封锁。 */
    const onKeydown = (event: KeyboardEvent) => {
        if (!asking || event.isComposing) {
            return;
        }
        const buttonID = event.key === "Enter" ? CONFIRM_BUTTON_ID : event.key === "Escape" ? CANCEL_BUTTON_ID : "";
        if (!buttonID) {
            return;
        }
        const button = document.querySelector<HTMLElement>(`${CONFIRM_DIALOG_SELECTOR} #${buttonID}`);
        if (!button) {
            return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        button.click();
    };

    const patched = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        if (!isQuitRequest(input, init) || !fromWindow()) {
            return original.call(window, input, init);
        }
        if (asking) {
            // 不叠第二个确认框：这一次按取消处理
            return Promise.reject(cancelled());
        }
        asking = true;
        host.log.info("asking before the application quits");
        // 先收掉宿主的「正在退出」遮罩，否则用户是在遮罩上被问话
        dismissExitOverlay();
        return ask().then((confirmed) => {
            asking = false;
            if (!confirmed) {
                host.log.info("the user cancelled the quit");
                dismissExitFailure();
                return Promise.reject(cancelled());
            }
            host.log.info("the user confirmed the quit");
            return original.call(window, input, init);
        });
    };

    window.addEventListener("keydown", onKeydown, true);
    window.fetch = patched;

    return {
        destroy: () => {
            window.removeEventListener("keydown", onKeydown, true);
            // 只还原自己装上的那一个：期间可能已有别的代码换了 fetch
            if (window.fetch === patched) {
                window.fetch = original;
            }
        },
    };
};
