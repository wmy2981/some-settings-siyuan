/**
 * 直接创建日记的实现。
 *
 * 触发点：思源日记弹窗的标识是 `data-key="dialog-dialynote"`，而所有 Dialog
 * 都是 `document.body.append(element)` 的直接子节点，所以只观察 body 的
 * `childList`（不下钻）就足够，不会因为编辑器内容变化而空转。
 */
import type {
    FeatureHost,
    FeatureInstance,
    SettingOption,
} from "../../core/types";

/** 日记选择弹窗的标识，来自内核的 Constants.DIALOG_DIALYNOTE。 */
const DIALOG_KEY = "dialog-dialynote";

/** 「未指定」选项的值：选中它等于交回思源自己的询问流程。 */
const UNSET = "";

interface NotebookLike {
    id: string;
    name: string;
    closed?: boolean;
}

const notebooksOf = (): NotebookLike[] => {
    const holder = window as unknown as {siyuan?: {notebooks?: NotebookLike[];};};
    const notebooks = holder.siyuan?.notebooks;
    return Array.isArray(notebooks) ? notebooks : [];
};

/**
 * 面板里的笔记本候选项：第一个是「不指定」，其余是当前已打开的笔记本。
 *
 * label 走的是 i18n key 那条路：真正的笔记本名在语言包里查不到，
 * 于是原样显示；「不指定」是真正的 i18n key。
 */
export const dailyNoteNotebookOptions = (): SettingOption[] => [
    {value: UNSET, label: "dailyNoteDirect.notebookUnset"},
    ...notebooksOf()
        .filter((notebook) => notebook.id && !notebook.closed)
        .map((notebook) => ({value: notebook.id, label: notebook.name || notebook.id})),
];

export const mountDailyNoteDirect = (host: FeatureHost): FeatureInstance => {
    /**
     * 把弹窗里的笔记本设成配置值并替用户确定。
     * 配置为空、笔记本已不存在/已关闭、或弹窗结构与预期不符时不插手，
     * 让思源自己的询问流程照常走完。
     *
     * 确定之后必须**同步**把弹窗从 DOM 里摘掉：内核的 `destroy()` 只是先去掉
     * `b3-dialog--open`，真正 `element.remove()` 要等 190ms（`TIMEOUT_DBLCLICK`），
     * 而让弹窗显形的 `--open` 是 50ms 后由另一个定时器加上的 —— 两个定时器之间
     * 浏览器会绘制一帧，于是弹窗"闪一下"再消失。同步摘掉就没有这一帧。
     */
    const resolve = (dialog: HTMLElement): void => {
        const notebookId = String(host.config.notebook ?? UNSET);
        if (!notebookId) {
            return;
        }
        if (!notebooksOf().some((notebook) => notebook.id === notebookId && !notebook.closed)) {
            host.log(`配置的笔记本 ${notebookId} 不可用，交回思源自己的选择弹窗`);
            return;
        }
        const select = dialog.querySelector<HTMLSelectElement>("select.b3-select");
        const confirm = dialog.querySelector<HTMLButtonElement>(".b3-dialog__action .b3-button--text");
        if (!select || !confirm) {
            host.log("没有找到日记弹窗的选择框或确定按钮，已跳过");
            return;
        }
        select.value = notebookId;
        // 内核自己就是用 CustomEvent("click") 绑定与触发的，这里保持同一种派发方式
        confirm.dispatchEvent(new CustomEvent("click"));
        dialog.remove();
    };

    const observer = new MutationObserver((records) => {
        for (const record of records) {
            record.addedNodes.forEach((node) => {
                if (!(node instanceof HTMLElement)) {
                    return;
                }
                const dialog = node.matches(`[data-key="${DIALOG_KEY}"]`) ?
                    node :
                    node.querySelector<HTMLElement>(`[data-key="${DIALOG_KEY}"]`);
                if (dialog) {
                    resolve(dialog);
                }
            });
        }
    });
    observer.observe(document.body, {childList: true});

    return {
        destroy: () => observer.disconnect(),
    };
};
