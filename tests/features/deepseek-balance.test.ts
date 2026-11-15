/**
 * 「DeepSeek 余额显示」（deepseek-balance）。
 *
 * 这个功能的三段是分开的：**目标解析**（读 `window.siyuan.config.ai` 与面板里的模型选择器）、
 * **网络**（`/user/balance` 的各种响应形状）、**渲染**（输入框外面那一行）。测试也照这个分层：
 * `mockState` 之外只补 `fetch` 与面板 DOM，其余全部由 `mountFeature` 的真实现驱动。
 *
 * 定时器用假时钟（轮询周期、15 秒超时都要能确定地推进）；`getClientRects()` 在 jsdom 里
 * 恒为空，而它正是「面板是否可见」的判据，所以可见性用例单独给面板补一个桩。
 */
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import type {FeatureConfig} from "../../src/core/types";
import {mountDeepseekBalance} from "../../src/features/deepseek-balance/balance";
import definition from "../../src/features/deepseek-balance/index";
import zhCN from "../../src/i18n/zh-CN.json";
import {
    type HostHarness,
    mountFeature,
} from "../helpers/feature-host";

const t = (key: string): string => (zhCN as Record<string, string>)[key] ?? key;

/** 渲染出来的那一行永远以这个前缀开头（前缀自带分隔符，见 zh-CN）。 */
const LABEL = t("feature.deepseekBalance.label");

const NODE_SELECTOR = "[data-ss-deepseek-balance]";

interface ProviderLike {
    enabled?: boolean;
    baseURL?: string;
    apiKey?: string;
    models?: {id: string; enabled?: boolean;}[];
}

/** 一份「能用」的官网 provider，各用例只覆盖自己关心的字段。 */
const provider = (overrides: Partial<ProviderLike> = {}): ProviderLike => ({
    enabled: true,
    baseURL: "https://api.deepseek.com",
    apiKey: "sk-test-key",
    models: [{id: "deepseek-chat", enabled: true}],
    ...overrides,
});

const setAi = (providers: unknown, modelId = "deepseek-chat"): void => {
    (window.siyuan as unknown as {config: {ai: unknown;};}).config.ai = {
        providers,
        agent: {modelId},
    };
};

/**
 * 造一个智能体面板。
 *
 * 结构照真实面板：`.sy__agentChat` 里先是消息区，然后是那块有边框的输入区 ——
 * 余额要插在输入区**后面**（输入框外面）。
 */
const mountPanel = (options: {visible?: boolean; modelId?: string;} = {}): HTMLElement => {
    document.body.innerHTML = `<div class="sy__agentChat">
        <div class="agent-chat__messages"></div>
        ${
        options.modelId === undefined ?
            "" :
            `<div class="agent-chat__model-picker" data-model-id="${options.modelId}"></div>`
    }
        <div class="agent-chat__input-area"></div>
    </div>`;
    const panel = document.querySelector<HTMLElement>(".sy__agentChat")!;
    if (options.visible) {
        // jsdom 的 getClientRects() 恒为空，而功能用它判断节点是否落在 display:none 子树里
        panel.getClientRects = () => [{width: 320, height: 600}] as unknown as DOMRectList;
    }
    return panel;
};

const balanceNode = (): HTMLElement | null => document.querySelector<HTMLElement>(NODE_SELECTOR);

interface RespondInit {
    ok?: boolean;
    status?: number;
    body?: unknown;
    /** 直接给定响应体文本（用于「不是 JSON」「空响应」这类形状）。 */
    text?: string;
}

/** `fetch` 的替身：返回一个最小 Response（只用到 ok / status / text）。 */
const respondWith = (init: RespondInit = {}) => {
    // 入参类型写在泛型上：测试要断言调用 URL 与 headers，而 `vi.fn(async () => …)` 的
    // calls 会被推成空元组；直接写形参又会被 lint 判成未使用
    const fn = vi.fn<(...args: [string, RequestInit]) => Promise<unknown>>(async () => ({
        ok: init.ok ?? true,
        status: init.status ?? 200,
        text: async () => init.text ?? (init.body === undefined ? "" : JSON.stringify(init.body)),
    }));
    vi.stubGlobal("fetch", fn);
    return fn;
};

/** 官方接口一条余额记录。 */
const balanceBody = (infos: unknown[], available: unknown = true): unknown => ({
    is_available: available,
    balance_infos: infos,
});

const cny = (overrides: Record<string, unknown> = {}) => ({
    currency: "CNY",
    total_balance: "12.5",
    granted_balance: "5",
    topped_up_balance: "7.5",
    ...overrides,
});

const mounted: HostHarness[] = [];

const mount = (config: FeatureConfig = {}): HostHarness => {
    const harness = mountFeature(definition, {config, i18n: t});
    mounted.push(harness);
    return harness;
};

const logsOf = (harness: HostHarness): string[] => harness.records.logs.map((entry) => String(entry[0]));

afterEach(() => {
    mounted.splice(0).forEach((harness) => harness.dispose());
    vi.useRealTimers();
    vi.unstubAllGlobals();
    // 可见性用例会给 document 加一个 own property，必须拆掉，否则污染后续用例
    delete (document as unknown as {hidden?: boolean;}).hidden;
});

describe("DeepSeek 余额显示", () => {
    describe("注入与样式", () => {
        it("注入布局样式：紧跟输入区、左右与输入框对齐、单行省略", () => {
            const harness = mount();
            const css = harness.css();

            expect(css).toContain(".ss-deepseek-balance");
            // 负上边距是为了把这一行收进输入区自己的下外边距里，看着像它的一行说明
            expect(css).toContain("margin: -6px 16px 6px");
            expect(css).toContain("text-align: center");
            expect(css).toContain("font-size: 12px");
            expect(css).toContain("white-space: nowrap");
            expect(css).toContain("text-overflow: ellipsis");
            // 颜色必须继承原生变量，深色主题才自动跟随
            expect(css).toContain("var(--b3-theme-on-surface)");
            expect(harness.styleElement()).not.toBeNull();
        });

        it("面板还没出现时什么都不显示，只留一条日志", () => {
            const harness = mount();
            expect(balanceNode()).toBeNull();
            expect(logsOf(harness)).toContain(
                "Agent panel is not in the DOM yet (or was removed); nothing is shown",
            );
        });

        it("余额节点插在输入区之后（输入框外面），不在输入区里面", () => {
            mountPanel();
            mount();

            const anchor = document.querySelector(".agent-chat__input-area")!;
            const node = balanceNode()!;
            expect(node).not.toBeNull();
            expect(node.classList.contains("ss-deepseek-balance")).toBe(true);
            // 刚插上时还没有任何余额（idle），这一行先按「不可见」收起来，
            // 查到结果再展开 —— 否则用户会先看到一个「—」
            expect(node.classList.contains("fn__none")).toBe(true);
            expect(anchor.nextElementSibling).toBe(node);
            expect(node.parentElement).toBe(document.querySelector(".sy__agentChat"));
            expect(anchor.contains(node)).toBe(false);
        });

        it("面板被移除后节点跟着收回，不留孤儿", async () => {
            vi.useFakeTimers();
            mountPanel();
            const harness = mount();
            await vi.advanceTimersByTimeAsync(0);
            expect(balanceNode()).not.toBeNull();

            document.body.innerHTML = "";
            // 兜底由轮询那一拍完成：观察器万一漏掉，下一轮也要把节点补回来 / 收回去
            await vi.advanceTimersByTimeAsync(30000);

            expect(balanceNode()).toBeNull();
            expect(logsOf(harness)).toContain("Balance node removed (the mount point is gone)");
        });

        it("同一个功能重复 apply 不会插出第二个节点", async () => {
            mountPanel();
            const harness = mount();
            await vi.waitFor(() => expect(balanceNode()).not.toBeNull());

            harness.emitBus("ws-main", {cmd: "setConf"});
            harness.emitBus("ws-main", {cmd: "setConf"});
            window.dispatchEvent(new Event("focus"));

            expect(document.querySelectorAll(NODE_SELECTOR)).toHaveLength(1);
        });
    });

    describe("查询目标解析", () => {
        it("不在官方站点上就整行收起，且不发请求", async () => {
            const fetchMock = respondWith({body: balanceBody([])});
            mountPanel();
            setAi([provider({baseURL: "https://api.openai.com/v1"})]);
            const harness = mount();
            await vi.waitFor(() => expect(balanceNode()).not.toBeNull());

            expect(fetchMock).not.toHaveBeenCalled();
            expect(balanceNode()!.classList.contains("fn__none")).toBe(true);
            expect(logsOf(harness).some((line) => line.includes("No enabled DeepSeek provider")))
                .toBe(true);
        });

        it.each([
            ["baseURL 不是合法地址", provider({baseURL: "not a url"})],
            ["provider 没启用", provider({enabled: false})],
            ["模型没启用", provider({models: [{id: "deepseek-chat", enabled: false}]})],
            ["模型 id 对不上", provider({models: [{id: "deepseek-reasoner", enabled: true}]})],
            ["API Key 是空白串", provider({apiKey: "   "})],
        ])("%s时不查询", async (_label, candidate) => {
            const fetchMock = respondWith({body: balanceBody([])});
            mountPanel();
            setAi([candidate]);
            mount();
            await vi.waitFor(() => expect(balanceNode()).not.toBeNull());

            expect(fetchMock).not.toHaveBeenCalled();
        });

        it("providers 不是数组时安静跳过（配置被别人改坏也不能抛）", async () => {
            const fetchMock = respondWith({body: balanceBody([])});
            mountPanel();
            setAi("oops");
            mount();
            await vi.waitFor(() => expect(balanceNode()).not.toBeNull());

            expect(fetchMock).not.toHaveBeenCalled();
        });

        it("面板里选中的模型优先于配置里的 modelId", async () => {
            // 用户可以只给当前会话换模型，此时 config.ai.agent.modelId 还是旧值
            const fetchMock = respondWith({body: balanceBody([cny()])});
            mountPanel({modelId: "deepseek-chat"});
            setAi([provider()], "some-other-model");
            mount();

            await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        });

        it("协议切成 anthropic 后仍打到站点根上的 /user/balance", async () => {
            // baseURL 会变成 https://api.deepseek.com/anthropic，直接拼路径会打到不存在的地址
            const fetchMock = respondWith({body: balanceBody([cny()])});
            mountPanel();
            setAi([provider({baseURL: "https://api.deepseek.com/anthropic"})]);
            mount();

            await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
            expect(fetchMock.mock.calls[0][0]).toBe("https://api.deepseek.com/user/balance");
        });

        it("多个 provider 时用第一个命中的（前面的可能不是官网）", async () => {
            const fetchMock = respondWith({body: balanceBody([cny()])});
            mountPanel();
            setAi([
                provider({baseURL: "https://api.openai.com"}),
                provider({apiKey: "sk-second"}),
            ]);
            mount();

            await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
            expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({
                Authorization: "Bearer sk-second",
            });
        });
    });

    describe("查询与渲染", () => {
        it("请求形状：GET + Bearer Key + JSON 接受类型", async () => {
            const fetchMock = respondWith({body: balanceBody([cny()])});
            mountPanel();
            setAi([provider()]);
            mount();

            await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
            const [url, init] = fetchMock.mock.calls[0];
            expect(url).toBe("https://api.deepseek.com/user/balance");
            expect(init.method).toBe("GET");
            expect(init.headers).toEqual({
                Authorization: "Bearer sk-test-key",
                Accept: "application/json",
            });
            expect(init.signal).toBeInstanceOf(AbortSignal);
        });

        it("人民币余额：显示符号 + 两位小数，明细进 title", async () => {
            respondWith({body: balanceBody([cny()])});
            mountPanel();
            setAi([provider()]);
            mount();

            await vi.waitFor(() => expect(balanceNode()!.textContent).toBe(`${LABEL}¥12.50`));
            const node = balanceNode()!;
            expect(node.classList.contains("fn__none")).toBe(false);
            // title 里是完整明细：币种、赠金、充值余额
            expect(node.title).toBe("CNY 12.50\n赠金 5.00\n充值余额 7.50");
            expect(node.getAttribute("aria-label")).toBe(node.title);
        });

        it("多条余额优先展示 CNY，其余折进明细", async () => {
            // 官网充值以人民币计价，USD 一般只在赠金或海外结算时出现
            respondWith({
                body: balanceBody([
                    {currency: "USD", total_balance: "3", granted_balance: "3", topped_up_balance: "0"},
                    cny(),
                ]),
            });
            mountPanel();
            setAi([provider()]);
            mount();

            await vi.waitFor(() => expect(balanceNode()!.textContent).toBe(`${LABEL}¥12.50`));
            expect(balanceNode()!.title.split("\n").at(-1)).toBe("USD 3.00");
        });

        it("只有 USD 时用 $ 符号", async () => {
            respondWith({
                body: balanceBody([{
                    currency: "USD",
                    total_balance: "1.5",
                    granted_balance: "0",
                    topped_up_balance: "1.5",
                }]),
            });
            mountPanel();
            setAi([provider()]);
            mount();

            await vi.waitFor(() => expect(balanceNode()!.textContent).toBe(`${LABEL}$1.50`));
        });

        it("未知币种没有符号，用币种代码顶上", async () => {
            respondWith({
                body: balanceBody([{
                    currency: "EUR",
                    total_balance: "3",
                    granted_balance: "0",
                    topped_up_balance: "3",
                }]),
            });
            mountPanel();
            setAi([provider()]);
            mount();

            await vi.waitFor(() => expect(balanceNode()!.textContent).toBe(`${LABEL}EUR 3.00`));
        });

        it("is_available 为 false：数字照旧显示，末尾加感叹号并在明细里说明", async () => {
            // is_available 只表示「不足以继续调用」，余额本身仍然有效，不能显示成 0 或 —
            respondWith({body: balanceBody([cny()], false)});
            mountPanel();
            setAi([provider()]);
            mount();

            await vi.waitFor(() => expect(balanceNode()!.textContent).toBe(`${LABEL}¥12.50!`));
            expect(balanceNode()!.title).toContain(t("feature.deepseekBalance.insufficient"));
        });

        it("is_available 缺省时视为可用，不加感叹号", async () => {
            respondWith({body: {balance_infos: [cny()]}});
            mountPanel();
            setAi([provider()]);
            mount();

            await vi.waitFor(() => expect(balanceNode()!.textContent).toBe(`${LABEL}¥12.50`));
        });

        it("金额解析不出来时原样显示字符串，绝不显示 NaN", async () => {
            // 注意不能拿 "12.3x" 当例子：parseFloat 会取到 12.3，那是「能解析」的一类
            respondWith({
                body: balanceBody([cny({total_balance: "n/a", granted_balance: "", topped_up_balance: "0"})]),
            });
            mountPanel();
            setAi([provider()]);
            mount();

            await vi.waitFor(() => expect(balanceNode()!.textContent).toBe(`${LABEL}¥n/a`));
            expect(balanceNode()!.title).toContain("赠金 ");
        });

        it("金额带尾巴时按数字解析并保留两位小数", async () => {
            respondWith({
                body: balanceBody([cny({total_balance: "12.3x", granted_balance: "5", topped_up_balance: "7.3"})]),
            });
            mountPanel();
            setAi([provider()]);
            mount();

            await vi.waitFor(() => expect(balanceNode()!.textContent).toBe(`${LABEL}¥12.30`));
        });

        it("整数金额补两位小数", async () => {
            respondWith({body: balanceBody([cny({total_balance: "0", granted_balance: "0", topped_up_balance: "0"})])});
            mountPanel();
            setAi([provider()]);
            mount();

            await vi.waitFor(() => expect(balanceNode()!.textContent).toBe(`${LABEL}¥0.00`));
        });

        it.each([
            ["没有 balance_infos 字段", {is_available: true}],
            ["balance_infos 是空数组", balanceBody([])],
            ["balance_infos 不是数组", {is_available: true, balance_infos: "x"}],
        ])("%s：说明「接口没有返回余额」，不伪装成 0 元", async (_label, body) => {
            respondWith({body});
            mountPanel();
            setAi([provider()]);
            mount();

            await vi.waitFor(() => expect(balanceNode()!.textContent).toBe(`${LABEL}—`));
            expect(balanceNode()!.title).toBe(t("feature.deepseekBalance.empty"));
        });

        it.each([
            ["空响应体", {text: "   "}],
            ["不是 JSON 的响应体", {text: "<html>bad gateway</html>"}],
        ])("%s按「没有余额」处理", async (_label, init) => {
            respondWith(init);
            mountPanel();
            setAi([provider()]);
            mount();

            await vi.waitFor(() => expect(balanceNode()!.textContent).toBe(`${LABEL}—`));
            expect(balanceNode()!.title).toBe(t("feature.deepseekBalance.empty"));
        });

        it("HTTP 报错时带上接口给的 message", async () => {
            const harness = mount();
            respondWith({ok: false, status: 401, body: {error: {message: "Invalid API key"}}});
            mountPanel();
            setAi([provider()]);
            mount();

            await vi.waitFor(() => expect(balanceNode()!.textContent).toBe(`${LABEL}—`));
            expect(balanceNode()!.title).toBe(t("feature.deepseekBalance.failed"));
            expect(logsOf(harness).some((line) => line.includes("Invalid API key"))).toBe(true);
        });

        it("HTTP 报错且响应体不是预期的 error 形状时回落状态码", async () => {
            const harness = mount();
            respondWith({ok: false, status: 503, text: "Service Unavailable"});
            mountPanel();
            setAi([provider()]);
            mount();

            await vi.waitFor(() => expect(logsOf(harness).some((line) => line.includes("HTTP 503"))).toBe(true));
            expect(balanceNode()!.textContent).toBe(`${LABEL}—`);
        });

        it("网络异常只降级这一行，不抛错也不弹提示", async () => {
            // 这个功能每 30 秒跑一次，一旦开始报错就会刷屏，所以失败只进日志
            const harness = mount();
            vi.stubGlobal(
                "fetch",
                vi.fn(async () => {
                    throw new Error("network down");
                }),
            );
            mountPanel();
            setAi([provider()]);
            mount();

            await vi.waitFor(() => expect(balanceNode()!.textContent).toBe(`${LABEL}—`));
            expect(logsOf(harness).some((line) => line.includes("network down"))).toBe(true);
            expect(harness.records.messages).toEqual([]);
        });

        it("切到非官网模型后整行收起，title / aria-label 换成「没有可用 provider」的说明", async () => {
            respondWith({body: balanceBody([cny()])});
            mountPanel();
            setAi([provider()]);
            mount();
            await vi.waitFor(() => expect(balanceNode()!.textContent).toBe(`${LABEL}¥12.50`));

            // 换成非官网 provider：等价的用户动作是「只给这个会话换模型」
            setAi([provider({baseURL: "https://api.openai.com"})], "gpt-4o");
            window.dispatchEvent(new Event("siyuan-ai-config-changed"));

            await vi.waitFor(() => expect(balanceNode()!.classList.contains("fn__none")).toBe(true));
            expect(balanceNode()!.textContent).toBe(`${LABEL}—`);
            // 行是收起的，说明仍然留着：切回官网模型时不必等下一帧就知道为什么刚才没有数字
            expect(balanceNode()!.title).toBe(t("feature.deepseekBalance.noProvider"));
            expect(balanceNode()!.getAttribute("aria-label")).toBe(t("feature.deepseekBalance.noProvider"));
        });

        it("请求超时 15 秒后按失败处理，请求被 abort", async () => {
            vi.useFakeTimers();
            let seenSignal: AbortSignal | undefined;
            vi.stubGlobal(
                "fetch",
                vi.fn((_url: string, init: RequestInit) => {
                    seenSignal = init.signal as AbortSignal;
                    return new Promise((_resolve, reject) => {
                        seenSignal!.addEventListener("abort", () => reject(new Error("aborted")));
                    });
                }),
            );
            mountPanel();
            setAi([provider()]);
            mount();

            await vi.advanceTimersByTimeAsync(0);
            expect(balanceNode()!.textContent).toBe(`${LABEL}…`);

            await vi.advanceTimersByTimeAsync(15000);

            expect(seenSignal!.aborted).toBe(true);
            expect(balanceNode()!.textContent).toBe(`${LABEL}—`);
            expect(balanceNode()!.title).toBe(t("feature.deepseekBalance.failed"));
        });
    });

    describe("轮询与重入", () => {
        it("周期取配置并夹在 1～3600 秒之间，日志带出实际秒数", () => {
            vi.useFakeTimers();
            expect(logsOf(mount({interval: 5}))).toContain("Mounted; polling every 5s");
            expect(logsOf(mount({interval: 0}))).toContain("Mounted; polling every 1s");
            expect(logsOf(mount({interval: 999999}))).toContain("Mounted; polling every 3600s");
            // 配置被手改坏时回落默认值（面板层已经限过区间，这里是第二道闸）
            expect(logsOf(mount({interval: "abc"}))).toContain("Mounted; polling every 30s");
        });

        it("到点再查一次", async () => {
            vi.useFakeTimers();
            const fetchMock = respondWith({body: balanceBody([cny()])});
            mountPanel();
            setAi([provider()]);
            mount({interval: 5});
            await vi.advanceTimersByTimeAsync(0);
            expect(fetchMock).toHaveBeenCalledTimes(1);

            await vi.advanceTimersByTimeAsync(5000);
            expect(fetchMock).toHaveBeenCalledTimes(2);
        });

        it("页面不可见时不发无意义的后台请求", async () => {
            vi.useFakeTimers();
            Object.defineProperty(document, "hidden", {configurable: true, get: () => true});
            const fetchMock = respondWith({body: balanceBody([cny()])});
            mountPanel();
            setAi([provider()]);
            mount({interval: 5});
            await vi.advanceTimersByTimeAsync(0);
            expect(fetchMock).toHaveBeenCalledTimes(1);

            await vi.advanceTimersByTimeAsync(20000);
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it("上一拍还没回来时不会并发再发一次", async () => {
            const fetchMock = vi.fn(() => new Promise(() => undefined));
            vi.stubGlobal("fetch", fetchMock);
            mountPanel();
            setAi([provider()]);
            mount({interval: 5});

            // 多个入口（focus / 配置保存 / 定时器）同时触发，inFlight 必须挡住重复请求
            window.dispatchEvent(new Event("focus"));
            window.dispatchEvent(new Event("focus"));
            window.dispatchEvent(new Event("siyuan-ai-config-changed"));
            await Promise.resolve();

            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it("配置保存后重置周期并立刻查一次", async () => {
            vi.useFakeTimers();
            const fetchMock = respondWith({body: balanceBody([cny()])});
            mountPanel();
            setAi([provider()]);
            const harness = mount({interval: 30});
            await vi.advanceTimersByTimeAsync(0);
            expect(fetchMock).toHaveBeenCalledTimes(1);

            harness.config.interval = 2;
            harness.notifyConfigChange();
            await vi.advanceTimersByTimeAsync(0);
            expect(fetchMock).toHaveBeenCalledTimes(2);

            // 旧周期（30 秒）已经作废，新周期 2 秒到点就查
            await vi.advanceTimersByTimeAsync(2000);
            expect(fetchMock).toHaveBeenCalledTimes(3);
        });

        it("内核推送 setConf（其它设置保存）时补查一次", async () => {
            const fetchMock = respondWith({body: balanceBody([cny()])});
            mountPanel();
            setAi([provider()]);
            const harness = mount();
            // 等第一拍「查完并渲染」而不是「刚发出请求」：inFlight 要等响应落地才归零，
            // 否则补查会被重入挡住，看起来像没触发
            await vi.waitFor(() => expect(balanceNode()!.textContent).toBe(`${LABEL}¥12.50`));

            harness.emitBus("ws-main", {cmd: "setConf"});
            await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
            // 其它 cmd 不触发
            harness.emitBus("ws-main", {cmd: "transactions"});
            await Promise.resolve();
            expect(fetchMock).toHaveBeenCalledTimes(2);
        });

        it("窗口重新获得焦点时补查一次", async () => {
            const fetchMock = respondWith({body: balanceBody([cny()])});
            mountPanel();
            setAi([provider()]);
            mount();
            // 同理：要等第一拍渲染完，inFlight 才是空的
            await vi.waitFor(() => expect(balanceNode()!.textContent).toBe(`${LABEL}¥12.50`));

            window.dispatchEvent(new Event("focus"));
            await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        });

        it("面板从隐藏变为可见、手里又没有余额时立刻补查", async () => {
            // 「打开面板却什么都不显示」最容易让人以为功能坏了，下一个周期可能还在几十秒后
            vi.useFakeTimers();
            const fetchMock = vi.fn(async () => {
                throw new Error("offline");
            });
            vi.stubGlobal("fetch", fetchMock);
            const panel = mountPanel();
            setAi([provider()]);
            mount({interval: 5});
            await vi.advanceTimersByTimeAsync(0);
            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(balanceNode()!.textContent).toBe(`${LABEL}—`);

            // 隐藏页面让定时器那一拍只做 apply、不查余额，这样补查只可能来自「刚变为可见」
            Object.defineProperty(document, "hidden", {configurable: true, get: () => true});
            panel.getClientRects = () => [{width: 320, height: 600}] as unknown as DOMRectList;
            await vi.advanceTimersByTimeAsync(5000);

            expect(fetchMock).toHaveBeenCalledTimes(2);
        });

        it("已经有余额时展开面板不重复查", async () => {
            vi.useFakeTimers();
            const fetchMock = respondWith({body: balanceBody([cny()])});
            const panel = mountPanel();
            setAi([provider()]);
            mount({interval: 5});
            await vi.advanceTimersByTimeAsync(0);

            Object.defineProperty(document, "hidden", {configurable: true, get: () => true});
            panel.getClientRects = () => [{width: 320, height: 600}] as unknown as DOMRectList;
            await vi.advanceTimersByTimeAsync(5000);

            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it("日志按主题去重：同一条不重复刷屏", async () => {
            const harness = mount();
            window.dispatchEvent(new Event("focus"));
            window.dispatchEvent(new Event("focus"));
            window.dispatchEvent(new Event("focus"));

            const panelLogs = logsOf(harness).filter((line) => line.includes("not in the DOM"));
            expect(panelLogs).toHaveLength(1);
        });
    });

    describe("卸载", () => {
        it("destroy 收回节点、停掉轮询与全部监听", async () => {
            vi.useFakeTimers();
            const fetchMock = respondWith({body: balanceBody([cny()])});
            mountPanel();
            setAi([provider()]);
            const harness = mount({interval: 5});
            await vi.advanceTimersByTimeAsync(0);
            expect(balanceNode()).not.toBeNull();

            harness.instance!.destroy!();

            expect(balanceNode()).toBeNull();
            // 定时器已清：再走一个周期不会发请求
            await vi.advanceTimersByTimeAsync(60000);
            expect(fetchMock).toHaveBeenCalledTimes(1);
            // 监听已拆：这些入口都不该再影响任何东西
            window.dispatchEvent(new Event("focus"));
            window.dispatchEvent(new Event("siyuan-ai-config-changed"));
            harness.emitBus("ws-main", {cmd: "setConf"});
            await Promise.resolve();
            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(balanceNode()).toBeNull();
        });

        it("destroy 幂等", () => {
            mountPanel();
            const harness = mount();
            const instance = harness.instance!;
            instance.destroy!();
            expect(() => instance.destroy!()).not.toThrow();
        });

        it("destroy 会中止进行中的请求", async () => {
            let seenSignal: AbortSignal | undefined;
            vi.stubGlobal(
                "fetch",
                vi.fn((_url: string, init: RequestInit) => {
                    seenSignal = init.signal as AbortSignal;
                    return new Promise(() => undefined);
                }),
            );
            mountPanel();
            setAi([provider()]);
            const harness = mount();
            await vi.waitFor(() => expect(seenSignal).toBeDefined());
            expect(seenSignal!.aborted).toBe(false);

            harness.instance!.destroy!();

            expect(seenSignal!.aborted).toBe(true);
        });

        it("插件卸载后样式表也一起撤走", async () => {
            const harness = mount();
            expect(harness.styleElement()).not.toBeNull();

            harness.dispose();

            expect(harness.styleElement()).toBeNull();
            expect(document.head.querySelectorAll("style[data-some-settings-style]")).toHaveLength(0);
        });
    });

    describe("声明", () => {
        it("默认关闭，周期默认 30 秒并限定在 1～3600 之间", () => {
            expect(definition.enabled).toBe(true);
            expect(definition.category).toBe("ai");
            expect(definition.settings[0]).toMatchObject({kind: "switch", key: "enabled", default: false});
            expect(definition.settings[1]).toMatchObject({
                kind: "number",
                key: "interval",
                default: 30,
                min: 1,
                max: 3600,
                step: 1,
            });
            expect(mountDeepseekBalance).toBe(definition.mount);
        });
    });
});
