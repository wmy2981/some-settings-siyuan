/**
 * 首次添加文档图标的实现。
 *
 * 三个关键点：
 * 1. `icon` 属性存的是**码点的十六进制串**（📄 是 `1f4c4`），由内核的
 *    `unicode2Emoji()` 还原成字符；直接写入字符本身会让文件树/大纲的分支走错。
 *    所以这里把用户填的 emoji 转成码点串再写。
 * 2. 文档 ID 只能从 `getAllEditor()` 返回的 Protyle 上取：真正的编辑器对象在
 *    `protyle.protyle`（插件 API 的 Protyle 是外壳，`IProtyle` 在它里面），
 *    而 `.protyle-wysiwyg` 那个容器**没有** `data-node-id`。照后者取会永远拿到空串，
 *    功能看起来就是"完全不生效"。
 * 3. 内核「添加图标」按钮的处理器会先写一个**随机** emoji 再打开选择面板，
 *    那次写入与本功能的写入是两个并发请求，谁后落盘谁生效 —— 随机值经常会赢。
 *    所以这里在捕获阶段把这次点击拦下来，改走内核选择面板里"点一个 emoji"的那条通路：
 *    只写配置好的图标，然后从内核自己的 `open-emoji` 入口把选择面板照常打开。
 */
import {
    fetchPost,
    getAllEditor,
} from "siyuan";
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

/** 「添加图标」按钮：只有还没有图标时才会出现。 */
const ADD_ICON_BUTTON = "button[data-type='icon']";
/** 标题区显示文档图标的容器；它自己的 `open-emoji` 分支负责打开选择面板。 */
const ICON_ELEMENT = ".protyle-background__icon";
const DEFAULT_EMOJI = "📄";

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

export const mountFirstDocIcon = (host: FeatureHost): FeatureInstance => {
    /**
     * 文件树（含固定页签、移动端侧栏）与大纲里那个图标元素。
     * 内核在 `updateFileTreeEmoji` / `updateOutlineEmoji` 里做的也是同一件事，
     * 但那两个函数不对外暴露，只能照着它俩的选择器就地更新。
     */
    const paintListIcons = (rootID: string, emoji: string) => {
        document.querySelectorAll<HTMLElement>(
            `[data-node-id="${rootID}"] .b3-list-item__icon, [data-node-id="${rootID}"] .b3-list-item__graphic`,
        ).forEach((element) => {
            element.textContent = emoji;
        });
    };

    /** 与"在选择面板里点一个 emoji"等价：写 `icon` 属性，再就地更新列表里的图标。 */
    const applyIcon = (rootID: string, emoji: string) => {
        const icon = toCodePoints(emoji);
        if (!icon) {
            return;
        }
        fetchPost("/api/attr/setBlockAttrs", {id: rootID, attrs: {icon}}, (response) => {
            if (response.code !== 0) {
                host.log(`写入文档图标失败：${response.msg}`);
                return;
            }
            paintListIcons(rootID, emoji);
        });
    };

    // 捕获阶段把这次点击拦下来：内核的处理器在冒泡阶段，捕获阶段一定能先拿到它，
    // 拦下之后就不会再走"先写一个随机 emoji"那条路
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
        const owner = getAllEditor().find((item) => item.protyle?.element?.contains(button));
        if (owner?.protyle.disabled) {
            // 只读文档里内核自己也不会加图标，跟着它一起不动
            return;
        }
        const rootID = owner?.protyle.block?.rootID || background.getAttribute("data-node-id") || "";
        if (!rootID) {
            host.log("没有取到文档 ID，已跳过");
            return;
        }
        const emoji = emojiOf(host);
        event.preventDefault();
        event.stopPropagation();
        applyIcon(rootID, emoji);
        // 图标先就地显形：一是马上能看到，二是下面这步要用它的位置来定位选择面板
        iconElement.textContent = emoji;
        iconElement.classList.remove("fn__none");
        button.classList.add("fn__none");
        // 走内核自己的 open-emoji 入口把选择面板打开，保留"想换随时能换"的原生行为
        iconElement.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true}));
    };

    document.addEventListener("click", onClick, true);

    return {
        destroy: () => document.removeEventListener("click", onClick, true),
    };
};
