/**
 * 开发：本插件全部配置的导出与导入。
 *
 * 两个动作行都只负责开一个窗口：导出把当前配置铺成一段只读 JSON，导入把粘贴进来的
 * JSON 写回去。读写本身由 core 完成（ConfigStore.exportAll / importMany），
 * 因此导入的归一化、白名单与写后读回校验和面板点「保存」完全同一条路，
 * 非法值不会绕过校验被静默写进磁盘。
 *
 * 导入成功后必须重新载入前端，理由和「清除本插件配置」一样：设置面板此刻还开着，
 * 它手里那份草稿是导入之前的值，用户只要再点一次「保存」就会把旧值原样写回来；
 * 重新载入是同时收掉草稿、又让各功能按新配置重新装载的唯一可靠做法。
 */
import {
    Dialog,
    showMessage,
} from "siyuan";
import {copyText} from "../../core/clipboard";
import {reportError} from "../../core/error";
import {isMobile} from "../../core/frontend";
import type {FeatureActionContext} from "../../core/types";
import {escapeHtml} from "../../core/ui";
import {parseImport} from "./parse";

/** 重新载入前的等待：让结果提示先显示出来，用户能确认这一步做完了。 */
const RELOAD_DELAY_MS = 600;

/** 导出的 JSON 里带的标记，用来一眼看出这段文本出自哪个插件。 */
const MARK = "some-settings-siyuan";
const FORMAT_VERSION = 1;

/**
 * 文本区样式内联。
 *
 * 动作行不参与挂载，拿不到 `FeatureHost`，也就没有 `addStyle` 可用来注入一段
 * 只属于本功能的样式；这几条又必须生效（否则 JSON 会挤在一个几行高的框里），
 * 所以直接写在元素上。
 */
const AREA_STYLE = "box-sizing:border-box;width:100%;min-height:12rem;max-height:45vh;margin:8px 0 0;" +
    "font-family:var(--b3-font-family-code);font-size:12px;line-height:18px;overflow:auto";

/**
 * 只读的展示框用 `<pre>` 而不是 `<textarea>`。
 *
 * 移动端「点一下软键盘就顶上来」的判据是**能不能编辑**，只读的表单控件一样被当成
 * 输入控件：键盘一起来就把弹窗下半截连同按钮一起盖住，而这段 JSON 只需要看和选。
 * `<pre>` 不是表单控件，点它不聚焦、也就不会弹键盘；`pre-wrap` 与文本选中都照旧。
 */
const VIEW_STYLE = `${AREA_STYLE};white-space:pre-wrap;overflow-wrap:anywhere;user-select:text`;

interface DialogSpec {
    title: string;
    tip: string;
    json: string;
    /** 只读（导出）还是可编辑（导入）。 */
    editable: boolean;
    actionLabel: string;
    /**
     * 点右侧按钮要做的事；返回 true 表示这次做完了、窗口可以关掉。
     * 返回 false 时窗口保持打开，用户还能改一改再试。
     */
    run: (json: string) => Promise<boolean>;
}

const openDialog = (context: FeatureActionContext, spec: DialogSpec): void => {
    // 只有要输入的那个框才是表单控件；只读的那个用 <pre>（见 VIEW_STYLE 的说明）
    const box = spec.editable ?
        `<textarea class="b3-text-field fn__block" style="${AREA_STYLE}" spellcheck="false"></textarea>` :
        `<pre class="b3-text-field fn__block" style="${VIEW_STYLE}"></pre>`;
    const dialog = new Dialog({
        title: spec.title,
        width: isMobile() ? "92vw" : "640px",
        content: `<div class="b3-dialog__content">
    <div class="b3-label__text">${escapeHtml(spec.tip)}</div>
    ${box}
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel" type="button" data-ss-close>${
            escapeHtml(context.i18n("common.close"))
        }</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text" type="button" data-ss-run>${escapeHtml(spec.actionLabel)}</button>
</div>`,
    });
    const field = dialog.element.querySelector<HTMLElement>(spec.editable ? "textarea" : "pre");
    if (field instanceof HTMLTextAreaElement) {
        field.value = spec.json;
    } else if (field) {
        field.textContent = spec.json;
    }
    /** 框里此刻的文字：可编辑的取 `value`，只读的取 `textContent`。 */
    const textOf = (): string => field instanceof HTMLTextAreaElement ? field.value : field?.textContent ?? "";
    dialog.element.querySelector<HTMLButtonElement>("[data-ss-close]")?.addEventListener("click", () => {
        dialog.destroy();
    });
    dialog.element.querySelector<HTMLButtonElement>("[data-ss-run]")?.addEventListener("click", () => {
        void spec.run(textOf()).then((done) => {
            if (done) {
                dialog.destroy();
            }
        });
    });
};

export const exportConfigs = (context: FeatureActionContext): void => {
    const json = JSON.stringify(
        {
            plugin: MARK,
            version: FORMAT_VERSION,
            features: context.exportConfigs(),
        },
        null,
        2,
    );
    openDialog(context, {
        title: context.i18n("configTransfer.exportTitle"),
        tip: context.i18n("configTransfer.exportTip"),
        json,
        editable: false,
        actionLabel: context.i18n("configTransfer.copy"),
        run: async (text) => {
            const copied = await copyText(text);
            showMessage(context.i18n(copied ? "configTransfer.copied" : "configTransfer.copyFailed"), 3000);
            // 复制完不关窗：用户可能还要在框里自己选一段，或者再复制一次
            return false;
        },
    });
};

export const importConfigs = (context: FeatureActionContext): void => {
    openDialog(context, {
        title: context.i18n("configTransfer.importTitle"),
        tip: context.i18n("configTransfer.importTip"),
        json: "",
        editable: true,
        actionLabel: context.i18n("configTransfer.importAction"),
        run: async (text) => {
            const parsed = parseImport(text);
            if (parsed.kind === "error") {
                // 两个分支各写一次字面量 key：写成三元表达式的话，校验脚本会把分支里的
                // 短片段也当成一个 key 去核对，两边都会被判成"缺文案"
                if (parsed.reason === "json") {
                    showMessage(context.i18n("configTransfer.invalidJson"), 4000, "error");
                } else {
                    showMessage(context.i18n("configTransfer.invalidShape"), 4000, "error");
                }
                return false;
            }
            try {
                const result = await context.importConfigs(parsed.features);
                showMessage(
                    context.i18n("configTransfer.imported")
                        .replace("{count}", String(result.applied.length))
                        .replace("{skipped}", String(result.skipped.length)),
                    4000,
                );
                window.setTimeout(() => window.location.reload(), RELOAD_DELAY_MS);
                return true;
            } catch (error) {
                // 校验失败或写盘读回不一致：不能装作导入成功，具体问题由 core 抛出并提示
                reportError("config-transfer.import", error);
                return false;
            }
        },
    });
};
