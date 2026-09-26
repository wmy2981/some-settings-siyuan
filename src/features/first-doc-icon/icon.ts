/**
 * 首次添加文档图标的实现。
 *
 * 属性值的格式很关键：SiYuan 的 `icon` 属性存的是**码点的十六进制串**
 * （例如 📄 是 `1f4c4`），由 `unicode2Emoji()` 还原成字符；直接写入字符本身
 * 会让文件树/大纲的分支走错。所以这里把用户填的 emoji 转成码点串再写。
 *
 * 面板里填的如果是多码点 emoji（带肤色、ZWJ 组合），按 `-` 连接同样能被还原。
 */
import {fetchPost} from "siyuan";
import {getAllEditor} from "siyuan";
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

/** 「添加图标」按钮：只有还没有图标时才会出现。 */
const ADD_ICON_BUTTON = "button[data-type='icon']";
/** 标题区用来显示文档图标的容器。 */
const ICON_ELEMENT = ".protyle-background__icon";
const DEFAULT_EMOJI = "📄";

interface EditorLike {
    element?: HTMLElement;
    protyle?: {block?: {rootID?: string};};
}

const emojiOf = (host: FeatureHost): string => {
    const value = String(host.config.emoji ?? "").trim();
    return value || DEFAULT_EMOJI;
};

/** 字符 → 码点十六进制串，与内核 unicode2Emoji 的解析方式一一对应。 */
const toCodePoints = (value: string): string =>
    Array.from(value)
        .map((char) => char.codePointAt(0)?.toString(16) ?? "")
        .filter(Boolean)
        .join("-");

const rootIdOf = (element: Element): string => {
    const editors = getAllEditor() as unknown as EditorLike[];
    const owner = editors.find((item) => item.element?.contains(element));
    const rootID = owner?.protyle?.block?.rootID;
    if (rootID) {
        return rootID;
    }
    return element.closest(".protyle")
        ?.querySelector(".protyle-wysiwyg")
        ?.getAttribute("data-node-id") ?? "";
};

export const mountFirstDocIcon = (host: FeatureHost): FeatureInstance => {
    const writeIcon = (rootID: string, emoji: string, iconElement: HTMLElement) => {
        const icon = toCodePoints(emoji);
        if (!icon) {
            return;
        }
        fetchPost("/api/attr/setBlockAttrs", {id: rootID, attrs: {icon}}, (response) => {
            if (response.code !== 0) {
                host.log(`写入文档图标失败：${response.msg}`);
                return;
            }
            if (iconElement.isConnected) {
                iconElement.textContent = emoji;
                iconElement.classList.remove("fn__none");
            }
        });
    };

    // 捕获阶段旁听：内核自己的点击处理器可能 stopPropagation，
    // 冒泡阶段会漏掉这次点击，捕获阶段一定能拿到。
    const onClick = (event: Event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }
        const button = target.closest(ADD_ICON_BUTTON);
        const background = button?.closest(".protyle-background");
        if (!button || !background) {
            return;
        }
        const iconElement = background.querySelector<HTMLElement>(ICON_ELEMENT);
        if (!iconElement) {
            return;
        }
        // 此刻内核还没处理这次点击，图标容器仍是隐藏的，正好用来判定「首次」
        if (!iconElement.classList.contains("fn__none")) {
            return;
        }
        const rootID = rootIdOf(button);
        if (!rootID) {
            host.log("没有取到文档 ID，已跳过");
            return;
        }
        const emoji = emojiOf(host);
        // 让内核的处理器先跑（它会写一个随机 emoji 并打开选择面板），
        // 下一个宏任务再覆盖成配置的图标，保证写入顺序在其之后。
        window.setTimeout(() => writeIcon(rootID, emoji, iconElement), 0);
    };

    document.addEventListener("click", onClick, true);

    return {
        destroy: () => document.removeEventListener("click", onClick, true),
    };
};
