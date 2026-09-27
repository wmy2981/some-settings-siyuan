/**
 * 文档树标题的行级 Markdown 渲染。
 *
 * 只认这几种语法：加粗、斜体、粗斜体、删除线、高亮，外加行级代码。
 * 反斜杠转义的下一个字符按字面输出，并且不再参与配对。
 *
 * 输出的 DOM 有两处讲究：
 *
 * - 定界符本身**留在 DOM 里**，只是一个被 CSS 隐藏的 `<span>`。于是标题的
 *   `.textContent` 永远等于原文 —— 思源有不少地方直接读它（拖拽提示、加密笔记本
 *   的解锁提示等），功能关掉时也能原样还原，不需要另外记一份原文。
 * - 强调沿用思源自己的行级标记写法（`span[data-type~="strong"]` 等），行级代码
 *   用它自己的 `.fn__code`；与大纲树里渲染块内容的方式一致，色值全部取主题变量。
 */

/** 我们生成的每个元素都带这个属性：既当样式钩子，也当「这块内容归我们渲染」的标记。 */
export const MARK_ATTR = "data-ss-md";

/** 标题里一个语法字符都没有时，整条渲染流程都可以跳过。 */
export const MARKDOWN_CHARS = /[*_~=`\\]/;

/** 定界符 → 长度 → 由外到内的样式；没列出的长度按字面输出（例如四个星号）。 */
const STYLES: Record<string, Record<number, string[]>> = {
    "*": {1: ["em"], 2: ["strong"], 3: ["strong", "em"]},
    "_": {1: ["em"], 2: ["strong"], 3: ["strong", "em"]},
    "~": {2: ["s"]},
    "=": {2: ["mark"]},
};

/**
 * 只挡 ASCII 的字母数字。
 *
 * 目的是别把 `snake_case`、`2024_01_01` 这类词内下划线当成语法；中文标题里
 * `_` 基本不会出现在词内部，因此不需要跟着做 Unicode 判定。
 */
const WORD_CHAR = /[0-9A-Za-z]/;

const isWordAt = (source: string, index: number): boolean =>
    index >= 0 && index < source.length && WORD_CHAR.test(source[index]);

/** 从 index 起、字符 char 连续出现的长度；调用方保证 index 处就是该字符。 */
const runLengthAt = (source: string, index: number, char: string): number => {
    let length = 0;
    while (source[index + length] === char) {
        length++;
    }
    return length;
};

/**
 * 找配对的闭合定界符，返回它的起点下标；找不到返回 -1。
 *
 * 同一字符、同样长度、前面不能是空白或反斜杠转义，`_` 后面还不能紧跟词字符 ——
 * 这几条合起来才能让 `snake_case` 与 `*斜体 **粗体** 斜体*` 各自得到正确结果。
 */
const findCloser = (source: string, from: number, char: string, length: number): number => {
    for (let index = from; index < source.length; index++) {
        const current = source[index];
        if (current === "\\") {
            index++;
            continue;
        }
        if (current !== char || source[index - 1] === char) {
            continue;
        }
        if (runLengthAt(source, index, char) !== length) {
            continue;
        }
        if (/\s/.test(source[index - 1])) {
            continue;
        }
        if (char === "_" && isWordAt(source, index + length)) {
            continue;
        }
        return index;
    }
    return -1;
};

/** 一个带样式的元素。行级代码不写 `data-type`，只用思源自己的工具类上色。 */
const createStyled = (kind: string): HTMLElement => {
    const element = document.createElement("span");
    element.setAttribute(MARK_ATTR, kind);
    if (kind === "code") {
        element.className = "fn__code";
    } else {
        element.setAttribute("data-type", kind);
    }
    return element;
};

/** 按 kinds 从外到内套起来；kinds 只有一项时就是那一层。 */
const wrap = (kinds: string[], content: Node[]): HTMLElement => {
    let element = createStyled(kinds[kinds.length - 1]);
    element.append(...content);
    for (let index = kinds.length - 2; index >= 0; index--) {
        const outer = createStyled(kinds[index]);
        outer.append(element);
        element = outer;
    }
    return element;
};

/**
 * 把标题原文渲染成节点。定界符也作为隐藏节点放进结果里，所以结果的 textContent
 * 与入参完全一致。
 */
export const renderInlineMarkdown = (source: string): Node[] => {
    const nodes: Node[] = [];
    let plain = "";

    /** 先落字面文本再放元素，顺序就是原文顺序。 */
    const append = (...items: Node[]) => {
        if (plain) {
            nodes.push(document.createTextNode(plain));
            plain = "";
        }
        nodes.push(...items);
    };

    /** 定界符本身：留在 DOM 里，由 CSS 隐藏。 */
    const marker = (text: string): HTMLElement => {
        const element = document.createElement("span");
        element.setAttribute(MARK_ATTR, "marker");
        element.textContent = text;
        return element;
    };

    let index = 0;
    while (index < source.length) {
        const char = source[index];

        // 转义：下一个字符按字面输出，也不再参与配对。反斜杠自己也留在 DOM 里
        // （隐藏），这样 textContent 依旧等于原文。
        if (char === "\\" && index + 1 < source.length) {
            append(marker("\\"));
            plain += source[index + 1];
            index += 2;
            continue;
        }

        // 行级代码：内容取到下一个反引号，内部不再解析
        if (char === "`") {
            const end = source.indexOf("`", index + 1);
            if (end > index + 1) {
                append(
                    marker("`"),
                    wrap(["code"], [document.createTextNode(source.slice(index + 1, end))]),
                    marker("`"),
                );
                index = end + 1;
                continue;
            }
            plain += char;
            index++;
            continue;
        }

        const styles = STYLES[char];
        // 只有「一段连续定界符的第一个字符」才是候选，长度也必须是支持的写法
        const length = source[index - 1] === char || !styles ? 0 : runLengthAt(source, index, char);
        const kinds = styles?.[length];
        if (!kinds) {
            plain += char;
            index++;
            continue;
        }

        const contentStart = index + length;
        // 开定界符后面不能紧跟空白或结束；`_` 还不能紧跟在词字符后面
        if (
            contentStart >= source.length || /\s/.test(source[contentStart]) ||
            (char === "_" && isWordAt(source, index - 1))
        ) {
            plain += char;
            index++;
            continue;
        }

        const end = findCloser(source, contentStart, char, length);
        if (end < 0) {
            plain += source.slice(index, contentStart);
            index = contentStart;
            continue;
        }

        append(
            marker(source.slice(index, contentStart)),
            wrap(kinds, renderInlineMarkdown(source.slice(contentStart, end))),
            marker(source.slice(end, end + length)),
        );
        index = end + length;
    }

    append();
    return nodes;
};
