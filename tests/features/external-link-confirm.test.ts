/**
 * 外链跳转前确认。
 *
 * 拦截点在宿主的 `open-link` 插件事件上（点击与键盘两条路都经过它），所以测试从
 * 「派发一条 open-link，看有没有弹窗、有没有 preventDefault」切入，再逐个点弹窗里的按钮：
 * - 只拦 http/https，站内资源与 siyuan:// 一律放行；
 * - 弹窗里必须能看见完整链接，并且链接文本按 HTML 转义；
 * - 取消 = 销毁 + 取消这一次跳转；打开 = 销毁 + 找原链接补一次同样的 click
 *   （补发时用绕过标记，不能自己再拦一次），链接已不在文档里才退回 window.open；
 * - 复制走 core/clipboard，成功 / 失败都要有提示；
 * - 卸载时收掉还开着的弹窗。
 */
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import externalLinkConfirm from "../../src/features/external-link-confirm/index";
import type {
    HostHarness,
    HostRecords,
} from "../helpers/feature-host";
import {mountFeature} from "../helpers/feature-host";

/**
 * 只给 `Dialog` 补一处宿主行为：真正的 `Dialog.destroy()` 会调用
 * `destroyCallback`（功能就是靠它把 `dialog` 引用清掉的），而共享替身没有转发它。
 *
 * 不补这一处的后果很具体：取消一次之后功能仍以为有弹窗在等答复，
 * 之后所有外链都只会被静默拦下、再也不弹窗。其余成员原样沿用共享替身。
 */
vi.mock("siyuan", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../mocks/siyuan")>();
    class Dialog extends actual.Dialog {
        private readonly options: {destroyCallback?: () => void;};

        constructor(options: {content?: string; destroyCallback?: () => void;} = {}) {
            super(options);
            this.options = options;
        }

        override destroy(): void {
            super.destroy();
            this.options.destroyCallback?.();
        }
    }

    return {...actual, Dialog};
});

/**
 * jsdom（在 vitest 里连 `document.defaultView` 也一样）不接受
 * `new MouseEvent("click", {view: window})`，直接抛「member view is not of type Window」。
 * 功能按内核的原样补发 click 时必定带 `view`，所以这里把构造器包一层：丢掉 `view`，
 * 其余参数照原样传入。用子类而不是普通函数，是为了让功能里的 `source instanceof MouseEvent`
 * 对测试造出来的事件仍然成立（它靠这个读修饰键）。
 */
const RealMouseEvent = globalThis.MouseEvent;

class ViewlessMouseEvent extends RealMouseEvent {
    constructor(type: string, init: MouseEventInit = {}) {
        // 只把 view 摘掉（jsdom 的合成事件不该带 window 引用），其余原样传下去
        const rest = {...init};
        delete rest.view;
        super(type, rest);
    }
}

interface OpenLinkDetail {
    href?: string;
    originalHref?: string;
    event?: MouseEvent | KeyboardEvent;
}

let harness: HostHarness | undefined;

const mount = (config?: Record<string, unknown>) => (harness = mountFeature(externalLinkConfirm, {config}));

beforeEach(() => {
    vi.stubGlobal("MouseEvent", ViewlessMouseEvent);
});

afterEach(() => {
    vi.unstubAllGlobals();
    harness?.dispose();
    harness = undefined;
    // navigator.clipboard 是逐条测试按需装上去的影子属性
    delete (navigator as unknown as Record<string, unknown>).clipboard;
});

/** 取本功能注册的 `open-link` 监听器。 */
const listenerOf = (records: HostRecords) => {
    const record = records.bus.find((item) => item.type === "open-link");
    if (!record) {
        throw new Error("external-link-confirm 没有注册 open-link 监听器");
    }
    return record.listener;
};

/**
 * 以「内核的身份」派发一条 open-link。
 *
 * 自己建事件而不用 `harness.emitBus`：只有 `cancelable: true` 的事件才能观察到
 * `preventDefault()` —— 这正是「这次跳转被拦下来了」的唯一证据。
 */
const emitOpenLink = (records: HostRecords, detail: OpenLinkDetail): CustomEvent => {
    const event = new CustomEvent("open-link", {detail, cancelable: true});
    listenerOf(records)(event);
    return event;
};

/** `new Dialog()` 在替身里往 body 追加的外层容器。 */
const dialogElement = (): HTMLElement | null => {
    const dialogs = document.body.querySelectorAll<HTMLElement>(".b3-dialog");
    return dialogs.length === 1 ? dialogs[0] : null;
};

/** 在文档里造一个正文里的链接（思源的链接是 `span[data-type="a"][data-href]`）。 */
const linkInDocument = (href: string): HTMLSpanElement => {
    const link = document.createElement("span");
    link.dataset.type = "a";
    link.dataset.href = href;
    link.textContent = "链接";
    document.body.append(link);
    return link;
};

/** 造一条「用户点了这个链接」的原始事件。 */
const clickOn = (element: Element, init: MouseEventInit = {}): MouseEvent => {
    const event = new MouseEvent("click", {bubbles: true, cancelable: true, ...init});
    element.dispatchEvent(event);
    return event;
};

describe("外链跳转前确认", () => {
    describe("样式", () => {
        it("注入弹窗自己那套 CSS，卸载后连 <style> 一起收走", () => {
            mount();

            const css = harness?.css() ?? "";
            // 链接块必须允许长链接折行、可选中，并且自己滚而不是把弹窗撑破
            expect(css).toContain(".ss-external-link__head");
            expect(css).toContain("flex-wrap: wrap");
            expect(css).toContain(".ss-external-link__url");
            expect(css).toContain("max-height: 30vh");
            expect(css).toContain("word-break: break-all");
            expect(css).toContain("user-select: text");
            expect(harness?.styleElement()?.textContent).toBe(css);

            harness?.dispose();
            expect(harness?.styleElement()).toBeNull();
        });
    });

    describe("弹窗内容", () => {
        it("弹窗里显示完整链接，取消 / 打开 / 复制三个按钮都在", () => {
            mount();

            const event = emitOpenLink(harness!.records, {href: "https://example.com/a/b?c=1"});

            expect(event.defaultPrevented).toBe(true);
            const dialog = dialogElement();
            expect(dialog).not.toBeNull();
            // 用户要能核对「到底要打开哪个地址」，所以这里是链接原文而不是域名
            expect(dialog?.querySelector(".ss-external-link__url")?.textContent)
                .toBe("https://example.com/a/b?c=1");
            expect(dialog?.querySelector(".ss-external-link__prompt")?.textContent)
                .toBe("feature.externalLinkConfirm.prompt");
            const copy = dialog?.querySelector<HTMLElement>("[data-ss-copy-link]");
            expect(copy?.querySelector("use")?.getAttribute("xlink:href")).toBe("#iconCopy");
            expect(copy?.textContent?.trim()).toBe("feature.externalLinkConfirm.copy");
            expect(dialog?.querySelector("[data-ss-cancel-link]")?.textContent).toBe("common.cancel");
            expect(dialog?.querySelector("[data-ss-open-link]")?.textContent).toBe("feature.externalLinkConfirm.open");
        });

        it("链接文本按 HTML 转义：网址里的 & 与引号不能把弹窗结构冲掉", () => {
            mount();

            emitOpenLink(harness!.records, {href: 'https://example.com/?a=1&b="x"<y>'});

            const url = dialogElement()?.querySelector<HTMLElement>(".ss-external-link__url");
            // 显示的是原文（实体在解析后还原成字符），但 innerHTML 里必须是实体
            expect(url?.textContent).toBe('https://example.com/?a=1&b="x"<y>');
            expect(url?.innerHTML).toContain("&amp;");
            expect(url?.innerHTML).toContain("&lt;");
            // 没有子元素：说明标签被当成了文本，而不是被解析成结构
            expect(url?.children).toHaveLength(0);
        });

        it("弹窗预热：容器在入场前就挂上图层类", () => {
            mount();

            emitOpenLink(harness!.records, {href: "https://example.com/"});

            // 宿主的 b3-dialog--open 是 50ms 后才加的，预热必须同步完成
            expect(
                dialogElement()?.parentElement?.querySelector(".b3-dialog__container")
                    ?.classList.contains("some-settings-layer"),
            ).toBe(true);
            expect(document.getElementById("some-settings-layer-local-css")).not.toBeNull();
        });
    });

    describe("拦哪些链接", () => {
        it("href 缺失时用 originalHref，仍然按外链处理", () => {
            mount();

            emitOpenLink(harness!.records, {originalHref: "https://example.com/original"});

            expect(dialogElement()?.querySelector(".ss-external-link__url")?.textContent)
                .toBe("https://example.com/original");
        });

        it("站内资源与 siyuan:// 一律放行：它们不经过系统浏览器，问了只会烦人", () => {
            mount();

            for (const href of ["assets/a.png", "siyuan://plugins/x", "mailto:a@b.c", ""]) {
                const event = emitOpenLink(harness!.records, {href});
                expect(event.defaultPrevented).toBe(false);
            }
            expect(dialogElement()).toBeNull();
        });

        it("已经在问的时候再来一次只取消跳转，不叠第二个弹窗", () => {
            mount();

            emitOpenLink(harness!.records, {href: "https://example.com/1"});
            const second = emitOpenLink(harness!.records, {href: "https://example.com/2"});

            // 第二次仍然要 preventDefault，否则用户在确认框底下又跳走一次
            expect(second.defaultPrevented).toBe(true);
            expect(document.body.querySelectorAll(".b3-dialog")).toHaveLength(1);
            expect(dialogElement()?.querySelector(".ss-external-link__url")?.textContent)
                .toBe("https://example.com/1");
        });
    });

    describe("取消", () => {
        it("点取消销毁弹窗，并且这一次已经拦下的跳转不会发生", () => {
            mount();
            emitOpenLink(harness!.records, {href: "https://example.com/1"});

            dialogElement()?.querySelector<HTMLElement>("[data-ss-cancel-link]")?.click();

            expect(dialogElement()).toBeNull();
            expect(window.open).not.toHaveBeenCalled();
        });

        it("取消之后再点别的链接还能正常提问", () => {
            mount();
            emitOpenLink(harness!.records, {href: "https://example.com/1"});
            dialogElement()?.querySelector<HTMLElement>("[data-ss-cancel-link]")?.click();

            emitOpenLink(harness!.records, {href: "https://example.com/2"});

            expect(dialogElement()?.querySelector(".ss-external-link__url")?.textContent)
                .toBe("https://example.com/2");
        });
    });

    describe("打开", () => {
        it("点打开后销毁弹窗，并在原链接上补发一次同样的 click", () => {
            mount();
            const link = linkInDocument("https://example.com/x");
            const source = clickOn(link, {shiftKey: true, ctrlKey: true});
            emitOpenLink(harness!.records, {href: "https://example.com/x", event: source});

            const reclick = vi.fn();
            link.addEventListener("click", reclick);

            dialogElement()?.querySelector<HTMLElement>("[data-ss-open-link]")?.click();

            expect(dialogElement()).toBeNull();
            expect(reclick).toHaveBeenCalledTimes(1);
            const forwarded = reclick.mock.calls[0][0] as MouseEvent;
            // 修饰键要跟着走，否则「在新页签打开」这类意图就丢了
            expect(forwarded.shiftKey).toBe(true);
            expect(forwarded.ctrlKey).toBe(true);
            // 补发的是真的会冒泡的 click，内核那条 openLink 才会重新跑
            expect(forwarded.bubbles).toBe(true);
            expect(window.open).not.toHaveBeenCalled();
        });

        it("补发 click 时自己不再拦一次（绕过标记在同一帧内复位）", () => {
            mount();
            const link = linkInDocument("https://example.com/x");
            emitOpenLink(harness!.records, {href: "https://example.com/x", event: clickOn(link)});

            // 模拟内核：补发的那一次 click 会再次发出 open-link
            const seen: boolean[] = [];
            link.addEventListener("click", () => {
                const again = emitOpenLink(harness!.records, {href: "https://example.com/x", event: undefined});
                seen.push(again.defaultPrevented);
            });

            dialogElement()?.querySelector<HTMLElement>("[data-ss-open-link]")?.click();
            expect(seen).toEqual([false]);
            // 跳出去之后不能又冒出一个弹窗
            expect(document.body.querySelectorAll(".b3-dialog")).toHaveLength(0);
        });

        it("链接已经不在文档里时退回 window.open", () => {
            mount();
            const detached = document.createElement("span");
            detached.dataset.type = "a";
            detached.dataset.href = "https://example.com/gone";
            // 不挂进文档：模拟编辑器已经重绘，原链接元素成了孤儿
            const source = clickOn(detached);
            emitOpenLink(harness!.records, {
                href: "https://example.com/gone",
                event: source,
            });

            dialogElement()?.querySelector<HTMLElement>("[data-ss-open-link]")?.click();

            expect(window.open).toHaveBeenCalledWith("https://example.com/gone", "_blank");
        });

        it("事件里没有原始事件（键盘路径）时也走 window.open", () => {
            mount();
            emitOpenLink(harness!.records, {href: "https://example.com/kbd"});

            dialogElement()?.querySelector<HTMLElement>("[data-ss-open-link]")?.click();

            expect(window.open).toHaveBeenCalledWith("https://example.com/kbd", "_blank");
        });
    });

    describe("复制", () => {
        it("剪贴板可用时提示「已复制」", async () => {
            const writeText = vi.fn(async () => undefined);
            Object.defineProperty(navigator, "clipboard", {
                value: {writeText},
                configurable: true,
            });
            mount();
            emitOpenLink(harness!.records, {href: "https://example.com/copy?a=1"});

            dialogElement()?.querySelector<HTMLElement>("[data-ss-copy-link]")?.click();

            await vi.waitFor(() => expect(harness!.records.messages).toEqual(["common.copied"]));
            expect(writeText).toHaveBeenCalledWith("https://example.com/copy?a=1");
            // 复制不该收掉弹窗：用户还要接着决定打不打开
            expect(dialogElement()).not.toBeNull();
        });

        it("复制失败也要说一句，不能静默", async () => {
            // jsdom 里 navigator.clipboard 与 document.execCommand 都不存在，正好是失败路径
            mount();
            emitOpenLink(harness!.records, {href: "https://example.com/copy"});

            dialogElement()?.querySelector<HTMLElement>("[data-ss-copy-link]")?.click();

            await vi.waitFor(() => expect(harness!.records.messages).toEqual(["common.copyFailed"]));
        });
    });

    describe("卸载与清理", () => {
        it("卸载时收掉还开着的弹窗", () => {
            const current = mount();
            emitOpenLink(current.records, {href: "https://example.com/"});
            expect(dialogElement()).not.toBeNull();

            current.dispose();

            expect(document.body.querySelectorAll(".b3-dialog")).toHaveLength(0);
        });

        it("卸载后 bus 上的监听器被摘掉，再派发 open-link 也不弹窗", () => {
            const current = mount();
            current.dispose();

            expect(current.records.bus.filter((item) => item.type === "open-link")).toHaveLength(0);
            current.emitBus("open-link", {href: "https://example.com/"});
            expect(document.body.querySelectorAll(".b3-dialog")).toHaveLength(0);
        });

        it("重复销毁是幂等的", () => {
            const current = mount();
            emitOpenLink(current.records, {href: "https://example.com/"});

            current.dispose();
            current.dispose();

            expect(document.body.querySelectorAll(".b3-dialog")).toHaveLength(0);
        });
    });

    describe("开关", () => {
        it("默认关闭：配置里 enabled 的默认值是 false", () => {
            const enabled = externalLinkConfirm.settings.find((field) => field.key === "enabled");
            expect(enabled && "default" in enabled ? enabled.default : undefined).toBe(false);
        });
    });
});
