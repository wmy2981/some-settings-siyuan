/**
 * 界面：把展开的智能体思考正文按段翻译后显示。
 *
 * 只改**前端显示**：宿主的 `.agent-chat__thinking-reasoning-text` 节点原样保留、
 * 内容继续由宿主写入，这里只是在它后面插一个自己的兄弟节点放译文，并在译文视图下
 * 用 CSS 把原文藏起来。切换原文 / 译文、折叠卡片、卸载插件都会把注入的节点与类名
 * 全部撤掉，不会留下任何痕迹；会话数据、请求内容与模型上下文一概不碰。
 *
 * 为什么插兄弟节点而不是改原文：流式输出时宿主每一帧都会重写原文的 `textContent`，
 * 直接改会被下一帧覆盖；反过来改写宿主节点也会干扰它的滚动与复制逻辑。兄弟节点方案
 * 让两边各写各的，卸载时只需删掉自己的节点。
 *
 * 翻译只在**思考正文展开时**进行：折叠状态下译文看不见，翻它纯属浪费请求；
 * 展开后按段翻译，流式尾巴保留原文（见 `translation.ts`）。折叠时立即取消在途请求。
 *
 * 卡片可能被宿主整块重建（重载会话、新一步追加），所以对账做成幂等的：
 * 每次 DOM 变化后重扫一遍，没有变化就不碰。
 */
import type {Logger} from "../../core/log";
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";
import {
    providerOf,
    requestTranslation,
    resolveTargetLanguage,
    targetPreferenceOf,
} from "./provider";
import type {
    TargetPreference,
    TranslationProvider,
} from "./provider";
import {ReasoningTranslation} from "./translation";
import type {
    TranslateText,
    TranslationState,
} from "./translation";

/** 智能体面板根节点；编辑器里的 AI 面板用的是另一套外壳，这里不接管。 */
const CHAT_ROOT = ".sy__agentChat";
/** 思考卡片；重试卡片是另一套类名。 */
const CARD_SELECTOR = ".agent-chat__msg--thinking";
const HEADER_SELECTOR = ".agent-chat__thinking-header";
const BODY_SELECTOR = ".agent-chat__thinking-body";
/** 思考正文（纯文本，宿主按帧重写）。 */
const REASONING_SELECTOR = ".agent-chat__thinking-reasoning-text";
/** 展开态；只有带这个类时才翻译。 */
const EXPANDED_CLASS = "agent-chat__thinking-body--expanded";
/** 已结束的思考卡片；没有它说明这一轮还在流式输出。 */
const DONE_CLASS = "agent-chat__msg--thinking-done";

const TOOLBAR_CLASS = "ss-agent-thinking-translate-toolbar";
const TOGGLE_CLASS = "ss-agent-thinking-translate-toggle";
const SPINNER_CLASS = "ss-agent-thinking-translate-spinner";
const FAILURE_CLASS = "ss-agent-thinking-translate-failure";
const RETRY_CLASS = "ss-agent-thinking-translate-retry";
const OUTPUT_CLASS = "ss-agent-thinking-translate-output";
const ORIGINAL_HIDDEN_CLASS = "ss-agent-thinking-translate-hidden";

/** 运行时文案；键都在本功能的命名空间里，`common.retry` 是面板通用的那颗重试。 */
interface Labels {
    original: string;
    translation: string;
    loading: string;
    failed: string;
    retry: string;
}

/** 当前选择的服务与目标语言；目标语言在创建时就解析成接口要的标签。 */
interface Selection {
    provider: TranslationProvider;
    preference: TargetPreference;
    target: string;
}

type View = "translated" | "original";

interface CardState {
    readonly card: HTMLElement;
    readonly header: HTMLElement;
    readonly body: HTMLElement;
    /** 译文缓存：折叠再展开、同一段在多个步骤里重复出现都不必重翻。 */
    readonly cache: Map<string, string>;
    /** 用户选的是译文还是原文；默认译文（功能开着就是为了看译文）。 */
    view: View;
    controller?: CardController;
}

interface Block {
    readonly element: HTMLElement;
    readonly output: HTMLElement;
    translation: ReasoningTranslation;
    state: TranslationState;
}

interface CardController {
    sync(): void;
    dispose(): void;
}

interface ControllerOptions {
    readonly translate: TranslateText;
    readonly labels: Labels;
    readonly log: Logger;
}

/**
 * 工具条、译文节点与状态机的装配。
 *
 * 工具条放在卡片标题行末尾（标题行是整行可点的折叠开关，所以这里的点击要
 * `stopPropagation`，否则点「查看原文」会顺手把卡片折起来）；折叠时整个工具条随
 * 控制器一起撤掉，展开时再建，位置与样式与 DSH 的「查看原文 / 查看译文」一致。
 */
const createCardController = (state: CardState, options: ControllerOptions): CardController => {
    const blocks = new Map<HTMLElement, Block>();

    const toolbar = document.createElement("span");
    toolbar.className = TOOLBAR_CLASS;
    toolbar.dataset.state = "ready";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = TOGGLE_CLASS;

    const spinner = document.createElement("span");
    spinner.className = SPINNER_CLASS;
    spinner.hidden = true;
    spinner.setAttribute("role", "status");
    spinner.setAttribute("aria-label", options.labels.loading);

    const failure = document.createElement("span");
    failure.className = FAILURE_CLASS;
    failure.textContent = options.labels.failed;
    failure.hidden = true;
    failure.setAttribute("role", "status");

    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = RETRY_CLASS;
    retry.textContent = options.labels.retry;
    retry.hidden = true;

    toolbar.append(toggle, spinner, failure, retry);
    state.header.append(toolbar);
    // 标题行的点击是折叠开关，工具条里的任何点击都不许冒泡上去
    toolbar.addEventListener("click", (event) => event.stopPropagation());

    const renderBlock = (block: Block): void => {
        const translated = state.view === "translated" && !block.state.failed;
        block.output.hidden = !translated;
        block.element.classList.toggle(ORIGINAL_HIDDEN_CLASS, translated);
        if (block.output.textContent !== block.state.text) {
            block.output.textContent = block.state.text;
        }
    };

    const renderToolbar = (): void => {
        let pending = false;
        let failed = false;
        blocks.forEach((block) => {
            pending = pending || block.state.pending;
            failed = failed || block.state.failed;
        });
        toolbar.dataset.state = failed ? "failed" : pending ? "pending" : "ready";
        // 失败时界面已经退回原文，按钮文字要指向「查看译文」；它同时被禁用，直到重试成功
        const label = state.view === "translated" && !failed ? options.labels.original : options.labels.translation;
        if (toggle.textContent !== label) {
            toggle.textContent = label;
        }
        toggle.disabled = failed;
        toggle.setAttribute("aria-label", label);
        spinner.hidden = !pending;
        failure.hidden = !failed;
        retry.hidden = !failed;
    };

    toggle.addEventListener("click", () => {
        if (toggle.disabled) {
            return;
        }
        state.view = state.view === "translated" ? "original" : "translated";
        blocks.forEach(renderBlock);
        renderToolbar();
        options.log.info(`thinking translation view switched to ${state.view}`);
    });
    retry.addEventListener("click", () => {
        blocks.forEach((block) => block.translation.retry());
        options.log.info("retrying the failed thinking translation");
    });

    const sync = (): void => {
        const elements = Array.from(state.body.querySelectorAll<HTMLElement>(REASONING_SELECTOR));
        const present = new Set(elements);
        blocks.forEach((block, element) => {
            if (present.has(element)) {
                return;
            }
            block.translation.dispose();
            block.output.remove();
            element.classList.remove(ORIGINAL_HIDDEN_CLASS);
            blocks.delete(element);
        });

        const last = elements[elements.length - 1];
        // 卡片没结束前，最后一段随时会继续追加，按「未完成」处理，尾巴保留原文
        const running = !state.card.classList.contains(DONE_CLASS);
        elements.forEach((element) => {
            let block = blocks.get(element);
            if (!block) {
                const output = document.createElement("div");
                output.className = OUTPUT_CLASS;
                element.after(output);
                block = {
                    element,
                    output,
                    state: {text: "", pending: false, failed: false},
                    translation: undefined as unknown as ReasoningTranslation,
                };
                block.translation = new ReasoningTranslation(options.translate, state.cache, (next) => {
                    block.state = next;
                    renderBlock(block);
                    renderToolbar();
                });
                blocks.set(element, block);
            } else if (!block.output.isConnected) {
                // 宿主整块重绘过正文：译文节点跟着原文重新插回去
                element.after(block.output);
            }
            block.translation.update(element.textContent ?? "", running && element === last);
        });
        renderToolbar();
    };

    return {
        sync,
        dispose: () => {
            blocks.forEach((block) => {
                block.translation.dispose();
                block.output.remove();
                block.element.classList.remove(ORIGINAL_HIDDEN_CLASS);
            });
            blocks.clear();
            toolbar.remove();
        },
    };
};

/** 从配置与界面语言算出这次要用的服务与目标语言。 */
const selectionOf = (host: FeatureHost): Selection => {
    const provider = providerOf(host.config.provider);
    const preference = targetPreferenceOf(host.config.target);
    const uiLanguage = window.siyuan?.config?.lang ?? "en";
    return {provider, preference, target: resolveTargetLanguage(preference, uiLanguage, provider)};
};

const CSS = `/* 思考卡片的译文：排版与原文一致，只换内容来源 */
.agent-chat__thinking-reasoning-text.${ORIGINAL_HIDDEN_CLASS} {
    display: none;
}

.${OUTPUT_CLASS} {
    color: var(--b3-theme-on-surface);
    line-height: 1.5;
    margin-bottom: 8px;
    white-space: pre-wrap;
    word-break: break-word;
}

/* 标题行末尾的翻译入口 */
.${TOOLBAR_CLASS} {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    margin-inline-start: auto;
    font-size: 12px;
    line-height: 16px;
}

.${TOGGLE_CLASS},
.${RETRY_CLASS} {
    border: 0;
    padding: 0;
    background: transparent;
    color: var(--b3-theme-primary);
    font: inherit;
    white-space: nowrap;
    cursor: pointer;
}

.${TOGGLE_CLASS}:disabled {
    color: var(--b3-theme-on-surface-light);
    cursor: default;
}

.${FAILURE_CLASS} {
    color: var(--b3-theme-error, #d23f31);
    white-space: nowrap;
}

.${SPINNER_CLASS} {
    width: 10px;
    height: 10px;
    border: 1.5px solid var(--b3-theme-on-surface-light);
    border-top-color: transparent;
    border-radius: 50%;
    animation: ss-agent-thinking-translate-spin .8s linear infinite;
}

@keyframes ss-agent-thinking-translate-spin {
    to {
        transform: rotate(360deg);
    }
}

@media (prefers-reduced-motion: reduce) {
    .${SPINNER_CLASS} {
        animation: none;
    }
}
`;

export const mountAgentThinkingTranslate = (host: FeatureHost): FeatureInstance => {
    host.addStyle(CSS);

    const labels: Labels = {
        original: host.i18n("feature.agentThinkingTranslate.originalAction"),
        translation: host.i18n("feature.agentThinkingTranslate.translationAction"),
        loading: host.i18n("feature.agentThinkingTranslate.loading"),
        failed: host.i18n("feature.agentThinkingTranslate.failed"),
        retry: host.i18n("common.retry"),
    };
    let selection = selectionOf(host);
    const cards = new Map<HTMLElement, CardState>();
    let frame = 0;
    let stopped = false;

    const sync = (): void => {
        if (stopped) {
            return;
        }
        const seen = new Set<HTMLElement>();
        document.querySelectorAll<HTMLElement>(`${CHAT_ROOT} ${CARD_SELECTOR}`).forEach((card) => {
            seen.add(card);
            const header = card.querySelector<HTMLElement>(HEADER_SELECTOR);
            const body = card.querySelector<HTMLElement>(BODY_SELECTOR);
            if (!header || !body) {
                return;
            }
            let state = cards.get(card);
            if (!state) {
                state = {card, header, body, cache: new Map(), view: "translated"};
                cards.set(card, state);
            }
            // 折叠时译文看不见，翻它没有意义；在途请求也一并取消
            if (!body.classList.contains(EXPANDED_CLASS)) {
                if (state.controller) {
                    state.controller.dispose();
                    state.controller = undefined;
                    host.log.info("stopped translating a collapsed thinking card");
                }
                return;
            }
            if (!state.controller) {
                state.controller = createCardController(state, {
                    translate: (text, signal) =>
                        requestTranslation({provider: selection.provider, text, target: selection.target}, signal),
                    labels,
                    log: host.log,
                });
                host.log.info("started translating an expanded thinking card", {
                    provider: selection.provider,
                    target: selection.target,
                    done: card.classList.contains(DONE_CLASS),
                });
            }
            state.controller.sync();
        });
        cards.forEach((state, card) => {
            if (seen.has(card) && card.isConnected) {
                return;
            }
            state.controller?.dispose();
            cards.delete(card);
            host.log.info("removed a thinking card from translation tracking");
        });
    };

    const schedule = (): void => {
        if (stopped || frame) {
            return;
        }
        frame = window.requestAnimationFrame(() => {
            frame = 0;
            sync();
        });
    };

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["class"],
    });

    host.onConfigChange(() => {
        const next = selectionOf(host);
        if (next.provider === selection.provider && next.target === selection.target) {
            return;
        }
        selection = next;
        host.log.info("translation service changed", {provider: next.provider, target: next.target});
        // 缓存按原文片段存，换了服务 / 目标语言后旧译文不再成立，整批丢掉重翻
        cards.forEach((state) => {
            state.controller?.dispose();
            state.controller = undefined;
            state.cache.clear();
        });
        schedule();
    });

    schedule();

    return {
        destroy: () => {
            stopped = true;
            observer.disconnect();
            if (frame) {
                window.cancelAnimationFrame(frame);
                frame = 0;
            }
            cards.forEach((state) => state.controller?.dispose());
            cards.clear();
        },
    };
};
