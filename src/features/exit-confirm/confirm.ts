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

/** 「用户取消」在这次请求上的表达：宿主把它当作主动取消，静默结束。 */
const cancelled = (): DOMException => new DOMException("exit cancelled by the user", "AbortError");

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
                host.i18n("exitConfirm.title"),
                host.i18n("exitConfirm.text"),
                () => resolve(true),
                () => resolve(false),
            );
        });

    const patched = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        if (!isQuitRequest(input, init) || !fromWindow()) {
            return original.call(window, input, init);
        }
        if (asking) {
            // 不叠第二个确认框：这一次按取消处理
            return Promise.reject(cancelled());
        }
        asking = true;
        return ask().then((confirmed) => {
            asking = false;
            if (!confirmed) {
                return Promise.reject(cancelled());
            }
            return original.call(window, input, init);
        });
    };

    window.fetch = patched;

    return {
        destroy: () => {
            // 只还原自己装上的那一个：期间可能已有别的代码换了 fetch
            if (window.fetch === patched) {
                window.fetch = original;
            }
        },
    };
};
