/**
 * 思考正文的分段翻译：只翻已经结束的段落，正在流式追加的尾巴保留原文。
 *
 * 直接照搬 DSH 官方「思考过程翻译」插件（`dsh-experimental-client-ui-cot-translation`
 * 的 `ReasoningTranslation`）的取舍：
 * - 段落以空行分隔，**完整段落**才发请求；最后一段在流式结束前始终算未完成，
 *   否则每来一个 token 就要发一次请求，既慢又会被免费接口限流；
 * - 超长段落按上限切开，优先切在空白处，不把代理对（emoji 这类）劈成两半；
 * - 译文按原文片段缓存，同一段不会重复请求；已翻好的段落先显示译文，没翻到的先显示原文；
 * - 请求逐个串行，失败就停下并保留原文，等用户点「重试」；取消（折叠 / 卸载）后
 *   不再发布任何结果。
 *
 * 这里不碰任何会话数据：调用方把「要显示成什么文本」渲染到自己的节点里，
 * 宿主的原文节点一直原样保留。
 */

/** 一个可翻译片段：正文、它后面的分隔空白、以及是否已经完整。 */
export interface Fragment {
    text: string;
    suffix: string;
    complete: boolean;
}

/** 当前该显示什么：拼好的文本、是否还有请求在跑、是否失败。 */
export interface TranslationState {
    text: string;
    pending: boolean;
    failed: boolean;
}

/** 一次翻译调用；`signal` 取消时应当尽快拒绝。 */
export type TranslateText = (text: string, signal: AbortSignal) => Promise<string>;

/** 单次请求的字符上限，与 DSH 的 translator 默认值一致。 */
export const MAX_TEXT_CHARS = 4000;

/**
 * 把思考正文切成片段。
 *
 * @param text 当前完整原文（流式时是累计到这一刻的全部内容）。
 * @param running 尾部是否还在流式追加；为真时最后一段不算完整。
 * @param maxChars 单个请求的字符上限。
 */
export const splitFragments = (text: string, running: boolean, maxChars = MAX_TEXT_CHARS): Fragment[] => {
    const fragments: Fragment[] = [];
    const separator = /\r?\n(?:[\t ]*\r?\n)+/g;
    let start = 0;
    while (true) {
        const match = separator.exec(text);
        let remaining = text.slice(start, match?.index ?? text.length);
        while (remaining.length > maxChars) {
            let cut = maxChars;
            // 不把 UTF-16 代理对劈开：切点落在高位代理上就往前挪一位
            if (/[\uD800-\uDBFF]/.test(remaining.charAt(cut - 1))) {
                cut -= 1;
            }
            // 优先切在空白处，别把单词拆到两次请求里
            const whitespace = remaining.slice(0, cut).search(/\s+\S*$/);
            if (whitespace > 0) {
                cut = whitespace;
            }
            const source = remaining.slice(0, cut);
            remaining = remaining.slice(cut);
            const suffix = remaining.match(/^\s+/)?.[0] ?? "";
            remaining = remaining.slice(suffix.length);
            fragments.push({text: source, suffix, complete: true});
        }
        fragments.push({text: remaining, suffix: match?.[0] ?? "", complete: match !== null || !running});
        if (match === null) {
            return fragments;
        }
        start = match.index + match[0].length;
    }
};

/**
 * 一块思考正文的翻译状态机。
 *
 * 生命周期与「展开的思考卡片」绑定：折叠、切换服务或卸载时 `dispose()`，
 * 之后所有在途结果都会被丢弃。译文缓存由调用方持有，折叠再展开不必重翻。
 */
export class ReasoningTranslation {
    private readonly controller = new AbortController();
    private fragments: Fragment[] = [];
    private pending = false;
    private failed = false;
    private disposed = false;

    /**
     * @param translate 发一次请求；失败抛错。
     * @param cache 译文缓存，键是原文片段。
     * @param publish 状态变化时回调，由调用方决定怎么渲染。
     */
    constructor(
        private readonly translate: TranslateText,
        private readonly cache: Map<string, string>,
        private readonly publish: (state: TranslationState) => void,
    ) {}

    /** 接入最新的原文；已翻好的片段直接复用缓存。 */
    update(text: string, running: boolean): void {
        if (this.disposed) {
            return;
        }
        this.fragments = splitFragments(text, running);
        this.publishState();
        void this.pump();
    }

    /** 失败后重试未翻完的片段。 */
    retry(): void {
        if (this.disposed || !this.failed) {
            return;
        }
        this.failed = false;
        this.publishState();
        void this.pump();
    }

    /** 取消在途请求并停止发布；可重复调用。 */
    dispose(): void {
        this.disposed = true;
        this.controller.abort();
    }

    private publishState(): void {
        if (this.disposed) {
            return;
        }
        this.publish(this.snapshot());
    }

    /** 已翻片段用译文、其余用原文，再拼回原来的分隔空白。 */
    private snapshot(): TranslationState {
        const text = this.fragments.map((fragment) => {
            const translated = fragment.complete ? this.cache.get(fragment.text) : undefined;
            return (translated ?? fragment.text) + fragment.suffix;
        }).join("");
        return {text, pending: this.pending, failed: this.failed};
    }

    /** 下一个还没翻的完整片段；没有就返回 undefined。 */
    private next(): Fragment | undefined {
        return this.fragments.find((fragment) =>
            fragment.complete && fragment.text.trim() !== "" && !this.cache.has(fragment.text)
        );
    }

    /** 串行把能翻的片段翻完；任何失败都停下，等用户重试。 */
    private async pump(): Promise<void> {
        if (this.pending || this.failed || this.disposed) {
            return;
        }
        let next = this.next();
        if (!next) {
            return;
        }
        this.pending = true;
        this.publishState();
        try {
            while (next) {
                const translated = await this.translate(next.text, this.controller.signal);
                if (this.disposed) {
                    return;
                }
                this.cache.set(next.text, translated);
                this.publishState();
                next = this.next();
            }
        } catch {
            // 取消不算失败；真正的请求错误保留原文并暴露重试
            if (!this.disposed) {
                this.failed = true;
                this.publishState();
            }
        } finally {
            this.pending = false;
            this.publishState();
        }
    }
}
