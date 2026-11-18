/**
 * 退出应用前弹窗确认。
 *
 * 这个功能守的是渲染进程发出的那一次 `POST /api/system/exit`，所以测试全部从
 * 「替换掉 window.fetch 之后，某一次请求会不会被问一句」这个角度切入：
 * - 认哪些请求（路径、方法、请求体三个条件缺一不可）；
 * - 只有在「本窗口里发起」时才问（桌面端看窗口状态，移动端没有托盘所以照常问）；
 * - 取消用 `AbortError` 表达，并且要把宿主新加的「退出等待失败」窗口点掉；
 * - 宿主的退出遮罩要在问话之前收掉，否则用户是在「正在退出」上面被提问；
 * - 宿主的键盘封锁要用 capture 期的 keydown 抢回 Enter / Escape；
 * - 卸载时只还原自己装上的那个 fetch，且监听全部摘掉。
 */
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import exitConfirm from "../../src/features/exit-confirm/index";
import type {HostHarness} from "../helpers/feature-host";
import {mountFeature} from "../helpers/feature-host";
import {mockState} from "../mocks/siyuan";

/** 内核的退出接口；功能只认这个后缀。 */
const EXIT_PATH = "/api/system/exit";

/** 退出请求的请求体：`setCurrentWorkspace: true` 才代表「真的退出应用」。 */
const exitBody = (extra: Record<string, unknown> = {}): string =>
    JSON.stringify({force: false, setCurrentWorkspace: true, ...extra});

/** 宿主原本的 fetch：装上记录函数，才能断言「放行时真的走了原来那条路」。 */
const stubFetch = () => {
    // 入参写在泛型上：这里要断言「放行的是同一次请求」的 URL 与 init，
    // 而 `vi.fn(async () => …)` 的 calls 会被推成空元组
    const original = vi.fn<(...args: [string, RequestInit]) => Promise<Response>>(
        async () => ({ok: true}) as unknown as Response,
    );
    window.fetch = original as unknown as typeof window.fetch;
    return original;
};

/** 造一个与宿主一致的确认框：`data-key` 与两个按钮 id 都是内核写死的。 */
const confirmDialog = (withButtons = true) => {
    const dialog = document.createElement("div");
    dialog.setAttribute("data-key", "dialog-confirm");
    dialog.innerHTML = withButtons ?
        `<button id="confirmDialogConfirmBtn" type="button"></button>
         <button id="cancelDialogConfirmBtn" type="button"></button>` :
        "";
    document.body.append(dialog);
    const yesClick = vi.fn();
    const noClick = vi.fn();
    dialog.querySelector("#confirmDialogConfirmBtn")?.addEventListener("click", yesClick);
    dialog.querySelector("#cancelDialogConfirmBtn")?.addEventListener("click", noClick);
    return {dialog, yesClick, noClick};
};

/**
 * 本测试创建的 MutationObserver。
 *
 * `dismissExitFailure` 的观察器要挂满 1 秒才自己收，而 `tests/setup.ts` 只清 DOM：
 * 上一条用例留下的观察器会盯着下一条用例里刚追加的「退出等待失败」窗口，
 * 把它当成自己该点的那一个。这里记下实例，逐条用例结束时全部 disconnect。
 */
const createdObservers: MutationObserver[] = [];
const RealMutationObserver = globalThis.MutationObserver;

class TrackedMutationObserver extends RealMutationObserver {
    constructor(callback: MutationCallback) {
        super(callback);
        createdObservers.push(this);
    }
}

let harness: HostHarness | undefined;

const mount = (options?: Parameters<typeof mountFeature>[1]) => (harness = mountFeature(exitConfirm, options));

beforeEach(() => {
    vi.stubGlobal("MutationObserver", TrackedMutationObserver);
});

afterEach(() => {
    createdObservers.splice(0).forEach((observer) => observer.disconnect());
    vi.unstubAllGlobals();
    harness?.dispose();
    harness = undefined;
    vi.useRealTimers();
    // `visibilityState` 是原型上的 getter，逐条测试用 defineProperty 盖掉，这里把影子属性删掉
    delete (document as unknown as Record<string, unknown>).visibilityState;
});

describe("Confirmation dialog before exiting the app", () => {
    describe("whether the request is recognised", () => {
        it("asks first for an exit request and lets the original request through unchanged once confirmed", async () => {
            const original = stubFetch();
            mount();

            const response = await window.fetch(EXIT_PATH, {method: "POST", body: exitBody()});

            expect(mockState.confirms).toHaveLength(1);
            expect(mockState.confirms[0]).toMatchObject({accepted: true});
            // 放行的必须是同一次请求：换一条路径或漏掉 init，内核的退出就丢了
            expect(original).toHaveBeenCalledTimes(1);
            expect(original.mock.calls[0][0]).toBe(EXIT_PATH);
            expect(original.mock.calls[0][1]).toMatchObject({method: "POST"});
            expect(await response).toEqual({ok: true});
        });

        it("takes the dialog title and text from the host i18n", async () => {
            stubFetch();
            mount({
                i18n: (key) =>
                    key === "feature.exitConfirm.dialogTitle" ? "Exit SiYuan" : "Are you sure you want to exit SiYuan?",
            });

            await window.fetch(EXIT_PATH, {method: "POST", body: exitBody()});

            expect(mockState.confirms[0]).toMatchObject({
                title: "Exit SiYuan",
                text: "Are you sure you want to exit SiYuan?",
            });
        });

        it("ends the request with an AbortError on cancel so the kernel never exits", async () => {
            const original = stubFetch();
            mockState.confirmAnswer = false;
            mount();

            // 宿主把 AbortError 当作「用户主动取消」：不回调、不提示、超时也不补一次退出
            await expect(window.fetch(EXIT_PATH, {method: "POST", body: exitBody()}))
                .rejects
                .toMatchObject({name: "AbortError", message: "exit cancelled by the user"});
            expect(original).not.toHaveBeenCalled();
        });

        it("does not ask for a forced exit: the user already clicked force quit after a kernel sync failure", async () => {
            const original = stubFetch();
            mount();

            await window.fetch(EXIT_PATH, {method: "POST", body: exitBody({force: true})});

            expect(mockState.confirms).toHaveLength(0);
            expect(original).toHaveBeenCalledTimes(1);
        });

        it("does not ask when setCurrentWorkspace is not true: that is a workspace switch or a restart", async () => {
            const original = stubFetch();
            mount();

            await window.fetch(EXIT_PATH, {method: "POST", body: exitBody({setCurrentWorkspace: false})});
            await window.fetch(EXIT_PATH, {method: "POST", body: JSON.stringify({force: false})});

            expect(mockState.confirms).toHaveLength(0);
            expect(original).toHaveBeenCalledTimes(2);
        });

        it("passes through when the path, the method or the JSON body does not match", async () => {
            const original = stubFetch();
            mount();

            await window.fetch("/api/block/getBlock", {method: "POST", body: exitBody()});
            await window.fetch(EXIT_PATH, {body: exitBody()});
            await window.fetch(EXIT_PATH, {method: "GET", body: exitBody()});
            // 内核有时用 FormData / 空 body 发同一个路径，解析不了就不能拦
            await window.fetch(EXIT_PATH, {method: "POST"});
            await window.fetch(EXIT_PATH, {method: "POST", body: "not-json"});

            expect(mockState.confirms).toHaveLength(0);
            expect(original).toHaveBeenCalledTimes(5);
        });

        it("matches the path by suffix so URL objects and request-shaped arguments are both recognised", async () => {
            stubFetch();
            mount();

            await window.fetch(new URL("http://127.0.0.1:6806/api/system/exit"), {
                method: "POST",
                body: exitBody(),
            });
            await window.fetch(
                {url: "http://127.0.0.1:6806/api/system/exit"} as unknown as RequestInfo,
                {method: "POST", body: exitBody()},
            );

            expect(mockState.confirms).toHaveLength(2);
        });
    });

    describe("when it asks", () => {
        it("does not ask when the desktop window is not focused: exiting from the tray blurs it first", async () => {
            const original = stubFetch();
            vi.spyOn(document, "hasFocus").mockReturnValue(false);
            mount();

            await window.fetch(EXIT_PATH, {method: "POST", body: exitBody()});

            expect(mockState.confirms).toHaveLength(0);
            expect(original).toHaveBeenCalledTimes(1);
        });

        it("does not ask when the desktop window is hidden (moved to the tray)", async () => {
            const original = stubFetch();
            Object.defineProperty(document, "visibilityState", {value: "hidden", configurable: true});
            mount();

            await window.fetch(EXIT_PATH, {method: "POST", body: exitBody()});

            expect(mockState.confirms).toHaveLength(0);
            expect(original).toHaveBeenCalledTimes(1);
        });

        it("always asks on mobile, where there is no tray and window state does not matter", async () => {
            stubFetch();
            mockState.frontend = "mobile";
            Object.defineProperty(document, "visibilityState", {value: "hidden", configurable: true});
            vi.spyOn(document, "hasFocus").mockReturnValue(false);
            mount();

            await window.fetch(EXIT_PATH, {method: "POST", body: exitBody()});

            expect(mockState.confirms).toHaveLength(1);
        });

        it("does not stack a second dialog while one is pending and treats this request as cancelled", async () => {
            const original = stubFetch();
            mount();

            // 第一个请求的 ask() 还停在微任务里（asking 仍为 true）时发第二个
            const first = window.fetch(EXIT_PATH, {method: "POST", body: exitBody()});
            const second = window.fetch(EXIT_PATH, {method: "POST", body: exitBody()});

            await expect(second).rejects.toMatchObject({name: "AbortError"});
            await expect(first).resolves.toEqual({ok: true});
            expect(mockState.confirms).toHaveLength(1);
            expect(original).toHaveBeenCalledTimes(1);
        });
    });

    describe("the host exiting overlay and failure dialog", () => {
        it("dismisses the host exit overlay before asking, so the user is not asked on top of an exiting screen", async () => {
            stubFetch();
            const overlay = document.createElement("div");
            overlay.id = "exitProgress";
            document.body.append(overlay);
            // confirm 被调用的那一刻遮罩必须已经不在：确认框出现时屏幕上不能压着它
            const originalConfirms = mockState.confirms;
            const overlayAtAsk: boolean[] = [];
            mockState.confirms = {
                push: (call) => {
                    overlayAtAsk.push(document.getElementById("exitProgress") !== null);
                    originalConfirms.push(call);
                },
            } as unknown as typeof mockState.confirms;
            mount();

            await window.fetch(EXIT_PATH, {method: "POST", body: exitBody()});

            expect(overlayAtAsk).toEqual([false]);
            expect(document.getElementById("exitProgress")).toBeNull();
        });

        it("clicks away the host exit-wait-failed dialog added after a cancel", async () => {
            stubFetch();
            mockState.confirmAnswer = false;
            const siyuan = window.siyuan as unknown as {languages: Record<string, string>;};
            siyuan.languages.exitWaitFailed = "exit wait failed";
            mount();

            await expect(window.fetch(EXIT_PATH, {method: "POST", body: exitBody()}))
                .rejects
                .toMatchObject({name: "AbortError"});

            const failed = document.createElement("div");
            failed.className = "b3-dialog";
            failed.innerHTML = `<div class="b3-dialog__content" role="alert">exit wait failed</div>
                <div class="b3-dialog__action"><button type="button">close</button></div>`;
            const close = vi.fn();
            failed.querySelector("button")?.addEventListener("click", close);
            document.body.append(failed);

            // 观察器回调是微任务：追加节点之后先让微任务队列跑完
            await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
        });

        it("does not click a dialog with different text: a real exit failure happens after confirmation", async () => {
            stubFetch();
            mockState.confirmAnswer = false;
            const siyuan = window.siyuan as unknown as {languages: Record<string, string>;};
            siyuan.languages.exitWaitFailed = "exit wait failed";
            mount();

            await expect(window.fetch(EXIT_PATH, {method: "POST", body: exitBody()}))
                .rejects
                .toMatchObject({name: "AbortError"});

            const other = document.createElement("div");
            other.className = "b3-dialog";
            other.innerHTML = `<div class="b3-dialog__content" role="alert">export failed</div>
                <div class="b3-dialog__action"><button type="button">close</button></div>`;
            const close = vi.fn();
            other.querySelector("button")?.addEventListener("click", close);
            document.body.append(other);

            await Promise.resolve();
            await Promise.resolve();
            expect(close).not.toHaveBeenCalled();
        });

        it("does not interfere at all when the host provides no failure text", async () => {
            stubFetch();
            mockState.confirmAnswer = false;
            mount();

            await expect(window.fetch(EXIT_PATH, {method: "POST", body: exitBody()}))
                .rejects
                .toMatchObject({name: "AbortError"});

            const failed = document.createElement("div");
            failed.className = "b3-dialog";
            failed.innerHTML = `<div class="b3-dialog__content" role="alert">exit wait failed</div>
                <div class="b3-dialog__action"><button type="button">close</button></div>`;
            const close = vi.fn();
            failed.querySelector("button")?.addEventListener("click", close);
            document.body.append(failed);

            await Promise.resolve();
            await Promise.resolve();
            expect(close).not.toHaveBeenCalled();
        });

        it("only recognises that dialog during the 1 second window and never afterwards", async () => {
            vi.useFakeTimers();
            stubFetch();
            mockState.confirmAnswer = false;
            const siyuan = window.siyuan as unknown as {languages: Record<string, string>;};
            siyuan.languages.exitWaitFailed = "exit wait failed";
            mount();

            await expect(window.fetch(EXIT_PATH, {method: "POST", body: exitBody()}))
                .rejects
                .toMatchObject({name: "AbortError"});

            vi.advanceTimersByTime(1001);
            const late = document.createElement("div");
            late.className = "b3-dialog";
            late.innerHTML = `<div class="b3-dialog__content" role="alert">exit wait failed</div>
                <div class="b3-dialog__action"><button type="button">close</button></div>`;
            const close = vi.fn();
            late.querySelector("button")?.addEventListener("click", close);
            document.body.append(late);

            await Promise.resolve();
            await Promise.resolve();
            expect(close).not.toHaveBeenCalled();
        });
    });

    describe("the host keyboard lock", () => {
        it("hands Enter to the dialog confirm button and swallows the keypress", async () => {
            stubFetch();
            const {yesClick} = confirmDialog();
            mount();
            // 不断言这次请求的结局，只要求「问话还在等」这个窗口期
            const pending = window.fetch(EXIT_PATH, {method: "POST", body: exitBody()});
            const afterOurListener = vi.fn();
            // 同一节点同一阶段按注册顺序执行：我们在 mount 时先注册，所以能挡住后来者
            window.addEventListener("keydown", afterOurListener, true);

            const enter = new KeyboardEvent("keydown", {key: "Enter", cancelable: true});
            window.dispatchEvent(enter);

            expect(yesClick).toHaveBeenCalledTimes(1);
            expect(enter.defaultPrevented).toBe(true);
            expect(afterOurListener).not.toHaveBeenCalled();
            await pending;
        });

        it("hands Escape to the cancel button", async () => {
            stubFetch();
            const {noClick} = confirmDialog();
            mount();
            const pending = window.fetch(EXIT_PATH, {method: "POST", body: exitBody()});

            const escape = new KeyboardEvent("keydown", {key: "Escape", cancelable: true});
            window.dispatchEvent(escape);

            expect(noClick).toHaveBeenCalledTimes(1);
            expect(escape.defaultPrevented).toBe(true);
            await pending;
        });

        it("never touches Enter or Escape while nothing is pending (the host lock still applies)", () => {
            const {yesClick, noClick} = confirmDialog();
            mount();

            const enter = new KeyboardEvent("keydown", {key: "Enter", cancelable: true});
            window.dispatchEvent(enter);

            expect(yesClick).not.toHaveBeenCalled();
            expect(noClick).not.toHaveBeenCalled();
            expect(enter.defaultPrevented).toBe(false);
        });

        it("leaves other keys to the host lock: nothing under the overlay should be editable anyway", () => {
            stubFetch();
            const {yesClick} = confirmDialog();
            mount();
            void window.fetch(EXIT_PATH, {method: "POST", body: exitBody()});

            const tab = new KeyboardEvent("keydown", {key: "Tab", cancelable: true});
            window.dispatchEvent(tab);

            expect(yesClick).not.toHaveBeenCalled();
            expect(tab.defaultPrevented).toBe(false);
        });

        it("leaves Enter alone during IME composition: that is word selection, not confirmation", () => {
            stubFetch();
            const {yesClick} = confirmDialog();
            mount();
            void window.fetch(EXIT_PATH, {method: "POST", body: exitBody()});

            const composing = new KeyboardEvent("keydown", {key: "Enter", isComposing: true, cancelable: true});
            window.dispatchEvent(composing);

            expect(yesClick).not.toHaveBeenCalled();
            expect(composing.defaultPrevented).toBe(false);
        });

        it("does not intercept keys before the dialog is in the DOM (Enter would be swallowed for nothing)", () => {
            stubFetch();
            mount();
            void window.fetch(EXIT_PATH, {method: "POST", body: exitBody()});

            const enter = new KeyboardEvent("keydown", {key: "Enter", cancelable: true});
            window.dispatchEvent(enter);

            expect(enter.defaultPrevented).toBe(false);
        });
    });

    describe("unmount", () => {
        it("restores the fetch it installed and stops forwarding in-flight keys after unmount", () => {
            const original = stubFetch();
            const {yesClick} = confirmDialog();
            const current = mount();
            expect(window.fetch).not.toBe(original);

            const pending = window.fetch(EXIT_PATH, {method: "POST", body: exitBody()});
            current.dispose();

            expect(window.fetch).toBe(original);
            window.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", cancelable: true}));
            expect(yesClick).not.toHaveBeenCalled();
            return pending;
        });

        it("leaves a fetch replaced by other code alone", () => {
            stubFetch();
            const current = mount();
            const other = vi.fn();
            window.fetch = other as unknown as typeof window.fetch;

            current.dispose();

            expect(window.fetch).toBe(other);
        });

        it("unmounting twice is idempotent", () => {
            const original = stubFetch();
            const current = mount();

            current.dispose();
            current.dispose();

            expect(window.fetch).toBe(original);
        });
    });

    describe("switch (target frontend)", () => {
        it("does nothing with the default disabled scope", () => {
            expect(exitConfirm.isEnabled?.({scope: "disabled"})).toBe(false);
            expect(exitConfirm.isEnabled?.({})).toBe(false);
        });

        it("does nothing on one frontend when the option targets the other one", () => {
            mockState.frontend = "desktop";
            expect(exitConfirm.isEnabled?.({scope: "desktop"})).toBe(true);
            expect(exitConfirm.isEnabled?.({scope: "mobile"})).toBe(false);

            mockState.frontend = "mobile";
            expect(exitConfirm.isEnabled?.({scope: "mobile"})).toBe(true);
            expect(exitConfirm.isEnabled?.({scope: "desktop"})).toBe(false);
        });

        it("applies on both frontends with the both option", () => {
            for (const frontend of ["desktop", "desktop-window", "mobile", "browser-mobile"]) {
                mockState.frontend = frontend;
                expect(exitConfirm.isEnabled?.({scope: "both"})).toBe(true);
            }
        });
    });
});
