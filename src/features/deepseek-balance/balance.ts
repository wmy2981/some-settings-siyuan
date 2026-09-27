/**
 * 「智能体面板显示 DeepSeek 余额」的实现。
 *
 * 展示位置是输入框**外面**、紧贴它下沿的一行：`.agent-chat__input-area` 是有边框的
 * 整块输入区（标题栏那一行按钮也在框内），余额是常驻状态而不是输入动作的一部分，
 * 塞进按钮行会和图片、权限、模型挤在一起，也让输入框显得更拥挤；挂在框外则和输入区
 * 分开，读起来像它下面的一行说明。这里刻意不复用 `block__icon` 之类的图标按钮类 ——
 * 那套类在面板里受 `file-tree` 的 hover 规则约束，余额需要常驻可见，所以走功能自己
 * 的类名与样式。
 *
 * 面板是懒创建的，也会被销毁重建，因此注入必须幂等、可重入、可清理：
 * 用 MutationObserver 盯着 body 找面板，找到后改成盯面板本身（面板里流式输出时
 * 每一帧都在改消息区，全量观察 body 太浪费），节点丢了就重新插一次。
 * 面板「从不可见变为可见」（展开停靠栏）或节点刚被重新插上时，如果此刻手里没有
 * 余额，就立刻补查一次，不必等下一个周期。
 *
 * 日志按「主题 + 内容变化」输出：这个功能每 30 秒跑一次，按次打日志既刷屏又看不出
 * 变化，而它出问题时恰恰是「什么都不显示」，所以节点注入 / 移除、查询目标变化、
 * 查询成功与失败都各留一条，且同一条不重复。绝不打印 API Key。
 *
 * 关于数据来源的两条硬约束：
 * 1. `window.siyuan.config` 在保存设置时会被整体替换，所以每次取值都重新读，
 *    绝不缓存 `config.ai` 的对象引用；
 * 2. 接口地址只用 baseURL 的 `origin` 拼接，因为用户在设置里把生成协议切到
 *    anthropic 之后，baseURL 会变成 `https://api.deepseek.com/anthropic`，
 *    直接拿来拼 `/user/balance` 会打到不存在的路径上。
 */
import {guardSilent} from "../../core/error";
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

/** 余额节点的挂载点：有边框的整块输入区。余额插在它**后面**，即输入框外面。 */
const INPUT_AREA_SELECTOR = ".sy__agentChat .agent-chat__input-area";
/** 我们注入的余额节点标记：既用于幂等判断，也用于卸载时兜底清理。 */
const NODE_ATTR = "data-ss-deepseek-balance";
/** 智能体面板的模型选择器，它的 `data-model-id` 才是「此刻真正在用哪个模型」。 */
const MODEL_PICKER_SELECTOR = ".sy__agentChat .agent-chat__model-picker";
/** 只认官网。用户可能配置网关代理，那种情况下余额接口不可用。 */
const OFFICIAL_HOST = "api.deepseek.com";
/** 余额接口。DeepSeek 没有把余额挂进 OpenAI 兼容路由，它是站点自己的 REST 接口。 */
const BALANCE_PATH = "/user/balance";
/** 单次请求的超时；避免面板关掉后请求一直挂着。 */
const REQUEST_TIMEOUT_MS = 15000;
/** 查询周期。面板里配的就是它，落地时再夹一次区间。默认值与 index.ts 的 default 一致。 */
const DEFAULT_INTERVAL_SECONDS = 30;
const MIN_INTERVAL_SECONDS = 1;
const MAX_INTERVAL_SECONDS = 3600;

/** 官方接口返回的一条余额。金额是字符串，不是数字。 */
interface RawBalanceInfo {
    currency?: string;
    total_balance?: string;
    granted_balance?: string;
    topped_up_balance?: string;
}

interface RawBalanceResponse {
    is_available?: boolean;
    balance_infos?: RawBalanceInfo[];
}

interface BalanceInfo {
    currency: string;
    total: string;
    granted: string;
    toppedUp: string;
}

/**
 * 能查到余额的那套配置。`apiKey` / `origin` 是快照，不是 config 里的引用。
 * `modelId` 只用于日志，方便判断「查的是不是我以为的那个模型」。
 */
interface BalanceTarget {
    apiKey: string;
    modelId: string;
    origin: string;
}

/** 一次查询的结果。失败也走这里，让渲染层统一处理。 */
interface BalanceFetch {
    ok: boolean;
    infos: BalanceInfo[];
    /** 余额不足以继续调用接口；注意它不代表没有余额。 */
    available: boolean;
    error?: string;
}

type RenderState =
    | {kind: "idle";}
    | {kind: "loading";}
    | {kind: "failed";}
    | {kind: "value"; infos: BalanceInfo[]; available: boolean;};

/**
 * 输入框外面那一行余额的样式。
 *
 * 全是布局属性：字号、行高、内外边距与缩略规则。颜色一律继承思源原生变量，
 * 这样浅色 / 深色主题都自动跟随，也不需要和任何原生控件去比特异性。
 *
 * 负的上外边距是有意的：输入区自己带 `margin: 0 16px 12px`，直接跟在它后面会离边框
 * 12px 远、看着像独立的一段；把这一行往上收进那段下外边距里，就成了紧贴边框的一行
 * 说明。左右外边距与输入区的 16px 对齐，两者内容左边缘在同一条线上。
 */
const BALANCE_CSS = `
.ss-deepseek-balance {
    margin: -6px 16px 6px;
    overflow: hidden;
    /* 与输入框里的权限文案、模型名持平，不抢视线 */
    color: var(--b3-theme-on-surface);
    font-size: 12px;
    line-height: 16px;
    white-space: nowrap;
    text-overflow: ellipsis;
    cursor: default;
    -webkit-user-select: text;
    user-select: text;
}
`;

/** 币种与符号。只声明确实由官方接口返回的两个币种，其余按代码原样展示。 */
const CURRENCY_SYMBOLS: Record<string, string> = {
    CNY: "¥",
    USD: "$",
};

/** 金额字符串按数字解析；解析不出来就原样返回，宁可显示字符串也不显示 NaN。 */
const formatAmount = (value: string): string => {
    const amount = Number.parseFloat(value);
    if (!Number.isFinite(amount)) {
        return value;
    }
    return amount.toFixed(2);
};

const normalizeInfo = (info: RawBalanceInfo): BalanceInfo => ({
    currency: typeof info?.currency === "string" ? info.currency : "",
    total: typeof info?.total_balance === "string" ? info.total_balance : "",
    granted: typeof info?.granted_balance === "string" ? info.granted_balance : "",
    toppedUp: typeof info?.topped_up_balance === "string" ? info.topped_up_balance : "",
});

/**
 * 多条余额记录时选一条展示，其余折成附加信息。
 *
 * 优先展示人民币：官网账户充值的计价币种就是 CNY，USD 一般只在赠金或海外结算时出现。
 * 没有 CNY 就退回第一条，保证「有余额就一定有数字可看」。
 */
const pickBalance = (
    infos: BalanceInfo[],
): {primary?: BalanceInfo; extras: string[];} => {
    if (infos.length === 0) {
        return {extras: []};
    }
    const primary = infos.find((info) => info.currency.toUpperCase() === "CNY") ?? infos[0];
    const extras = infos
        .filter((info) => info !== primary)
        .map((info) => `${info.currency} ${formatAmount(info.total)}`);
    return {primary, extras};
};

/** 把状态压成一段可见文案 + 一段详细说明。详细说明统一进 `title`，不额外占位。 */
const describe = (state: RenderState, t: (key: string) => string): {text: string; title: string;} => {
    if (state.kind === "idle") {
        // 没有启用中的官网 DeepSeek 配置（或者当前不是官网模型）：不显示任何余额之类的东西，
        // 只留一个最淡的占位，避免顶栏为了一个不适用的功能闪来闪去。
        const notConfigured = t("deepseekBalance.noProvider");
        return {text: "—", title: notConfigured};
    }
    if (state.kind === "loading") {
        return {text: "…", title: t("deepseekBalance.loading")};
    }
    if (state.kind === "failed") {
        return {text: "—", title: t("deepseekBalance.failed")};
    }

    const {primary, extras} = pickBalance(state.infos);
    if (!primary) {
        // 请求成功但一条余额都没有：明确说"查不到"，不要伪装成 0 元。
        return {text: "—", title: `${t("deepseekBalance.empty")}${extras.length > 0 ? `\n${extras.join("\n")}` : ""}`};
    }

    const symbol = CURRENCY_SYMBOLS[primary.currency.toUpperCase()] ?? "";
    const amount = formatAmount(primary.total);
    // 未知币种没有符号，补上币种代码，免得顶栏只有一个看不出单位的数字
    const shown = symbol ? `${symbol}${amount}` : `${primary.currency} ${amount}`.trim();
    const detail = [
        `${primary.currency} ${amount}`.trim(),
        `${t("deepseekBalance.granted")} ${formatAmount(primary.granted)}`,
        `${t("deepseekBalance.toppedUp")} ${formatAmount(primary.toppedUp)}`,
        ...extras,
    ];
    if (!state.available) {
        // is_available 为 false 只表示余额不足以继续调用，余额数字本身仍然有效。
        detail.push(t("deepseekBalance.insufficient"));
    }
    const insufficient = state.available ? "" : "!";
    return {text: `${shown}${insufficient}`, title: detail.join("\n")};
};

/**
 * 从 baseURL 取官方站点地址。
 *
 * 只认 hostname：用户可能把生成协议切成 anthropic（此时 baseURL 带 `/anthropic`），
 * 也可能自己带上 `/v1` 或查询参数，这些都不该影响判定，但接口地址必须回到 origin。
 */
const originOf = (baseURL: string): string | undefined => {
    if (typeof baseURL !== "string" || !baseURL.trim()) {
        return undefined;
    }
    try {
        const url = new URL(baseURL.trim());
        if (url.hostname.toLowerCase() !== OFFICIAL_HOST) {
            return undefined;
        }
        return url.origin;
    } catch {
        return undefined;
    }
};

/**
 * 找出此刻应该在哪个地址、用哪个 Key 查余额。
 *
 * 模型 id 优先取面板 DOM 里那个 —— 用户可以只给当前会话换个模型，此时
 * `config.ai.agent.modelId` 还是旧值。DOM 里拿不到才回落到配置。
 * provider 与 model 都必须 enabled，与内核自己的判定保持一致。
 */
const resolveTarget = (): BalanceTarget | undefined => {
    const ai = window.siyuan?.config?.ai;
    const providers = ai?.providers;
    if (!Array.isArray(providers)) {
        return undefined;
    }

    const domModelId = document.querySelector<HTMLElement>(MODEL_PICKER_SELECTOR)?.dataset.modelId;
    const modelId = domModelId || ai?.agent?.modelId || "";
    if (!modelId) {
        return undefined;
    }

    for (const provider of providers) {
        if (!provider?.enabled || !Array.isArray(provider.models)) {
            continue;
        }
        if (!provider.models.some((model) => model?.enabled && model.id === modelId)) {
            continue;
        }
        const origin = originOf(provider.baseURL);
        const apiKey = typeof provider.apiKey === "string" ? provider.apiKey.trim() : "";
        if (!origin || !apiKey) {
            // 命中官网却没填 Key（或者不是官网）：继续看下一个候选，不弹错也不刷屏。
            continue;
        }
        return {apiKey, modelId, origin};
    }
    return undefined;
};

/** 周期换算成轮询用的毫秒；面板已经限过区间，这里再夹一次防止配置文件被手改坏。 */
const intervalMsOf = (host: FeatureHost): number => {
    const configured = Number(host.config.interval);
    const seconds = Number.isFinite(configured) ? configured : DEFAULT_INTERVAL_SECONDS;
    return Math.min(MAX_INTERVAL_SECONDS, Math.max(MIN_INTERVAL_SECONDS, Math.round(seconds))) * 1000;
};

const readJson = async (response: Response): Promise<unknown> => {
    const text = await response.text();
    if (!text.trim()) {
        return undefined;
    }
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
};

/** 接口报错时 body 形如 `{"error":{"message":"..."}}`，有就带上，没有就回落状态码。 */
const errorMessageOf = (payload: unknown, response: Response): string => {
    const message = (payload as {error?: {message?: unknown;};} | undefined)?.error?.message;
    if (typeof message === "string" && message.trim()) {
        return message.trim();
    }
    return `HTTP ${response.status}`;
};

export const mountDeepseekBalance = (host: FeatureHost): FeatureInstance => {
    let node: HTMLElement | undefined;
    let timer = 0;
    let frame = 0;
    let observer: MutationObserver | undefined;
    let bodyObserver: MutationObserver | undefined;
    let currentPanel: HTMLElement | undefined;
    let controller: AbortController | undefined;
    let inFlight = false;
    let destroyed = false;
    let lastText: string | undefined;
    let lastTitle: string | undefined;
    let lastState: RenderState = {kind: "idle"};
    /** 上一帧面板是否可见，用来识别「刚展开停靠栏」。 */
    let panelWasVisible = false;
    /** 每个日志主题上一次输出的内容，相同就不再重复输出。 */
    const logTopics = new Map<string, string>();

    const t = (key: string): string => host.i18n(key);
    host.addStyle(BALANCE_CSS);

    /**
     * 按主题打日志：同一主题内容不变就不再输出。
     *
     * 这个功能是定时跑的，按次打日志会把控制台刷满；而它「不显示」的时候，
     * 恰恰需要知道停在哪一步，所以只在状态真的变化时留一条。
     */
    const logOnChange = (topic: string, message: string): void => {
        if (logTopics.get(topic) === message) {
            return;
        }
        logTopics.set(topic, message);
        host.log(message);
    };

    /**
     * 盯住整个 body，专管「面板出现 / 消失 / 被换掉」。
     *
     * 面板是懒创建的，也可能被用户从停靠栏上移除后重建、或被整体搬到别的位置，
     * 这些变化都发生在面板之外 —— 只看面板本身永远等不到它们。
     * 回调按帧合并，且每帧只做一次选择器查询，代价可控。
     */
    const observeBody = () => {
        if (bodyObserver) {
            return;
        }
        bodyObserver = new MutationObserver(() => schedule());
        bodyObserver.observe(document.body, {childList: true, subtree: true});
    };

    /**
     * 观察面板本身与它的祖先容器，而不是整个 body。
     *
     * 面板里流式输出时每一帧都在改消息区，全量观察 body 会让 apply 每帧跑一次；
     * 而面板内的 childList / class 变化足够回答「挂载点还在不在」。
     * 祖先单独盯一层是因为**折叠 / 展开停靠栏改的是面板自己或它外面的容器**（`fn__none`），
     * 只盯面板会漏掉「刚展开」这一下，而「展开时手里没余额就补查一次」正需要它。
     * 面板被整体搬走（换停靠位置）由 body 观察器兜底。
     */
    const observePanel = (panel: HTMLElement) => {
        if (currentPanel === panel && observer) {
            return;
        }
        observer?.disconnect();
        currentPanel = panel;
        observer = new MutationObserver(() => schedule());
        observer.observe(panel, {childList: true, attributes: true, attributeFilter: ["class", "style"]});
        for (
            let ancestor = panel.parentElement;
            ancestor && ancestor !== document.body;
            ancestor = ancestor.parentElement
        ) {
            observer.observe(ancestor, {attributes: true, attributeFilter: ["class", "style"]});
        }
    };

    const clearNode = () => {
        const existed = Boolean(node) || document.querySelector(`[${NODE_ATTR}]`) !== null;
        if (node) {
            guardSilent("deepseek-balance.remove", () => node?.remove());
            node = undefined;
        }
        // 兜底：面板被重建等异常路径下可能残留一个已经失去引用的节点
        document.querySelectorAll<HTMLElement>(`[${NODE_ATTR}]`).forEach((element) => element.remove());
        if (existed) {
            logOnChange("node", "Balance node removed (the mount point is gone)");
        }
    };

    /** 节点可见与否：`getClientRects()` 为空说明它落在 `display: none` 的子树里。 */
    const isVisible = (element: HTMLElement): boolean => element.getClientRects().length > 0;

    /**
     * 手里没有余额时立刻补查一次。
     *
     * 「打开面板却什么都不显示」是最容易让人以为功能坏了的情况，而下一个周期
     * 可能还在几十秒之后。已经有余额就不打扰，正在查的由 tick 自己的 inFlight 挡住。
     */
    const refreshIfEmpty = () => {
        if (lastState.kind !== "value") {
            void tick();
        }
    };

    /**
     * 确保余额节点在输入区**外面**、紧贴它的下沿。
     *
     * 注入前先摘掉两个观察器：否则这次写入会再触发一次自己（典型表现是每帧一次空转）。
     * 两个断开都发生在同步块里，紧接着就按当前面板重新挂上。
     * 挂载点没变动时直接返回，不去动观察器 —— 面板自己每秒都在改消息区，
     * 每次都重建观察器既浪费，也会把排队中的变更记录一并丢掉。
     */
    const apply = () => {
        if (destroyed) {
            return;
        }
        const anchor = document.querySelector<HTMLElement>(INPUT_AREA_SELECTOR);
        if (!anchor) {
            // 面板还没出现，或者刚被移除：连已经注入的节点一起收回，不留孤儿。
            bodyObserver?.disconnect();
            clearNode();
            panelWasVisible = false;
            logOnChange("panel", "Agent panel is not in the DOM yet (or was removed); nothing is shown");
            observeBody();
            return;
        }
        const panel = anchor.closest<HTMLElement>(".sy__agentChat");
        if (!panel) {
            return;
        }
        const visible = isVisible(panel);
        // 位置判据用「紧跟在输入区后面」而不是「父节点是谁」：输入区的父节点就是
        // `.agent-chat`，面板里任何一次改动都可能把节点挪到别处，紧跟其后才是本功能要的位置。
        if (node?.isConnected && anchor.nextElementSibling === node) {
            if (visible && !panelWasVisible) {
                logOnChange("panel", "Agent panel became visible");
                refreshIfEmpty();
            }
            panelWasVisible = visible;
            observePanel(panel);
            return;
        }
        bodyObserver?.disconnect();
        observer?.disconnect();
        observer = undefined;
        currentPanel = undefined;
        node?.remove();
        node = document.createElement("div");
        node.className = "ss-deepseek-balance";
        node.setAttribute(NODE_ATTR, "true");
        anchor.insertAdjacentElement("afterend", node);
        // 新节点上没有任何已写入的文案，清掉去重缓存，保证这一帧一定渲染
        lastText = undefined;
        lastTitle = undefined;
        render();
        observePanel(panel);
        observeBody();
        panelWasVisible = visible;
        logOnChange("node", `Balance node injected outside the composer (panel ${visible ? "visible" : "hidden"})`);
        // 节点刚插上通常就是「面板刚打开 / 刚被重建」，此刻没有余额就立刻查一次
        refreshIfEmpty();
    };

    /** 把当前状态写进节点。文案没变就不碰 DOM —— 这是防止观察器自激的最后一道闸。 */
    const render = () => {
        if (!node) {
            return;
        }
        const {text, title} = describe(lastState, t);
        if (text !== lastText) {
            node.textContent = text;
            lastText = text;
        }
        if (title === lastTitle) {
            return;
        }
        lastTitle = title;
        if (title) {
            node.title = title;
            node.setAttribute("aria-label", title);
        } else {
            node.removeAttribute("title");
            node.removeAttribute("aria-label");
        }
    };

    const schedule = () => {
        if (destroyed || frame) {
            return;
        }
        frame = window.requestAnimationFrame(() => {
            frame = 0;
            apply();
        });
    };

    /**
     * 取消当前请求。
     *
     * 超时与 destroy 共用它：重复 abort 是安全的（AbortController 自己幂等），
     * 这样两个入口都不必先判断 controller 是否还在。
     */
    const abortRequest = () => {
        guardSilent("deepseek-balance.abort", () => controller?.abort());
    };

    const fetchBalance = async (target: BalanceTarget): Promise<BalanceFetch> => {
        controller = new AbortController();
        const requestSignal = controller.signal;
        const timeoutId = window.setTimeout(() => abortRequest(), REQUEST_TIMEOUT_MS);
        try {
            const response = await fetch(`${target.origin}${BALANCE_PATH}`, {
                method: "GET",
                headers: {
                    // 桌面端与移动端 WebView 直连官网都不会遇到 CORS，官网返回的是宽松的跨域头。
                    Authorization: `Bearer ${target.apiKey}`,
                    Accept: "application/json",
                },
                signal: requestSignal,
            });
            const payload = await readJson(response);
            if (!response.ok) {
                return {
                    ok: false,
                    infos: [],
                    available: true,
                    error: errorMessageOf(payload, response),
                };
            }
            const body = payload as RawBalanceResponse | undefined;
            const infos = Array.isArray(body?.balance_infos) ? body.balance_infos.map(normalizeInfo) : [];
            return {ok: true, infos, available: body?.is_available !== false};
        } catch (error) {
            return {
                ok: false,
                infos: [],
                available: true,
                error: error instanceof Error ? error.message : String(error),
            };
        } finally {
            window.clearTimeout(timeoutId);
        }
    };

    /**
     * 一次查询。
     *
     * 失败只在输入框下面那一段里降级显示，控制台按主题记一条就够 —— 定时器每 30 秒
     * 跑一次，一旦开始报错就会刷屏，所以绝不在这里 reportError / showMessage。
     */
    const tick = async () => {
        if (destroyed || inFlight) {
            return;
        }
        const target = resolveTarget();
        if (!target) {
            logOnChange(
                "target",
                "No enabled DeepSeek provider on api.deepseek.com (or it has no API key); skipping the query",
            );
            if (lastState.kind !== "idle") {
                lastState = {kind: "idle"};
                render();
            }
            return;
        }
        logOnChange("target", `Querying ${target.origin}${BALANCE_PATH} (model ${target.modelId})`);
        inFlight = true;
        if (lastState.kind !== "value") {
            lastState = {kind: "loading"};
            render();
        }
        try {
            const result = await fetchBalance(target);
            if (destroyed) {
                return;
            }
            if (result.ok) {
                lastState = {kind: "value", infos: result.infos, available: result.available};
                const primary = pickBalance(result.infos).primary;
                logOnChange(
                    "fetch",
                    primary ?
                        `Balance: ${primary.currency} ${primary.total}` :
                        "Balance query succeeded but the API returned no balance entries",
                );
            } else {
                logOnChange("fetch", `Balance query failed: ${result.error}`);
                lastState = {kind: "failed"};
            }
            render();
        } finally {
            inFlight = false;
        }
    };

    /** 条件触发：配置没变就什么都不用做。 */
    const runNow = () => {
        if (destroyed) {
            return;
        }
        void tick();
    };

    const startTimer = () => {
        window.clearInterval(timer);
        timer = window.setInterval(() => {
            // 页面不可见时不做无意义的后台请求；回到前台会由 focus 事件补一次。
            if (!document.hidden) {
                void tick();
            }
        }, intervalMsOf(host));
    };

    const onAiConfigChanged = () => {
        apply();
        runNow();
    };
    const onFocus = () => {
        apply();
        if (!document.hidden) {
            runNow();
        }
    };

    // 保存「人工智能」设置只会派发这个普通 window 事件，不走事件总线。
    window.addEventListener("siyuan-ai-config-changed", onAiConfigChanged);
    // 其它设置保存会让思源整体替换 `window.siyuan.config`，没有任何专门事件，
    // 只能从 `setConf` 推送里兜底重算一次。
    host.addEventBus("ws-main", (event) => {
        if ((event.detail as {cmd?: string;} | undefined)?.cmd === "setConf") {
            runNow();
        }
    });
    // 思源自己也用 focus 兜底：切回窗口时补齐可能错过的状态变化。
    window.addEventListener("focus", onFocus);
    host.onConfigChange(() => {
        startTimer();
        runNow();
    });

    apply();
    startTimer();
    runNow();
    host.log(`Mounted; polling every ${intervalMsOf(host) / 1000}s`);

    return {
        destroy: () => {
            if (destroyed) {
                return;
            }
            destroyed = true;
            host.log("Unmounted; polling and injection stopped");
            // 先停掉所有会再调进来的入口，再清资源，destroy 幂等
            window.removeEventListener("siyuan-ai-config-changed", onAiConfigChanged);
            window.removeEventListener("focus", onFocus);
            guardSilent("deepseek-balance.observer", () => observer?.disconnect());
            observer = undefined;
            guardSilent("deepseek-balance.bodyObserver", () => bodyObserver?.disconnect());
            bodyObserver = undefined;
            currentPanel = undefined;
            window.clearInterval(timer);
            timer = 0;
            if (frame) {
                window.cancelAnimationFrame(frame);
                frame = 0;
            }
            abortRequest();
            controller = undefined;
            clearNode();
        },
    };
};
