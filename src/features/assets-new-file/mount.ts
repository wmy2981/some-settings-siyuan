/**
 * 斜杠命令：在当前文档里新建一个任意后缀的空文件，放进 assets/。
 *
 * 「创建」走内核自己的上传链路（`/api/asset/upload`），提交一个 0 字节的 File：
 * 内核按导入流程给文件名追加 22 位笔记 ID（`name-20241012123456-abcdefg.ext`），
 * 并按当前文档选择笔记本的 assets 目录（加密笔记本也走内核的加密写入）。
 * 插件不自己拼文件名、不直接写盘，所以命名、加密与同步都与手动导入完全一致。
 *
 * 命令文本 `/xxx` 在宿主里不会被删掉：插件回调拿到的是光标处的 range，
 * 这里把它向左扩到 `/` 或 `、`，上传成功后用链接替换整段命令文本。
 */
import {
    Dialog,
    fetchSyncPost,
    type Protyle,
} from "siyuan";
import {reportError} from "../../core/error";
import type {FeatureHost} from "../../core/types";
import {
    isMobileFrontend,
    escapeHtml,
} from "../../core/ui";

/** 上传接口的响应形状（只取我们用到的字段）。 */
interface UploadResponse {
    code?: number;
    msg?: string;
    data?: {
        succFiles?: {name?: string; path?: string;}[];
        failedFiles?: {error?: string;}[];
    };
}

/** 斜杠命令的检索词：中文、英文与拼音首字母都覆盖。 */
const FILTER = [
    "新建文件",
    "创建文件",
    "assets",
    "文件",
    "xinjianwenjian",
    "chuangjianwenjian",
    "wenjian",
    "xjwj",
    "cjwj",
    "wj",
    "new file",
    "create file",
    "file",
];

const TIP_CLASS = "ss-assets-new-file__tip";

const DIALOG_CSS = `
.${TIP_CLASS} {
    color: var(--b3-theme-on-surface);
    font-size: 12px;
    line-height: 18px;
    margin-bottom: 8px;
}
`;

/**
 * 光标所在命令文本的起点。
 *
 * 只认「行首、空白或左括号之后」的 `/` 或 `、`：否则一段 URL 里的斜杠也会被当成命令起点，
 * 选中后会把链接的一部分一起删掉。
 */
const commandStart = (text: string, from: number): number => {
    for (let index = from - 1; index >= 0; index--) {
        const char = text[index];
        if (char !== "/" && char !== "、") {
            continue;
        }
        if (index === 0 || /[\s(（[【]/.test(text[index - 1])) {
            return index;
        }
    }
    return -1;
};

/** 光标 / 命令文本所在的块，用来限制向前找文本节点的范围。 */
const closestBlock = (node: Node): HTMLElement | undefined => {
    const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
    return element?.closest<HTMLElement>("[data-node-id]") ?? undefined;
};

/** 同一块内、当前节点之前最近的文本节点。 */
const previousTextNode = (node: Node, block: HTMLElement): Text | undefined => {
    let current: Node | null = node;
    while (current && current !== block) {
        let sibling: Node | null = current.previousSibling;
        while (sibling) {
            let candidate: Node | null = sibling;
            if (candidate.nodeType !== Node.TEXT_NODE) {
                candidate = candidate.lastChild;
                while (candidate && candidate.nodeType !== Node.TEXT_NODE) {
                    candidate = candidate.lastChild;
                }
            }
            if (candidate && candidate.nodeType === Node.TEXT_NODE) {
                return candidate as Text;
            }
            sibling = sibling.previousSibling;
        }
        current = current.parentNode;
    }
    return undefined;
};

/**
 * 把光标处的 range 向左扩到命令起点。
 *
 * 宿主在调用插件回调之前已经把选区收成光标，所以这里靠「光标前最近的 `/`」还原命令范围；
 * 找不到时保留光标，链接会插在命令文本后面（至少不会误删别的内容）。
 */
const captureCommandRange = (protyle: Protyle): Range | undefined => {
    const p = protyle.protyle;
    const selection = window.getSelection();
    const range = p.toolbar?.range ?? (selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : undefined);
    if (!range) {
        return undefined;
    }
    const startNode = range.startContainer;
    if (startNode.nodeType === Node.TEXT_NODE) {
        const text = (startNode as Text).textContent ?? "";
        const index = commandStart(text, range.startOffset);
        if (index >= 0) {
            range.setStart(startNode, index);
            return range;
        }
    }

    const block = closestBlock(startNode);
    if (!block) {
        return range;
    }
    let candidate: Text | undefined;
    if (startNode.nodeType !== Node.TEXT_NODE && range.startOffset > 0) {
        const child = startNode.childNodes[range.startOffset - 1];
        if (child?.nodeType === Node.TEXT_NODE) {
            candidate = child as Text;
        }
    }
    candidate ??= previousTextNode(startNode, block);
    // 命令文本不会跨很多节点；限制步数，避免在一大段正文里一路往前扫
    for (let guard = 0; candidate && guard < 8; guard++) {
        const text = candidate.textContent ?? "";
        const index = commandStart(text, text.length);
        if (index >= 0) {
            range.setStart(candidate, index);
            return range;
        }
        candidate = previousTextNode(candidate, block);
    }
    return range;
};

/** 上传一个 0 字节文件，返回内核最终写入的 `assets/...` 路径。 */
const createEmptyAsset = async (fileName: string, rootID: string): Promise<string> => {
    const form = new FormData();
    if (rootID) {
        form.append("id", rootID);
    }
    form.append("file[]", new Blob([], {type: "application/octet-stream"}), fileName);
    // 运行期接受普通 FormData；`siyuan` 的类型把 multipart 标成了带 apiRequest 的牌子类型
    const response = await fetchSyncPost(
        "/api/asset/upload",
        form as never,
        undefined,
        false,
    ) as unknown as UploadResponse;
    if (response.code !== 0) {
        throw new Error(`asset upload failed: code ${String(response.code)}${response.msg ? `: ${response.msg}` : ""}`);
    }
    const failed = response.data?.failedFiles?.[0]?.error;
    if (failed) {
        throw new Error(`asset upload failed: ${failed}`);
    }
    const path = response.data?.succFiles?.[0]?.path;
    if (!path) {
        throw new Error("asset upload returned no path");
    }
    return path;
};

/** 把命令文本替换成指向新资源的链接；`useProtyleRange` 保证用的是我们扩好的那段。 */
const insertLink = (protyle: Protyle, range: Range | undefined, path: string, label: string): void => {
    const html = `<span data-type="a" data-href="${escapeHtml(path)}">${escapeHtml(label)}</span>`;
    if (!range || !range.startContainer.isConnected) {
        // 拿不到命令范围时退回宿主当前的选区，至少把链接插进去
        protyle.insert(html);
        return;
    }
    const selection = window.getSelection();
    if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
    }
    const toolbar = protyle.protyle.toolbar;
    if (toolbar) {
        toolbar.range = range;
        protyle.insert(html, false, true);
    } else {
        protyle.insert(html);
    }
};

const openDialog = (host: FeatureHost, protyle: Protyle): void => {
    const t = (key: string): string => host.i18n(key);
    const range = captureCommandRange(protyle);
    const rootID = protyle.protyle.block?.rootID || protyle.protyle.block?.id || "";
    let closed = false;
    let dialog: Dialog | undefined;

    dialog = new Dialog({
        title: t("assetsNewFile.title"),
        content: `<div class="b3-dialog__content">
    <style>${DIALOG_CSS}</style>
    <div class="${TIP_CLASS}">${escapeHtml(t("assetsNewFile.tip"))}</div>
    <input class="b3-text-field fn__block" data-name type="text" spellcheck="false"
        placeholder="${escapeHtml(t("assetsNewFile.placeholder"))}"/>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel" type="button" data-cancel>${
            escapeHtml(t("assetsNewFile.cancel"))
        }</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text" type="button" data-confirm>${
            escapeHtml(t("assetsNewFile.confirm"))
        }</button>
</div>`,
        width: isMobileFrontend() ? "92vw" : "440px",
        destroyCallback: () => {
            closed = true;
            dialog = undefined;
        },
    });

    const element = dialog.element;
    const input = element.querySelector<HTMLInputElement>("[data-name]");
    const confirm = element.querySelector<HTMLButtonElement>("[data-confirm]");
    const cancel = element.querySelector<HTMLButtonElement>("[data-cancel]");

    const submit = async (): Promise<void> => {
        const value = input?.value.trim() ?? "";
        if (!value || /[\\/]/.test(value)) {
            host.showMessage(t("assetsNewFile.invalid"));
            input?.focus();
            return;
        }
        if (input) {
            input.disabled = true;
        }
        if (confirm) {
            confirm.disabled = true;
            confirm.textContent = t("assetsNewFile.creating");
        }
        try {
            const path = await createEmptyAsset(value, rootID);
            if (!closed) {
                try {
                    insertLink(protyle, range, path, value);
                } catch (error) {
                    // 文件已经创建成功；插入失败只记录，对话框照常收掉，不让用户以为要重来一次
                    reportError("assets-new-file.insert", error, false);
                }
            }
            dialog?.destroy();
        } catch (error) {
            reportError("assets-new-file.create", error, false);
            host.showMessage(t("assetsNewFile.failed"));
            if (input) {
                input.disabled = false;
            }
            if (confirm) {
                confirm.disabled = false;
                confirm.textContent = t("assetsNewFile.confirm");
            }
        }
    };

    cancel?.addEventListener("click", () => dialog?.destroy());
    confirm?.addEventListener("click", () => {
        void submit();
    });
    input?.addEventListener("keydown", (event) => {
        if (event.isComposing || event.key !== "Enter") {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        void submit();
    });
    input?.focus();
};

export const mountAssetsNewFile = (host: FeatureHost): void => {
    const t = (key: string): string => host.i18n(key);
    host.addProtyleSlash({
        id: "assets-new-file",
        filter: FILTER,
        html:
            `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconFile"></use></svg><span class="b3-list-item__text">${
                escapeHtml(t("assetsNewFile.command"))
            }</span></div>`,
        callback: (protyle) => {
            openDialog(host, protyle);
        },
    });
};
