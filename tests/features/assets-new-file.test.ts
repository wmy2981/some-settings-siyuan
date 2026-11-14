/**
 * 斜杠命令「新建文件到 assets」（`assets-new-file`）的单元测试。
 *
 * 这个功能有一半是 DOM：斜杠命令打开自建 `Dialog`，用户在输入框里填名字、点创建。
 * 所以测试里既要有宿主替身（`mockState.fetchSyncPost` 驱动上传结果），也要有真的 DOM
 * （追加到 body 的对话框元素），还要有一个够用的 `Protyle` 桩 —— 被测代码只用到
 * `protyle.protyle.block` / `protyle.protyle.toolbar.range` 与 `protyle.insert()`。
 *
 * 局部替身（不改 `tests/mocks/siyuan.ts`）：宿主的 `Dialog` 替身没有转发 `destroyCallback`，
 * 而「上传期间用户点了取消」这条分支正是靠它在回调里置位，所以这里用 `vi.mock` 在
 * 原替身之上派生一个会转发 `destroyCallback` 并记录构造参数的 `Dialog`。
 */
import type {Protyle} from "siyuan";
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";

const recorder = vi.hoisted(() => ({dialogs: [] as {options: Record<string, any>; dialog: any;}[]}));

vi.mock("siyuan", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../mocks/siyuan")>();
    class Dialog extends actual.Dialog {
        private readonly options: Record<string, any>;

        constructor(options: Record<string, any> = {}) {
            super(options);
            this.options = options;
            recorder.dialogs.push({options, dialog: this});
        }

        destroy(): void {
            super.destroy();
            // 真实宿主在收掉弹窗时会走 destroyCallback；这里补上，否则测不到「上传中取消」
            this.options.destroyCallback?.();
        }
    }
    return {...actual, Dialog};
});

const {mockState} = await import("../mocks/siyuan");
const {mountFeature} = await import("../helpers/feature-host");
const {default: assetsNewFile} = await import("../../src/features/assets-new-file/index");
const {setDetailedLogging} = await import("../../src/core/log");

type Harness = ReturnType<typeof mountFeature>;

const I18N: Record<string, string> = {
    "feature.assetsNewFile.command": "新建文件到 assets",
    "feature.assetsNewFile.dialogTitle": "新建文件到 assets",
    "feature.assetsNewFile.tip": "输入文件名（可带任意后缀）。",
    "feature.assetsNewFile.placeholder": "例如：清单.txt",
    "feature.assetsNewFile.invalid": "文件名不能为空，也不能包含 / 或 \\",
    "feature.assetsNewFile.creating": "正在创建…",
    "feature.assetsNewFile.failed": "创建文件失败，请稍后再试",
    "feature.assetsNewFile.confirm": "创建",
    "common.cancel": "取消",
};

const i18n = (key: string): string => I18N[key] ?? key;

interface ProtyleStub {
    protyle: {
        block: {rootID?: string; id?: string;};
        toolbar?: {range?: Range;};
    };
    insert: ReturnType<typeof vi.fn>;
}

const createProtyle = (patch: {rootID?: string; id?: string; toolbar?: boolean;} = {}): ProtyleStub => {
    const block: {rootID?: string; id?: string;} = {rootID: "doc-1", id: "block-1"};
    if (patch.rootID !== undefined) {
        block.rootID = patch.rootID;
    }
    if (patch.id !== undefined) {
        block.id = patch.id;
    }
    return {
        protyle: {
            block,
            ...(patch.toolbar === false ? {} : {toolbar: {range: undefined as Range | undefined}}),
        },
        insert: vi.fn(),
    };
};

/** 把 Protyle 桩交出去（被测代码只认 `Protyle` 这个类型）。 */
const asProtyle = (stub: ProtyleStub): Protyle => stub as unknown as Protyle;

/** 让一串 Promise 链跑完（没有真实 I/O，几轮微任务就够）。 */
const flush = async (rounds = 12): Promise<void> => {
    for (let index = 0; index < rounds; index++) {
        await Promise.resolve();
    }
};

/** 一个可以手动兑现的内核响应，用来观察「请求还没落地」的中间状态。 */
const pendingResponse = () => {
    let resolve: (value: unknown) => void = () => undefined;
    const promise = new Promise<unknown>((done) => {
        resolve = done;
    });
    (mockState.fetchSyncPost as unknown as {mockReturnValue: (value: unknown) => void;}).mockReturnValue(promise);
    return {resolve};
};

const lastDialog = () => recorder.dialogs[recorder.dialogs.length - 1];

const partsOf = (harness: Harness, protyle: ProtyleStub) => {
    harness.records.slashes[0].callback(asProtyle(protyle), document.createElement("span"));
    const dialog = lastDialog().dialog;
    const element = dialog.element as HTMLElement;
    return {
        dialog,
        element,
        input: element.querySelector<HTMLInputElement>("[data-name]")!,
        confirm: element.querySelector<HTMLButtonElement>("[data-confirm]")!,
        cancel: element.querySelector<HTMLButtonElement>("[data-cancel]")!,
    };
};

describe("斜杠命令新建文件到 assets", () => {
    let harness: Harness;

    beforeEach(() => {
        recorder.dialogs = [];
        // 失败路径只通过 reportError 留下控制台记录，详细日志要显式打开
        setDetailedLogging(true);
        harness = mountFeature(assetsNewFile, {i18n});
        mockState.frontend = "desktop";
    });

    afterEach(() => {
        setDetailedLogging(false);
        harness.dispose();
        document.body.innerHTML = "";
    });

    it("注册一条斜杠命令：中英文与拼音首字母都能检索到，卸载时从宿主数组里摘掉", () => {
        expect(harness.records.slashes).toHaveLength(1);
        const slash = harness.records.slashes[0];
        expect(slash.id).toBe("assets-new-file");
        expect(slash.filter).toEqual(expect.arrayContaining(["新建文件", "assets", "new file", "xjwj"]));
        // 命令文字与图标都在提示行里，用户能在候选里认出它
        expect(slash.html).toContain("新建文件到 assets");
        expect(slash.html).toContain("#iconFile");

        const plugin = harness.host.plugin as unknown as {protyleSlash: unknown[];};
        expect(plugin.protyleSlash).toEqual([slash]);

        harness.dispose();
        expect(plugin.protyleSlash).toEqual([]);
    });

    it("桌面端打开对话框：标题、提示、输入框与创建/取消按钮齐全，并自动聚焦输入框", () => {
        const protyle = createProtyle();
        const {dialog, input, confirm, cancel} = partsOf(harness, protyle);

        expect(lastDialog().options.width).toBe("440px");
        expect((dialog.element as HTMLElement).textContent).toContain("输入文件名（可带任意后缀）。");
        expect(input.placeholder).toBe("例如：清单.txt");
        expect(confirm.textContent).toBe("创建");
        expect(cancel.textContent).toBe("取消");
        // 桌面端没有软键盘，直接聚焦省一步
        expect(document.activeElement).toBe(input);
        // 弹窗入场前先挂图层预热，避免移动端入场闪一帧旧画面
        expect(
            (dialog.element as HTMLElement).querySelector(".b3-dialog__container")?.classList.contains(
                "some-settings-layer",
            ),
        ).toBe(true);
    });

    it("移动端弹窗宽 92vw，且不程序性聚焦输入框（否则软键盘会让弹窗重排闪一下）", () => {
        mockState.frontend = "mobile";
        const protyle = createProtyle();
        const {input} = partsOf(harness, protyle);

        expect(lastDialog().options.width).toBe("92vw");
        expect(document.activeElement).not.toBe(input);
    });

    it("文件名为空时只提示，不发请求也不关窗", async () => {
        const protyle = createProtyle();
        const {input, confirm} = partsOf(harness, protyle);

        input.value = "   ";
        confirm.click();
        await flush();

        expect(harness.records.messages).toEqual(["文件名不能为空，也不能包含 / 或 \\"]);
        expect(mockState.fetchSyncPost).not.toHaveBeenCalled();
        expect(input.disabled).toBe(false);
        expect(document.activeElement).toBe(input);
        expect(lastDialog().dialog.destroyed).toBe(false);
    });

    it("文件名带 / 或 \\ 一律拒绝（会被内核当目录，链接也会坏掉）", async () => {
        const protyle = createProtyle();
        const {input, confirm} = partsOf(harness, protyle);

        for (const value of ["a/b.txt", "a\\b.txt"]) {
            input.value = value;
            confirm.click();
            await flush();
        }

        expect(harness.records.messages).toHaveLength(2);
        expect(mockState.fetchSyncPost).not.toHaveBeenCalled();
    });

    it("提交 0 字节文件到上传接口，成功后把命令文本换成指向新资源的链接并关窗", async () => {
        mockState.fetchSyncPost.mockResolvedValue({
            code: 0,
            data: {
                succFiles: [{name: "清单-20241012123456-abcdefg.txt", path: "assets/清单-20241012123456-abcdefg.txt"}],
            },
        });
        const protyle = createProtyle();
        const {input, confirm, dialog} = partsOf(harness, protyle);

        input.value = "  清单.txt  ";
        confirm.click();
        await flush();

        const [url, body] = mockState.fetchSyncPost.mock.calls[0];
        expect(url).toBe("/api/asset/upload");
        const form = body as FormData;
        // 走内核导入流程：带上文档 id 让它选对 assets 目录，文件名按用户填的给
        expect(form.get("id")).toBe("doc-1");
        expect((form.get("file[]") as File).name).toBe("清单.txt");
        expect((form.get("file[]") as File).size).toBe(0);

        expect(protyle.insert).toHaveBeenCalledWith(
            '<span data-type="a" data-href="assets/清单-20241012123456-abcdefg.txt">清单.txt</span>',
            false,
            true,
        );
        expect(dialog.destroyed).toBe(true);
        expect(harness.records.messages).toEqual([]);
    });

    it("没有 rootID 时退回块的 id；两者都没有就不带 id", async () => {
        mockState.fetchSyncPost.mockResolvedValue({code: 0, data: {succFiles: [{path: "assets/x.txt"}]}});

        const byId = createProtyle({rootID: ""});
        const byIdParts = partsOf(harness, byId);
        byIdParts.input.value = "x.txt";
        byIdParts.confirm.click();
        await flush();
        expect((mockState.fetchSyncPost.mock.calls[0][1] as FormData).get("id")).toBe("block-1");

        const noId = createProtyle({rootID: "", id: ""});
        const noIdParts = partsOf(harness, noId);
        noIdParts.input.value = "y.txt";
        noIdParts.confirm.click();
        await flush();
        expect((mockState.fetchSyncPost.mock.calls[1][1] as FormData).get("id")).toBe(null);
    });

    it("上传中禁用输入框与按钮并把按钮改成「正在创建…」，避免重复提交", async () => {
        const pending = pendingResponse();
        const protyle = createProtyle();
        const {input, confirm} = partsOf(harness, protyle);

        input.value = "a.txt";
        confirm.click();
        await Promise.resolve();

        expect(input.disabled).toBe(true);
        expect(confirm.disabled).toBe(true);
        expect(confirm.textContent).toBe("正在创建…");

        pending.resolve({code: 0, data: {succFiles: [{path: "assets/a.txt"}]}});
        await flush();
    });

    it("内核返回非 0 code 时提示失败并复原控件，对话框留着让用户重试", async () => {
        mockState.fetchSyncPost.mockResolvedValue({code: 1, msg: "denied"});
        const protyle = createProtyle();
        const {input, confirm, dialog} = partsOf(harness, protyle);

        input.value = "a.txt";
        confirm.click();
        await flush();

        expect(harness.records.messages).toEqual(["创建文件失败，请稍后再试"]);
        expect(input.disabled).toBe(false);
        expect(confirm.disabled).toBe(false);
        expect(confirm.textContent).toBe("创建");
        expect(dialog.destroyed).toBe(false);
        // 失败只记录日志、不再弹一次内核消息（已经给过用户提示）
        expect(console.error).toHaveBeenCalled();
    });

    it("内核把文件名写进 failedFiles 时报错信息带内核给的原因", async () => {
        mockState.fetchSyncPost.mockResolvedValue({code: 0, data: {failedFiles: [{error: "duplicated name"}]}});
        const protyle = createProtyle();
        const {input, confirm} = partsOf(harness, protyle);

        input.value = "a.txt";
        confirm.click();
        await flush();

        expect(harness.records.messages).toEqual(["创建文件失败，请稍后再试"]);
        expect(console.error).toHaveBeenCalledWith(
            expect.stringContaining("assets-new-file.create"),
        );
        expect(console.error).toHaveBeenCalledWith(
            expect.stringContaining("asset upload failed: duplicated name"),
        );
    });

    it("响应里没有 succFiles[0].path 时按失败处理（不能插一个空链接）", async () => {
        mockState.fetchSyncPost.mockResolvedValue({code: 0, data: {succFiles: []}});
        const protyle = createProtyle();
        const {input, confirm} = partsOf(harness, protyle);

        input.value = "a.txt";
        confirm.click();
        await flush();

        expect(harness.records.messages).toEqual(["创建文件失败，请稍后再试"]);
        expect(protyle.insert).not.toHaveBeenCalled();
    });

    it("请求本身 reject 时同样只提示、不抛到调用方", async () => {
        mockState.fetchSyncPost.mockRejectedValue(new Error("kernel gone"));
        const protyle = createProtyle();
        const {input, confirm} = partsOf(harness, protyle);

        input.value = "a.txt";
        confirm.click();
        await flush();

        expect(harness.records.messages).toEqual(["创建文件失败，请稍后再试"]);
        expect(input.disabled).toBe(false);
    });

    it("回车等于点创建；输入法组字中的回车不算提交", async () => {
        mockState.fetchSyncPost.mockResolvedValue({code: 0, data: {succFiles: [{path: "assets/a.txt"}]}});
        const protyle = createProtyle();
        const {input} = partsOf(harness, protyle);

        input.value = "a.txt";
        const composing = new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true});
        Object.defineProperty(composing, "isComposing", {value: true});
        input.dispatchEvent(composing);
        await flush();
        expect(mockState.fetchSyncPost).not.toHaveBeenCalled();

        const other = new KeyboardEvent("keydown", {key: "a", bubbles: true, cancelable: true});
        input.dispatchEvent(other);
        await flush();
        expect(mockState.fetchSyncPost).not.toHaveBeenCalled();

        const enter = new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true});
        input.dispatchEvent(enter);
        await flush();

        // 回车必须自己吃掉：否则宿主的斜杠菜单 / 编辑器还会再处理一次这个 Enter
        expect(enter.defaultPrevented).toBe(true);
        expect(mockState.fetchSyncPost).toHaveBeenCalledTimes(1);
    });

    it("取消按钮直接关窗，不发任何请求", async () => {
        const protyle = createProtyle();
        const {cancel, dialog} = partsOf(harness, protyle);

        cancel.click();
        await flush();

        expect(dialog.destroyed).toBe(true);
        expect(mockState.fetchSyncPost).not.toHaveBeenCalled();
    });

    it("上传期间用户取消：文件已经建好但不往文档里插链接", async () => {
        const pending = pendingResponse();
        const protyle = createProtyle();
        const {input, confirm, cancel} = partsOf(harness, protyle);

        input.value = "a.txt";
        confirm.click();
        await Promise.resolve();
        cancel.click();
        pending.resolve({code: 0, data: {succFiles: [{path: "assets/a.txt"}]}});
        await flush();

        expect(protyle.insert).not.toHaveBeenCalled();
    });

    it("插入链接失败时只记日志（不提示用户「失败了」，文件其实已经建好），弹窗照常关闭", async () => {
        mockState.fetchSyncPost.mockResolvedValue({code: 0, data: {succFiles: [{path: "assets/a.txt"}]}});
        const protyle = createProtyle();
        protyle.insert.mockImplementation(() => {
            throw new Error("protyle disposed");
        });
        const {input, confirm, dialog} = partsOf(harness, protyle);

        input.value = "a.txt";
        confirm.click();
        await flush();

        expect(console.error).toHaveBeenCalledWith(
            expect.stringContaining("assets-new-file.insert"),
        );
        // notifyUser 为 false：不给用户弹「创建失败」，否则会以为要重来一次
        expect(harness.records.messages).toEqual([]);
        expect(dialog.destroyed).toBe(true);
    });

    it("命令范围向左扩到 / 的位置，链接替换掉整段命令文本", async () => {
        mockState.fetchSyncPost.mockResolvedValue({code: 0, data: {succFiles: [{path: "assets/a.txt"}]}});
        document.body.innerHTML = '<div data-node-id="block-1">前文 abc /清单</div>';
        const block = document.querySelector<HTMLElement>("[data-node-id]")!;
        const text = block.firstChild as Text;
        const range = document.createRange();
        range.setStart(text, text.length);
        range.collapse(true);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);

        const protyle = createProtyle();
        const {input, confirm} = partsOf(harness, protyle);
        // 宿主只把光标交给我们，命令本身还留在文档里，所以要自己往回找起点：
        // 「前文 abc /清单」里的 `/` 在第 7 个字符上，range 起点被左移到那里
        expect(range.startContainer).toBe(text);
        expect(range.startOffset).toBe(7);

        input.value = "a.txt";
        confirm.click();
        await flush();

        expect(protyle.insert).toHaveBeenCalledTimes(1);
    });

    it("URL 里的斜杠不算命令起点（不能把链接的一部分删掉）", async () => {
        mockState.fetchSyncPost.mockResolvedValue({code: 0, data: {succFiles: [{path: "assets/a.txt"}]}});
        document.body.innerHTML = '<div data-node-id="block-1">见 https://example.com/aa</div>';
        const text = document.querySelector("[data-node-id]")!.firstChild as Text;
        const range = document.createRange();
        range.setStart(text, text.length);
        range.collapse(true);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);

        const protyle = createProtyle();
        const {input, confirm} = partsOf(harness, protyle);

        input.value = "a.txt";
        confirm.click();
        await flush();

        // 起点没有被改动：仍是光标位置，链接只插在命令后面，不误删 URL
        expect(range.startOffset).toBe(text.length);
        expect(protyle.insert).toHaveBeenCalledTimes(1);
    });

    it("起点在别的行内元素里时，往前一个文本节点继续找", async () => {
        mockState.fetchSyncPost.mockResolvedValue({code: 0, data: {succFiles: [{path: "assets/a.txt"}]}});
        document.body.innerHTML = '<div data-node-id="block-1">aa /zz<i>y</i></div>';
        const italicText = document.querySelector("i")!.firstChild as Text;
        const range = document.createRange();
        range.setStart(italicText, 1);
        range.collapse(true);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);

        const protyle = createProtyle();
        const {input} = partsOf(harness, protyle);

        input.value = "a.txt";
        // 打开对话框时就已经把 range 扩好了，命令起点落回上一个文本节点里那个 /
        expect(range.startContainer).toBe(document.querySelector("[data-node-id]")!.firstChild);
        expect(range.startOffset).toBe(3);
    });

    it("取不到块（不在 data-node-id 里）时保留原光标，不越界删内容", () => {
        document.body.innerHTML = "<div>没有块标记的文本</div>";
        const text = document.querySelector("div")!.firstChild as Text;
        const range = document.createRange();
        range.setStart(text, text.length);
        range.collapse(true);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);

        const protyle = createProtyle();
        partsOf(harness, protyle);

        expect(range.startOffset).toBe(text.length);
    });

    it("没有可用 range 时退回宿主当前选区，仍然把链接插进去", async () => {
        mockState.fetchSyncPost.mockResolvedValue({code: 0, data: {succFiles: [{path: "assets/a.txt"}]}});
        window.getSelection()?.removeAllRanges();
        const protyle = createProtyle({toolbar: false});
        const {input, confirm} = partsOf(harness, protyle);

        input.value = "a.txt";
        confirm.click();
        await flush();

        expect(protyle.insert).toHaveBeenCalledWith('<span data-type="a" data-href="assets/a.txt">a.txt</span>');
    });

    it("宿主给的 range 指向已经离开文档的节点时，不硬塞选区，直接走宿主当前光标", async () => {
        mockState.fetchSyncPost.mockResolvedValue({code: 0, data: {succFiles: [{path: "assets/a.txt"}]}});
        // 上传期间宿主重绘了正文：toolbar 手里的 range 还指着被拆掉的文本节点
        const detached = document.createElement("div");
        detached.textContent = "/a";
        const detachedText = detached.firstChild as Text;
        const detachedRange = document.createRange();
        detachedRange.setStart(detachedText, detachedText.length);
        detachedRange.collapse(true);

        const protyle = createProtyle();
        protyle.protyle.toolbar!.range = detachedRange;
        const {input, confirm} = partsOf(harness, protyle);

        input.value = "a.txt";
        confirm.click();
        await flush();

        // 只有一个参数：range 不可用时不把失效的选区交给宿主
        expect(protyle.insert).toHaveBeenCalledWith('<span data-type="a" data-href="assets/a.txt">a.txt</span>');
    });

    it("对话框里的文案都经过转义：i18n 里带标记也不会变成 HTML", () => {
        harness.dispose();
        harness = mountFeature(assetsNewFile, {
            i18n: (key) => key === "feature.assetsNewFile.placeholder" ? "<b>x</b>" : key,
        });

        const protyle = createProtyle();
        const {input} = partsOf(harness, protyle);

        expect(input.getAttribute("placeholder")).toBe("<b>x</b>");
        expect(input.placeholder).toBe("<b>x</b>");
        expect(document.querySelector("b")).toBe(null);
    });
});
