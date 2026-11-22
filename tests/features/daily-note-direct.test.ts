/**
 * 日记直接创建（daily-note-direct）。
 *
 * 做法不是重写创建逻辑，而是盯住日记弹窗：它一进 DOM，就把下拉框设成配置的笔记本、
 * 替用户点一下「确定」，再同步把弹窗摘掉。创建本身仍走思源自己的
 * `/api/filetree/createDailyNote`，插件不碰内核。
 *
 * 因此这里断言的是「插件插不插手」：配置为空、笔记本已关闭/已不存在、弹窗结构不符时
 * 都必须原样放行，让思源自己的询问流程照常走完 —— 这几种情况下插手等于替用户瞎选。
 */
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import {dailyNoteNotebookOptions} from "../../src/features/daily-note-direct/direct";
import definition from "../../src/features/daily-note-direct/index";
import type {HostHarness} from "../helpers/feature-host";
import {mountFeature} from "../helpers/feature-host";

/** 内核 `Constants.DIALOG_DIALYNOTE` 对应的弹窗标识。 */
const DIALOG_KEY = "dialog-dialynote";

/** 与宿主一致的日记弹窗标记：下拉框 + 动作区里那颗正文按钮。 */
const dialogMarkup = (options: {withSelect?: boolean; withConfirm?: boolean;} = {}): string => {
    const select = options.withSelect === false ? "" : `<select class="b3-select">
        <option value="nb-1">Notebook 1</option>
        <option value="nb-2">Notebook 2</option>
    </select>`;
    const confirm = options.withConfirm === false ? "" : '<button class="b3-button b3-button--text">Confirm</button>';
    return `<div data-key="${DIALOG_KEY}" class="b3-dialog">
        <div class="b3-dialog__container">
            <div class="b3-dialog__body">
                <div class="b3-dialog__content">${select}</div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel">Cancel</button>
                    ${confirm}
                </div>
            </div>
        </div>
    </div>`;
};

const mounted: HostHarness[] = [];

/** 宿主注入的笔记本清单（`window.siyuan.notebooks`）。 */
const setNotebooks = (notebooks: unknown): void => {
    (window.siyuan as unknown as {notebooks?: unknown;}).notebooks = notebooks;
};

const mount = (config: Record<string, unknown> = {}): HostHarness => {
    const harness = mountFeature(definition, {config});
    mounted.push(harness);
    return harness;
};

/** 把一段弹窗标记追加进 body：这是内核打开 Dialog 时的动作。 */
const appendDialog = (html = dialogMarkup()): HTMLElement => {
    const holder = document.createElement("div");
    holder.innerHTML = html;
    const dialog = holder.firstElementChild as HTMLElement;
    document.body.append(dialog);
    return dialog;
};

/**
 * MutationObserver 的回调是微任务：这里只让出微任务队列，不等待任何定时器。
 * 「只等微任务弹窗就没了」正是要点 —— 内核的 remove 要 190ms，等它就等于让弹窗闪一帧。
 */
const flush = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
};

const findDialog = (): HTMLElement | null => document.querySelector<HTMLElement>(`[data-key="${DIALOG_KEY}"]`);

beforeEach(() => {
    mounted.length = 0;
    setNotebooks([
        {id: "nb-1", name: "Notebook 1"},
        {id: "nb-2", name: "Notebook 2"},
    ]);
});

afterEach(() => {
    // destroy 只做 observer.disconnect()，这里统一卸载，避免观察器跨用例继续工作
    mounted.splice(0).forEach((harness) => harness.dispose());
});

describe("direct daily note creation", () => {
    it("options: the not-specified entry comes first, the rest are the currently open notebooks", () => {
        setNotebooks([
            {id: "nb-1", name: "Notebook 1"},
            {id: "nb-2", name: "Notebook 2", closed: true},
            {id: "", name: "no id"},
            {id: "nb-3", name: ""},
        ]);

        const options = dailyNoteNotebookOptions();

        // 「不指定」必须始终存在：用户要能退回思源自己的询问流程，
        // 否则关掉功能只能靠改配置文件
        expect(options[0]).toEqual({value: "", label: "feature.dailyNoteDirect.notebookUnset"});
        // 已关闭的笔记本列出来会让用户选中一个必然失败的项；
        // 没有名字时回落 id，至少还能认出来是哪一个
        expect(options.slice(1)).toEqual([
            {value: "nb-1", label: "Notebook 1"},
            {value: "nb-3", label: "nb-3"},
        ]);
    });

    it("when the host has no notebook list, only the not-specified entry remains", () => {
        setNotebooks(undefined);
        expect(dailyNoteNotebookOptions()).toEqual([{value: "", label: "feature.dailyNoteDirect.notebookUnset"}]);

        // 形状不规则（不是数组）时按同一套兜底处理，不能抛
        setNotebooks({id: "nb-1"});
        expect(dailyNoteNotebookOptions()).toHaveLength(1);
    });

    it("notebook configured: sets the select, confirms for the user and drops the dialog synchronously", async () => {
        mount({notebook: "nb-2"});
        const dialog = appendDialog();
        const select = dialog.querySelector("select") as HTMLSelectElement;
        const confirm = dialog.querySelector(".b3-button--text") as HTMLButtonElement;
        const clicks: Event[] = [];
        confirm.addEventListener("click", (event) => clicks.push(event));

        await flush();

        expect(select.value).toBe("nb-2");
        // 内核自己就是用 CustomEvent("click") 绑定与触发的，这里必须同一种派发方式，
        // 否则换成 MouseEvent 在某些宿主版本上会走到另一条「用户点击」分支
        expect(clicks).toHaveLength(1);
        expect(clicks[0]).toBeInstanceOf(CustomEvent);
        expect(clicks[0]).not.toBeInstanceOf(MouseEvent);
        // 只等微任务就消失：等内核那 190ms 的 remove 会让弹窗先闪一帧
        expect(findDialog()).toBeNull();
    });

    it("an empty config stays out of the way and leaves the dialog to SiYuan's own prompt", async () => {
        mount();
        const dialog = appendDialog();
        const select = dialog.querySelector("select") as HTMLSelectElement;
        const confirm = dialog.querySelector(".b3-button--text") as HTMLButtonElement;
        const onConfirm = vi.fn();
        confirm.addEventListener("click", onConfirm);

        await flush();

        // 默认值取的是第一项，说明插件没动过它
        expect(select.value).toBe("nb-1");
        expect(onConfirm).not.toHaveBeenCalled();
        expect(findDialog()).toBe(dialog);
    });

    it("a closed / missing configured notebook is let through, with a log line saying why nothing was taken over", async () => {
        setNotebooks([
            {id: "nb-1", name: "Notebook 1"},
            {id: "nb-2", name: "Notebook 2", closed: true},
        ]);
        const harness = mount({notebook: "nb-2"});
        const dialog = appendDialog();
        const select = dialog.querySelector("select") as HTMLSelectElement;

        await flush();

        // 指出的是一个「关着的笔记本」：硬点确定只会让创建失败，比不帮忙更糟
        expect(select.value).toBe("nb-1");
        expect(findDialog()).toBe(dialog);
        expect(String(harness.records.logs[0]?.[0])).toContain("configured notebook nb-2 is unavailable");

        dialog.remove();
        harness.config.notebook = "nb-404";
        harness.notifyConfigChange();
        const second = appendDialog();
        await flush();
        expect(findDialog()).toBe(second);
        expect(String(harness.records.logs[1]?.[0])).toContain("nb-404 is unavailable");
    });

    it("an unexpected dialog shape (no select or no confirm button) is left alone and only logged", async () => {
        const harness = mount({notebook: "nb-2"});
        const noSelect = appendDialog(dialogMarkup({withSelect: false}));
        await flush();
        expect(findDialog()).toBe(noSelect);
        expect(String(harness.records.logs[0]?.[0])).toContain("no select or confirm button");

        noSelect.remove();
        const noConfirm = appendDialog(dialogMarkup({withConfirm: false}));
        await flush();
        expect(findDialog()).toBe(noConfirm);
        expect(harness.records.logs).toHaveLength(2);
    });

    it("the dialog is recognized when it arrives nested (both the inner node and the outer wrapper)", async () => {
        mount({notebook: "nb-1"});

        // 内核只是 `body.append(element)`，但别的代码可能先包一层；
        // 两种形态都要处理，否则包一层就失效
        const wrapper = document.createElement("div");
        wrapper.className = "b3-dialog__scrim";
        wrapper.innerHTML = dialogMarkup();
        document.body.append(wrapper);

        await flush();

        expect(wrapper.querySelector(`[data-key="${DIALOG_KEY}"]`)).toBeNull();
        expect(wrapper.children).toHaveLength(0);
    });

    it("other dialogs and text nodes are never touched", async () => {
        const harness = mount({notebook: "nb-2"});

        // 不是日记弹窗（导出、确认框等都是同一个 Dialog 实现）
        const other = appendDialog(dialogMarkup().replace(DIALOG_KEY, "dialog-export"));
        // 文本节点也会出现在 addedNodes 里，`instanceof HTMLElement` 的守卫为它而写
        document.body.append(document.createTextNode("just some text"));

        await flush();

        expect(findDialog()).toBeNull();
        expect(document.querySelector('[data-key="dialog-export"]')).toBe(other);
        expect(harness.records.logs).toHaveLength(0);
    });

    it("only direct children of body are watched: changes inside an existing container cost nothing", async () => {
        const harness = mount({notebook: "nb-2"});

        // 观察器只注册 `childList`（不写 subtree）：编辑器正文就在已有容器里不断变化，
        // 一旦下钻，每个字符都要跑一遍回调
        const container = document.createElement("div");
        document.body.append(container);
        await flush();

        container.innerHTML = dialogMarkup();
        await flush();

        expect(findDialog()).not.toBeNull();
        // 没被处理 = 下拉框还是默认值、弹窗还在
        expect((findDialog() as HTMLElement).querySelector("select")).not.toBeNull();
        expect(harness.records.logs).toHaveLength(0);
    });

    it("no new dialog is handled after destroy", async () => {
        const harness = mount({notebook: "nb-2"});
        harness.dispose();

        const dialog = appendDialog();
        const select = dialog.querySelector("select") as HTMLSelectElement;
        await flush();

        expect(select.value).toBe("nb-1");
        expect(findDialog()).toBe(dialog);
    });

    it("a config change is honoured at once (the dialog reads the config as it is now)", async () => {
        const harness = mount();
        const first = appendDialog();
        await flush();
        expect(findDialog()).toBe(first);
        first.remove();

        harness.config.notebook = "nb-2";
        harness.notifyConfigChange();

        appendDialog();
        await flush();
        // 新配置生效：弹窗被设成 nb-2 并立刻摘掉
        expect(findDialog()).toBeNull();
    });

    it("declaration: doc-tree category, off by default, the notebook select comes from optionsProvider", () => {
        expect(definition.id).toBe("daily-note-direct");
        expect(definition.category).toEqual(["doc-tree"]);
        expect(definition.enabled).toBe(true);
        expect(definition.settings).toEqual([
            {kind: "switch", key: "enabled", title: "common.enabled", default: false},
            {
                kind: "select",
                key: "notebook",
                title: "feature.dailyNoteDirect.notebook",
                description: "feature.dailyNoteDirect.notebookTip",
                default: "",
                optionsProvider: dailyNoteNotebookOptions,
            },
        ]);
    });
});
