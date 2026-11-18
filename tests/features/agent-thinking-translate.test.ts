/**
 * 智能体思考翻译（`agent-thinking-translate`）的单元测试。
 *
 * 分三层：
 * 1. 纯逻辑：分段（含流式尾巴、超长段落、代理对）与两家服务的请求 / 响应；
 * 2. 状态机：只翻完整段落、串行、缓存、失败重试、取消后不再发布；
 * 3. DOM：只在 `.sy__agentChat` 的展开卡片上注入译文节点，切换原文 / 译文、
 *    折叠与卸载都不留残影。
 *
 * 网络层用 `mockState.fetchSyncPost` 驱动：被测代码只认内核代理的响应，
 * 测试里不需要真的联网。
 */
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import definition from "../../src/features/agent-thinking-translate/index";
import {
    buildRequest,
    parseTranslation,
    providerOf,
    resolveTargetLanguage,
    targetPreferenceOf,
} from "../../src/features/agent-thinking-translate/provider";
import {
    ReasoningTranslation,
    retryPolicyOf,
    splitFragments,
} from "../../src/features/agent-thinking-translate/translation";
import type {
    RetryPolicy,
    TranslationState,
} from "../../src/features/agent-thinking-translate/translation";
import {mountFeature} from "../helpers/feature-host";
import type {HostHarness} from "../helpers/feature-host";
import {mockState} from "../mocks/siyuan";

const EXPANDED_CLASS = "agent-chat__thinking-body--expanded";
const DONE_CLASS = "agent-chat__msg--thinking-done";
const OUTPUT_CLASS = "ss-agent-thinking-translate-output";
const HIDDEN_CLASS = "ss-agent-thinking-translate-hidden";
const TOOLBAR_CLASS = "ss-agent-thinking-translate-toolbar";
const TOGGLE_CLASS = "ss-agent-thinking-translate-toggle";
const RETRY_CLASS = "ss-agent-thinking-translate-retry";
const FAILURE_CLASS = "ss-agent-thinking-translate-failure";

/** 内核代理的一次调用；`body` 就是发给 `/api/network/forwardProxy` 的请求体。 */
interface ProxyCall {
    url: string;
    body: {
        url?: string;
        payload?: string;
        contentType?: string;
    };
}

/** 让一次或多次 `requestAnimationFrame` 跑完（源码用 rAF 合并 DOM 对账）。 */
const settle = async (): Promise<void> => {
    for (let index = 0; index < 3; index++) {
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    }
};

/**
 * 装一个假的微软翻译：把原文包上「译:」返回，并记录每次请求。
 *
 * @param respond 自定义响应；返回 `{code}` 非 0 表示内核代理失败，`{status}` 表示上游 HTTP 状态。
 */
const stubTranslation = (
    respond: (text: string) => {code?: number; status?: number; translated?: string;} = () => ({}),
): ProxyCall[] => {
    const calls: ProxyCall[] = [];
    mockState.fetchSyncPost.mockImplementation(async (_url: unknown, body: unknown) => {
        const call: ProxyCall = {url: String(_url), body: body as ProxyCall["body"]};
        calls.push(call);
        const text = (JSON.parse(call.body.payload ?? "[]") as string[])[0] ?? "";
        const result = respond(text);
        if (result.code !== undefined && result.code !== 0) {
            return {code: result.code, msg: "proxy failed", data: null};
        }
        const translated = result.translated ?? `tr:${text}`;
        return {
            code: 0,
            data: {
                status: result.status ?? 200,
                body: JSON.stringify([{translations: [{text: translated}]}]),
            },
        };
    });
    return calls;
};

interface CardOptions {
    /** 正文是否展开。 */
    expanded?: boolean;
    /** 是否已经结束流式输出。 */
    done?: boolean;
    /** 每个思考正文节点的初始文本。 */
    texts?: string[];
    /** 是否挂在智能体面板根节点下；false 用来验证「不接管编辑器 AI 面板」。 */
    inAgentChat?: boolean;
}

/** 造一张与宿主结构一致的思考卡片。 */
const buildCard = (options: CardOptions = {}) => {
    const root = document.createElement("div");
    root.className = options.inAgentChat === false ? "some-other-panel" : "sy__agentChat";
    const card = document.createElement("div");
    card.className = `agent-chat__msg agent-chat__msg--thinking${options.done ? ` ${DONE_CLASS}` : ""}`;
    card.innerHTML = '<div class="agent-chat__thinking-card">' +
        '<div class="agent-chat__thinking-header">' +
        '<span class="agent-chat__thinking-arrow"></span>' +
        '<span class="agent-chat__thinking-text">Thinking</span>' +
        '<span class="agent-chat__thinking-latest"></span>' +
        "</div>" +
        '<div class="agent-chat__thinking-body"></div>' +
        "</div>";
    const body = card.querySelector(".agent-chat__thinking-body") as HTMLElement;
    if (options.expanded) {
        body.classList.add(EXPANDED_CLASS);
    }
    const reasoning = (options.texts ?? [""]).map((text) => {
        const element = document.createElement("div");
        element.className = "agent-chat__thinking-reasoning-text";
        element.textContent = text;
        body.append(element);
        return element;
    });
    root.append(card);
    document.body.append(root);
    return {root, card, body, reasoning};
};

/** 卡片上插件注入的译文节点。 */
const outputOf = (card: HTMLElement): HTMLElement | null => card.querySelector<HTMLElement>(`.${OUTPUT_CLASS}`);

const toolbarOf = (card: HTMLElement): HTMLElement | null => card.querySelector<HTMLElement>(`.${TOOLBAR_CLASS}`);

const toggleOf = (card: HTMLElement): HTMLButtonElement =>
    card.querySelector<HTMLButtonElement>(`.${TOGGLE_CLASS}`) as HTMLButtonElement;

/** 测试里只关心这几条文案，其余 key 原样返回。 */
const LABELS: Record<string, string> = {
    "feature.agentThinkingTranslate.originalAction": "View original",
    "feature.agentThinkingTranslate.translationAction": "View translation",
    "feature.agentThinkingTranslate.loading": "Translating",
    "feature.agentThinkingTranslate.failed": "Translation failed",
    "common.retry": "Retry",
};

/** 挂载过的宿主，测试结束统一卸载：失败的用例也要把观察者收干净。 */
const mounted: HostHarness[] = [];

const mount = (config: Record<string, unknown> = {}): HostHarness => {
    const harness = mountFeature(definition, {
        config: {enabled: true, provider: "bing", target: "zhCn", ...config},
        i18n: (key) => LABELS[key] ?? key,
    });
    mounted.push(harness);
    return harness;
};

/**
 * 造一个翻译状态机，并记录它发布过的每个状态。
 *
 * @param translate 一次片段翻译；测试里自己决定成功、失败或挂起。
 * @param retry 自动重试策略；不传就完全不自动重试，失败直接进失败态。
 */
const createTranslation = (
    translate: (text: string, signal: AbortSignal) => Promise<string>,
    cache = new Map<string, string>(),
    retry?: RetryPolicy,
) => {
    const states: TranslationState[] = [];
    const translation = new ReasoningTranslation(
        translate,
        cache,
        (state) => states.push(state),
        retry ? {retry} : undefined,
    );
    return {translation, states, cache};
};

describe("agent thinking translation", () => {
    beforeEach(() => {
        // 目标语言固定成简体中文，测试不依赖运行环境的界面语言
        (window.siyuan.config as unknown as {lang: string;}).lang = "zh_CN";
    });

    afterEach(() => {
        mounted.splice(0).forEach((harness) => harness.dispose());
    });

    describe("splitFragments (fragmentation)", () => {
        it("empty text has no translatable fragment", () => {
            expect(splitFragments("", false)).toEqual([{text: "", suffix: "", complete: true}]);
        });

        it("blank-line separated paragraphs are independent, separating whitespace stays with the earlier one", () => {
            expect(splitFragments("A\n\nB", false)).toEqual([
                {text: "A", suffix: "\n\n", complete: true},
                {text: "B", suffix: "", complete: true},
            ]);
        });

        it("the last fragment is incomplete while streaming, earlier paragraphs stay complete", () => {
            expect(splitFragments("A\n\nB", true)).toEqual([
                {text: "A", suffix: "\n\n", complete: true},
                {text: "B", suffix: "", complete: false},
            ]);
        });

        it("oversized paragraphs are cut at the limit, preferring whitespace", () => {
            const text = `${"word ".repeat(10)}end`;
            const fragments = splitFragments(text, false, 12);
            expect(fragments.length).toBeGreaterThan(1);
            // 片段正文 + 分隔空白必须能拼回原文，一个字都不能丢
            expect(fragments.map((fragment) => fragment.text + fragment.suffix).join("")).toBe(text);
            fragments.forEach((fragment) => {
                expect(fragment.complete).toBe(true);
                expect(fragment.text.length).toBeLessThanOrEqual(12);
            });
        });

        it("never splits a surrogate pair", () => {
            const fragments = splitFragments("😀😀😀", false, 3);
            const pieces = fragments.map((fragment) => fragment.text);
            expect(pieces.join("")).toBe("😀😀😀");
            pieces.forEach((piece) => {
                expect(/^[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(piece)).toBe(false);
                expect(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(piece)).toBe(false);
            });
        });
    });

    describe("provider (service and language)", () => {
        it("invalid config falls back to the defaults: Bing + follow UI language", () => {
            expect(providerOf("bing")).toBe("bing");
            expect(providerOf("google")).toBe("google");
            expect(providerOf("deepseek")).toBe("bing");
            expect(targetPreferenceOf("zhTw")).toBe("zhTw");
            expect(targetPreferenceOf("ja")).toBe("auto");
        });

        it("simplified / traditional are normalized per service", () => {
            expect(resolveTargetLanguage("auto", "zh_CN", "google")).toBe("zh-CN");
            expect(resolveTargetLanguage("auto", "zh_TW", "google")).toBe("zh-TW");
            expect(resolveTargetLanguage("auto", "zh_TW", "bing")).toBe("zh-Hant");
            expect(resolveTargetLanguage("zhCn", "en_US", "bing")).toBe("zh-Hans");
            expect(resolveTargetLanguage("en", "zh_CN", "google")).toBe("en");
            expect(resolveTargetLanguage("auto", "en_US", "bing")).toBe("en");
            expect(resolveTargetLanguage("auto", "de_DE", "google")).toBe("de");
            expect(resolveTargetLanguage("auto", "", "bing")).toBe("en");
        });

        it("google request: client, source language, target language and form body", () => {
            const request = buildRequest({provider: "google", text: "hello world", target: "zh-CN"});
            const url = new URL(request.url);
            expect(url.origin + url.pathname).toBe("https://translate.googleapis.com/translate_a/single");
            expect(url.searchParams.get("client")).toBe("dict-chrome-ex");
            expect(url.searchParams.get("sl")).toBe("auto");
            expect(url.searchParams.get("tl")).toBe("zh-CN");
            expect(url.searchParams.get("dt")).toBe("t");
            expect(request.contentType).toBe("application/x-www-form-urlencoded");
            expect(new URLSearchParams(request.payload).get("q")).toBe("hello world");
        });

        it("bing request: target language, enterprise client flag and JSON array body", () => {
            const request = buildRequest({provider: "bing", text: "hello world", target: "zh-Hans"});
            const url = new URL(request.url);
            expect(url.origin + url.pathname).toBe("https://edge.microsoft.com/translate/translatetext");
            expect(url.searchParams.get("to")).toBe("zh-Hans");
            expect(url.searchParams.get("isEnterpriseClient")).toBe("false");
            expect(request.contentType).toBe("application/json");
            expect(JSON.parse(request.payload)).toEqual(["hello world"]);
        });

        it("google responses are joined per segment, bing takes the first translation", () => {
            expect(parseTranslation("google", [[["First.", "One."], ["Second.", "Two."]]])).toBe("First.Second.");
            expect(parseTranslation("bing", [{translations: [{text: "First."}]}])).toBe("First.");
        });

        it("throws on a malformed response instead of using a partial translation", () => {
            expect(() => parseTranslation("google", {})).toThrow();
            expect(() => parseTranslation("google", [[]])).toThrow();
            expect(() => parseTranslation("google", [[[1]]])).toThrow();
            expect(() => parseTranslation("bing", [])).toThrow();
            expect(() => parseTranslation("bing", [{translations: []}])).toThrow();
            expect(() => parseTranslation("bing", [{translations: [{}]}])).toThrow();
        });
    });

    describe("ReasoningTranslation (state machine)", () => {
        it("translates only complete paragraphs and keeps the streaming tail as-is, then translates it once finished", async () => {
            const calls: string[] = [];
            const {translation, states} = createTranslation(async (text) => {
                calls.push(text);
                return `tr:${text}`;
            });
            translation.update("A\n\nB", true);
            await Promise.resolve();
            await Promise.resolve();
            expect(calls).toEqual(["A"]);
            expect(states[states.length - 1].text).toBe("tr:A\n\nB");

            translation.update("A\n\nB", false);
            await Promise.resolve();
            await Promise.resolve();
            expect(calls).toEqual(["A", "B"]);
            expect(states[states.length - 1].text).toBe("tr:A\n\ntr:B");
        });

        it("does not request a fragment that hits the cache", async () => {
            const calls: string[] = [];
            const cache = new Map<string, string>();
            const translate = async (text: string) => {
                calls.push(text);
                return `tr:${text}`;
            };
            const first = createTranslation(translate, cache);
            first.translation.update("A", false);
            await Promise.resolve();
            await Promise.resolve();
            const second = createTranslation(translate, cache);
            second.translation.update("A", false);
            await Promise.resolve();
            await Promise.resolve();
            expect(calls).toEqual(["A"]);
            expect(second.states[second.states.length - 1].text).toBe("tr:A");
        });

        it("keeps the original text and stops after a failure, continues after a successful retry", async () => {
            let fail = true;
            const calls: string[] = [];
            const {translation, states} = createTranslation(async (text) => {
                calls.push(text);
                if (fail) {
                    throw new Error("boom");
                }
                return `tr:${text}`;
            });
            translation.update("A", false);
            await Promise.resolve();
            await Promise.resolve();
            const failedState = states[states.length - 1];
            expect(failedState.failed).toBe(true);
            expect(failedState.text).toBe("A");

            fail = false;
            translation.retry();
            await Promise.resolve();
            await Promise.resolve();
            expect(states[states.length - 1].failed).toBe(false);
            expect(states[states.length - 1].text).toBe("tr:A");
            expect(calls).toEqual(["A", "A"]);
        });

        it("publishes nothing after cancellation", async () => {
            let release: (value: string) => void = () => undefined;
            const pending = new Promise<string>((resolve) => {
                release = resolve;
            });
            const {translation, states} = createTranslation(() => pending);
            translation.update("A", false);
            await Promise.resolve();
            const count = states.length;
            translation.dispose();
            release("tr:A");
            await Promise.resolve();
            await Promise.resolve();
            expect(states.length).toBe(count);
        });
    });

    describe("retryPolicyOf (retry policy)", () => {
        it("missing values fall back to the default policy", () => {
            expect(retryPolicyOf(undefined, undefined)).toEqual({retries: 2, interval: 1000});
        });

        it("out-of-range and malformed values are clamped into the valid range", () => {
            expect(retryPolicyOf(-3, 5)).toEqual({retries: 0, interval: 200});
            expect(retryPolicyOf(99, 999999)).toEqual({retries: 5, interval: 10000});
            expect(retryPolicyOf("3", null)).toEqual({retries: 2, interval: 1000});
            expect(retryPolicyOf(1.6, 250.4)).toEqual({retries: 2, interval: 250});
        });
    });

    describe("automatic retry", () => {
        afterEach(() => {
            vi.useRealTimers();
        });

        it("retries per policy after a failure, then continues with the next paragraph", async () => {
            vi.useFakeTimers();
            const calls: string[] = [];
            let failures = 1;
            const {translation, states} = createTranslation(
                async (text) => {
                    calls.push(text);
                    if (failures > 0) {
                        failures -= 1;
                        throw new Error("boom");
                    }
                    return `tr:${text}`;
                },
                new Map(),
                {retries: 2, interval: 500},
            );
            translation.update("A\n\nB", false);
            await vi.advanceTimersByTimeAsync(0);
            expect(calls).toEqual(["A"]);
            await vi.advanceTimersByTimeAsync(500);
            expect(calls).toEqual(["A", "A", "B"]);
            expect(states[states.length - 1].failed).toBe(false);
            expect(states[states.length - 1].text).toBe("tr:A\n\ntr:B");
        });

        it("stays pending while retrying and fails only after retries run out", async () => {
            vi.useFakeTimers();
            let calls = 0;
            const {translation, states} = createTranslation(
                async () => {
                    calls += 1;
                    throw new Error("boom");
                },
                new Map(),
                {retries: 1, interval: 200},
            );
            translation.update("A", false);
            await vi.advanceTimersByTimeAsync(0);
            expect(states[states.length - 1].pending).toBe(true);
            expect(states[states.length - 1].failed).toBe(false);
            await vi.advanceTimersByTimeAsync(200);
            expect(calls).toBe(2);
            expect(states[states.length - 1].failed).toBe(true);
            expect(states[states.length - 1].text).toBe("A");
            await vi.advanceTimersByTimeAsync(5000);
            expect(calls).toBe(2);
        });

        it("a manual retry grants another round of automatic retries", async () => {
            vi.useFakeTimers();
            let calls = 0;
            const {translation, states} = createTranslation(
                async () => {
                    calls += 1;
                    throw new Error("boom");
                },
                new Map(),
                {retries: 1, interval: 200},
            );
            translation.update("A", false);
            await vi.advanceTimersByTimeAsync(200);
            expect(calls).toBe(2);
            translation.retry();
            await vi.advanceTimersByTimeAsync(200);
            expect(calls).toBe(4);
            expect(states[states.length - 1].failed).toBe(true);
        });

        it("sends a single request when retries are 0", async () => {
            let calls = 0;
            const {translation, states} = createTranslation(
                async () => {
                    calls += 1;
                    throw new Error("boom");
                },
                new Map(),
                {retries: 0, interval: 200},
            );
            translation.update("A", false);
            for (let index = 0; index < 4; index++) {
                await Promise.resolve();
            }
            expect(calls).toBe(1);
            expect(states[states.length - 1].failed).toBe(true);
        });

        it("cancelling during backoff stops retrying and publishes no failure state", async () => {
            vi.useFakeTimers();
            let calls = 0;
            const {translation, states} = createTranslation(
                async () => {
                    calls += 1;
                    throw new Error("boom");
                },
                new Map(),
                {retries: 3, interval: 500},
            );
            translation.update("A", false);
            await vi.advanceTimersByTimeAsync(0);
            expect(calls).toBe(1);
            const count = states.length;
            translation.dispose();
            await vi.advanceTimersByTimeAsync(5000);
            expect(calls).toBe(1);
            expect(states.length).toBe(count);
        });
    });

    describe("UI", () => {
        it("does not translate and injects no toolbar while collapsed", async () => {
            const calls = stubTranslation();
            const {card} = buildCard({expanded: false, texts: ["A\n\nB"]});
            const harness = mount();
            await settle();
            expect(calls).toHaveLength(0);
            expect(toolbarOf(card)).toBeNull();
            expect(outputOf(card)).toBeNull();
            harness.dispose();
        });

        it("translates per paragraph once expanded: complete paragraphs show the translation, the streaming tail stays original", async () => {
            const calls = stubTranslation();
            const {card, reasoning} = buildCard({expanded: true, texts: ["First paragraph.\n\nSecond paragraph"]});
            const harness = mount();
            await settle();
            await expect
                .poll(() => outputOf(card)?.textContent)
                .toBe("tr:First paragraph.\n\nSecond paragraph");
            expect(calls).toHaveLength(1);
            // 原文节点只被加了隐藏类，内容仍是宿主写的那份
            expect(reasoning[0].textContent).toBe("First paragraph.\n\nSecond paragraph");
            expect(reasoning[0].classList.contains(HIDDEN_CLASS)).toBe(true);

            reasoning[0].textContent = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph";
            await settle();
            await expect
                .poll(() => outputOf(card)?.textContent)
                .toBe("tr:First paragraph.\n\ntr:Second paragraph.\n\nThird paragraph");
            expect(calls).toHaveLength(2);

            card.classList.add(DONE_CLASS);
            await settle();
            await expect
                .poll(() => outputOf(card)?.textContent)
                .toBe("tr:First paragraph.\n\ntr:Second paragraph.\n\ntr:Third paragraph");
            harness.dispose();
        });

        it("clicking the translate entry in the header does not collapse the card and toggles between original and translation", async () => {
            stubTranslation();
            const {card, reasoning} = buildCard({expanded: true, done: true, texts: ["Hello"]});
            const harness = mount();
            await settle();
            await expect.poll(() => outputOf(card)?.textContent).toBe("tr:Hello");

            let headerClicks = 0;
            const header = card.querySelector(".agent-chat__thinking-header") as HTMLElement;
            header.addEventListener("click", () => {
                headerClicks += 1;
            });

            const toggle = toggleOf(card);
            expect(toggle.textContent).toBe("View original");
            toggle.click();
            expect(headerClicks).toBe(0);
            expect(outputOf(card)?.hidden).toBe(true);
            expect(reasoning[0].classList.contains(HIDDEN_CLASS)).toBe(false);
            expect(toggle.textContent).toBe("View translation");

            toggle.click();
            expect(outputOf(card)?.hidden).toBe(false);
            expect(reasoning[0].classList.contains(HIDDEN_CLASS)).toBe(true);
            expect(toggle.textContent).toBe("View original");
            harness.dispose();
        });

        it("shows the original text, reports the failure and offers a retry when the request fails", async () => {
            let fail = true;
            stubTranslation(() => (fail ? {code: 1} : {}));
            const {card, reasoning} = buildCard({expanded: true, done: true, texts: ["Hello"]});
            // 关掉自动重试，让失败立刻暴露（自动重试本身另有专门用例）
            const harness = mount({retries: 0});
            await settle();
            await expect.poll(() => card.querySelector<HTMLElement>(`.${FAILURE_CLASS}`)?.hidden).toBe(false);
            expect(outputOf(card)?.hidden).toBe(true);
            expect(reasoning[0].classList.contains(HIDDEN_CLASS)).toBe(false);
            expect(toggleOf(card).disabled).toBe(true);
            // 已经退回原文，按钮文字指向「查看译文」，但重试成功前不可点
            expect(toggleOf(card).textContent).toBe("View translation");

            fail = false;
            (card.querySelector(`.${RETRY_CLASS}`) as HTMLButtonElement).click();
            await expect.poll(() => outputOf(card)?.textContent).toBe("tr:Hello");
            expect(outputOf(card)?.hidden).toBe(false);
            expect(card.querySelector<HTMLElement>(`.${FAILURE_CLASS}`)?.hidden).toBe(true);
            expect(toggleOf(card).disabled).toBe(false);
            harness.dispose();
        });

        it("retries automatically on a transient failure, then shows the translation and logs a warning", async () => {
            let fail = true;
            const calls = stubTranslation(() => {
                if (!fail) {
                    return {};
                }
                fail = false;
                return {code: 1};
            });
            const {card} = buildCard({expanded: true, done: true, texts: ["Hello"]});
            const harness = mount({retries: 1, retryInterval: 200});
            await settle();
            await expect.poll(() => outputOf(card)?.textContent, {timeout: 2000}).toBe("tr:Hello");
            expect(calls).toHaveLength(2);
            expect(card.querySelector<HTMLElement>(`.${FAILURE_CLASS}`)?.hidden).toBe(true);
            expect(harness.records.logLevels).toContain("warn");
            expect(harness.records.logs.some((args) => String(args[0]).includes("retrying thinking translation")))
                .toBe(true);
            harness.dispose();
        });

        it("keeps the cache when only the retry settings change and does not retranslate finished paragraphs", async () => {
            const calls = stubTranslation();
            const {card} = buildCard({expanded: true, done: true, texts: ["Hello"]});
            const harness = mount();
            await settle();
            await expect.poll(() => outputOf(card)?.textContent).toBe("tr:Hello");
            harness.config.retries = 4;
            harness.notifyConfigChange();
            await settle();
            expect(calls).toHaveLength(1);
            expect(outputOf(card)?.textContent).toBe("tr:Hello");
            harness.dispose();
        });

        it("removes the translation node and toolbar when collapsed and cancels later requests", async () => {
            const calls = stubTranslation();
            const {card, body, reasoning} = buildCard({expanded: true, done: true, texts: ["Hello"]});
            const harness = mount();
            await settle();
            await expect.poll(() => outputOf(card)?.textContent).toBe("tr:Hello");

            body.classList.remove(EXPANDED_CLASS);
            await settle();
            expect(outputOf(card)).toBeNull();
            expect(toolbarOf(card)).toBeNull();
            expect(reasoning[0].classList.contains(HIDDEN_CLASS)).toBe(false);

            reasoning[0].textContent = "Hello again";
            await settle();
            expect(calls).toHaveLength(1);
            harness.dispose();
        });

        it("only takes over the agent panel, leaving the editor AI panel alone", async () => {
            const calls = stubTranslation();
            const {card} = buildCard({expanded: true, texts: ["Hello"], inAgentChat: false});
            const harness = mount();
            await settle();
            expect(calls).toHaveLength(0);
            expect(toolbarOf(card)).toBeNull();
            harness.dispose();
        });

        it("leaves no node or class name behind after unmounting", async () => {
            stubTranslation();
            const {card, reasoning} = buildCard({expanded: true, done: true, texts: ["Hello"]});
            const harness = mount();
            await settle();
            await expect.poll(() => outputOf(card)?.textContent).toBe("tr:Hello");

            harness.dispose();
            expect(outputOf(card)).toBeNull();
            expect(toolbarOf(card)).toBeNull();
            expect(reasoning[0].classList.contains(HIDDEN_CLASS)).toBe(false);
        });

        it("clears the cache and retranslates after switching the service or target language", async () => {
            const calls = stubTranslation();
            const {card} = buildCard({expanded: true, done: true, texts: ["Hello"]});
            const harness = mount();
            await settle();
            await expect.poll(() => outputOf(card)?.textContent).toBe("tr:Hello");
            expect(new URL(calls[0].body.url ?? "").searchParams.get("to")).toBe("zh-Hans");

            harness.config.target = "en";
            harness.notifyConfigChange();
            await settle();
            await expect.poll(() => calls.length).toBe(2);
            expect(new URL(calls[1].body.url ?? "").searchParams.get("to")).toBe("en");
            harness.dispose();
        });
    });
});
