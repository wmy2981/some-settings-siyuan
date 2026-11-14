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

describe("退出应用前弹窗确认", () => {
    describe("认不认这次请求", () => {
        it("退出请求会先问一句，确认后把原来那次请求原样放行", async () => {
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

        it("确认框的标题与正文取自宿主的 i18n", async () => {
            stubFetch();
            mount({i18n: (key) => key === "feature.exitConfirm.dialogTitle" ? "退出思源" : "确定要退出思源吗？"});

            await window.fetch(EXIT_PATH, {method: "POST", body: exitBody()});

            expect(mockState.confirms[0]).toMatchObject({
                title: "退出思源",
                text: "确定要退出思源吗？",
            });
        });

        it("取消时以 AbortError 结束这次请求，内核的退出不会发生", async () => {
            const original = stubFetch();
            mockState.confirmAnswer = false;
            mount();

            // 宿主把 AbortError 当作「用户主动取消」：不回调、不提示、超时也不补一次退出
            await expect(window.fetch(EXIT_PATH, {method: "POST", body: exitBody()}))
                .rejects
                .toMatchObject({name: "AbortError", message: "exit cancelled by the user"});
            expect(original).not.toHaveBeenCalled();
        });

        it("带 force 的退出不问：用户已经在内核同步失败之后点过「强制退出」", async () => {
            const original = stubFetch();
            mount();

            await window.fetch(EXIT_PATH, {method: "POST", body: exitBody({force: true})});

            expect(mockState.confirms).toHaveLength(0);
            expect(original).toHaveBeenCalledTimes(1);
        });

        it("setCurrentWorkspace 不为 true 的不问：那是切换工作空间 / 重启这类应用内动作", async () => {
            const original = stubFetch();
            mount();

            await window.fetch(EXIT_PATH, {method: "POST", body: exitBody({setCurrentWorkspace: false})});
            await window.fetch(EXIT_PATH, {method: "POST", body: JSON.stringify({force: false})});

            expect(mockState.confirms).toHaveLength(0);
            expect(original).toHaveBeenCalledTimes(2);
        });

        it("路径不合、方法不是 POST、请求体不是 JSON 字符串时都直接放行", async () => {
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

        it("路径按后缀比对：URL 对象与 Request 形状的入参都能认出来", async () => {
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

    describe("什么时候问", () => {
        it("桌面端窗口不在前台时不问：点托盘菜单退出会先让窗口失焦", async () => {
            const original = stubFetch();
            vi.spyOn(document, "hasFocus").mockReturnValue(false);
            mount();

            await window.fetch(EXIT_PATH, {method: "POST", body: exitBody()});

            expect(mockState.confirms).toHaveLength(0);
            expect(original).toHaveBeenCalledTimes(1);
        });

        it("桌面端窗口被隐藏（已收进托盘）时不问", async () => {
            const original = stubFetch();
            Object.defineProperty(document, "visibilityState", {value: "hidden", configurable: true});
            mount();

            await window.fetch(EXIT_PATH, {method: "POST", body: exitBody()});

            expect(mockState.confirms).toHaveLength(0);
            expect(original).toHaveBeenCalledTimes(1);
        });

        it("移动端没有托盘，窗口状态不参与判断，照常发问", async () => {
            stubFetch();
            mockState.frontend = "mobile";
            Object.defineProperty(document, "visibilityState", {value: "hidden", configurable: true});
            vi.spyOn(document, "hasFocus").mockReturnValue(false);
            mount();

            await window.fetch(EXIT_PATH, {method: "POST", body: exitBody()});

            expect(mockState.confirms).toHaveLength(1);
        });

        it("已经有一个确认框在等答复时不叠加第二个，这一次按取消处理", async () => {
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

    describe("宿主的「正在退出」遮罩与失败窗口", () => {
        it("问话之前先收掉宿主的退出遮罩：否则用户是在「正在退出」上面被提问", async () => {
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

        it("取消之后点掉宿主新加的「退出等待失败」窗口", async () => {
            stubFetch();
            mockState.confirmAnswer = false;
            const siyuan = window.siyuan as unknown as {languages: Record<string, string>;};
            siyuan.languages.exitWaitFailed = "退出等待失败";
            mount();

            await expect(window.fetch(EXIT_PATH, {method: "POST", body: exitBody()}))
                .rejects
                .toMatchObject({name: "AbortError"});

            const failed = document.createElement("div");
            failed.className = "b3-dialog";
            failed.innerHTML = `<div class="b3-dialog__content" role="alert">退出等待失败</div>
                <div class="b3-dialog__action"><button type="button">关闭</button></div>`;
            const close = vi.fn();
            failed.querySelector("button")?.addEventListener("click", close);
            document.body.append(failed);

            // 观察器回调是微任务：追加节点之后先让微任务队列跑完
            await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
        });

        it("文案不匹配的窗口不点：真正的退出失败发生在确认之后，不该被顺手关掉", async () => {
            stubFetch();
            mockState.confirmAnswer = false;
            const siyuan = window.siyuan as unknown as {languages: Record<string, string>;};
            siyuan.languages.exitWaitFailed = "退出等待失败";
            mount();

            await expect(window.fetch(EXIT_PATH, {method: "POST", body: exitBody()}))
                .rejects
                .toMatchObject({name: "AbortError"});

            const other = document.createElement("div");
            other.className = "b3-dialog";
            other.innerHTML = `<div class="b3-dialog__content" role="alert">导出失败</div>
                <div class="b3-dialog__action"><button type="button">关闭</button></div>`;
            const close = vi.fn();
            other.querySelector("button")?.addEventListener("click", close);
            document.body.append(other);

            await Promise.resolve();
            await Promise.resolve();
            expect(close).not.toHaveBeenCalled();
        });

        it("宿主没有提供失败文案时完全不插手", async () => {
            stubFetch();
            mockState.confirmAnswer = false;
            mount();

            await expect(window.fetch(EXIT_PATH, {method: "POST", body: exitBody()}))
                .rejects
                .toMatchObject({name: "AbortError"});

            const failed = document.createElement("div");
            failed.className = "b3-dialog";
            failed.innerHTML = `<div class="b3-dialog__content" role="alert">退出等待失败</div>
                <div class="b3-dialog__action"><button type="button">关闭</button></div>`;
            const close = vi.fn();
            failed.querySelector("button")?.addEventListener("click", close);
            document.body.append(failed);

            await Promise.resolve();
            await Promise.resolve();
            expect(close).not.toHaveBeenCalled();
        });

        it("只在这个 1 秒窗口内认这个窗口，之后不再碰", async () => {
            vi.useFakeTimers();
            stubFetch();
            mockState.confirmAnswer = false;
            const siyuan = window.siyuan as unknown as {languages: Record<string, string>;};
            siyuan.languages.exitWaitFailed = "退出等待失败";
            mount();

            await expect(window.fetch(EXIT_PATH, {method: "POST", body: exitBody()}))
                .rejects
                .toMatchObject({name: "AbortError"});

            vi.advanceTimersByTime(1001);
            const late = document.createElement("div");
            late.className = "b3-dialog";
            late.innerHTML = `<div class="b3-dialog__content" role="alert">退出等待失败</div>
                <div class="b3-dialog__action"><button type="button">关闭</button></div>`;
            const close = vi.fn();
            late.querySelector("button")?.addEventListener("click", close);
            document.body.append(late);

            await Promise.resolve();
            await Promise.resolve();
            expect(close).not.toHaveBeenCalled();
        });
    });

    describe("宿主的键盘封锁", () => {
        it("Enter 交给确认框的「确定」按钮，并吃掉这次按键", async () => {
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

        it("Escape 交给「取消」按钮", async () => {
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

        it("没有在等答复时，Enter / Escape 一律不碰（宿主那批封锁照旧生效）", () => {
            const {yesClick, noClick} = confirmDialog();
            mount();

            const enter = new KeyboardEvent("keydown", {key: "Enter", cancelable: true});
            window.dispatchEvent(enter);

            expect(yesClick).not.toHaveBeenCalled();
            expect(noClick).not.toHaveBeenCalled();
            expect(enter.defaultPrevented).toBe(false);
        });

        it("其余按键原样留给宿主的封锁：遮罩下面本来就不该能编辑", () => {
            stubFetch();
            const {yesClick} = confirmDialog();
            mount();
            void window.fetch(EXIT_PATH, {method: "POST", body: exitBody()});

            const tab = new KeyboardEvent("keydown", {key: "Tab", cancelable: true});
            window.dispatchEvent(tab);

            expect(yesClick).not.toHaveBeenCalled();
            expect(tab.defaultPrevented).toBe(false);
        });

        it("输入法组字期间的 Enter 不碰：那是用户在选词，不是确认", () => {
            stubFetch();
            const {yesClick} = confirmDialog();
            mount();
            void window.fetch(EXIT_PATH, {method: "POST", body: exitBody()});

            const composing = new KeyboardEvent("keydown", {key: "Enter", isComposing: true, cancelable: true});
            window.dispatchEvent(composing);

            expect(yesClick).not.toHaveBeenCalled();
            expect(composing.defaultPrevented).toBe(false);
        });

        it("确认框还没进 DOM 时不拦按键（否则 Enter 会被无谓地吞掉）", () => {
            stubFetch();
            mount();
            void window.fetch(EXIT_PATH, {method: "POST", body: exitBody()});

            const enter = new KeyboardEvent("keydown", {key: "Enter", cancelable: true});
            window.dispatchEvent(enter);

            expect(enter.defaultPrevented).toBe(false);
        });
    });

    describe("卸载", () => {
        it("卸载后还原自己装上的 fetch，并且在途的按键不再被转交", () => {
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

        it("期间已有别的代码换了 fetch 时不动它", () => {
            stubFetch();
            const current = mount();
            const other = vi.fn();
            window.fetch = other as unknown as typeof window.fetch;

            current.dispose();

            expect(window.fetch).toBe(other);
        });

        it("卸载两次是幂等的", () => {
            const original = stubFetch();
            const current = mount();

            current.dispose();
            current.dispose();

            expect(window.fetch).toBe(original);
        });
    });

    describe("开关（适用端）", () => {
        it("默认「禁用」时不生效", () => {
            expect(exitConfirm.isEnabled?.({scope: "disabled"})).toBe(false);
            expect(exitConfirm.isEnabled?.({})).toBe(false);
        });

        it("选了只适用另一端的选项时，这一端不生效", () => {
            mockState.frontend = "desktop";
            expect(exitConfirm.isEnabled?.({scope: "desktop"})).toBe(true);
            expect(exitConfirm.isEnabled?.({scope: "mobile"})).toBe(false);

            mockState.frontend = "mobile";
            expect(exitConfirm.isEnabled?.({scope: "mobile"})).toBe(true);
            expect(exitConfirm.isEnabled?.({scope: "desktop"})).toBe(false);
        });

        it("选「两端」时两端都生效", () => {
            for (const frontend of ["desktop", "desktop-window", "mobile", "browser-mobile"]) {
                mockState.frontend = frontend;
                expect(exitConfirm.isEnabled?.({scope: "both"})).toBe(true);
            }
        });
    });
});
