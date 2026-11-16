/**
 * 免费翻译服务的请求与响应：微软翻译（Edge 浏览器接口）与谷歌翻译（translate_a）。
 *
 * 两个接口都**不需要密钥**，请求体与响应形状照抄 DSH 官方「思考过程翻译」插件
 * （`@deepseek-ai/dsh-experimental-client-ui-cot-translation` 与 `dsh-experimental-translator`）：
 * - 微软：`POST edge.microsoft.com/translate/translatetext?to=…&isEnterpriseClient=false`，
 *   请求体是 `["文本"]`，响应是 `[{translations:[{text}]}]`；
 * - 谷歌：`POST translate.googleapis.com/translate_a/single?client=dict-chrome-ex&sl=auto&tl=…&dt=t`，
 *   请求体是 `q=文本`，响应是 `[[[译文, 原文, …], …], …]`，各段按顺序拼接。
 *   客户端标识用 Chrome 内置翻译的 `dict-chrome-ex` 而不是常见的 `gtx`：`gtx` 被大量脚本滥用，
 *   接口会直接回 429「Sorry」页（正文是 HTML，解析必然失败），换成前者在同一个出口 IP 上仍然 200。
 *
 * 谷歌的域名在国内网络连不上，用户要自己走代理：要么在思源里配好网络代理（内核 `forwardProxy`
 * 走 `HTTP(S)_PROXY`），要么用 TUN 模式 / VPN 让整台机器的流量都走代理；微软的接口可以直连。
 *
 * 走内核的 `/api/network/forwardProxy` 而不是页面里的 `fetch`：这两个域名都没有给
 * 桌面端渲染进程开 CORS，直接在页面里请求会被浏览器拦掉；内核代理是思源给插件准备的
 * 官方出口，顺带也走内核自己的网络设置。
 *
 * 这里只做「文本进、译文出」这一件事，不读写任何会话数据。
 */
import {fetchSyncPost} from "siyuan";

/** 免费接口的选择；付费模型翻译不在这个功能的范围里。 */
export type TranslationProvider = "bing" | "google";

/** 面板上的目标语言取值。`auto` 跟随思源界面语言。 */
export type TargetPreference = "auto" | "zhCn" | "zhTw" | "en";

/** 一次翻译请求：去哪家、翻译什么、翻成什么语言。 */
export interface TranslationRequest {
    provider: TranslationProvider;
    text: string;
    target: string;
}

/** 拼好的 HTTP 请求，`payload` 已经是内核代理要的字符串。 */
interface RequestSpec {
    url: string;
    contentType: string;
    payload: string;
}

/** 内核 `forwardProxy` 响应里我们关心的字段。 */
interface ForwardProxyResponse {
    code?: number;
    msg?: string;
    data?: {
        status?: number;
        body?: string;
    } | null;
}

const GOOGLE_ENDPOINT = "https://translate.googleapis.com/translate_a/single";
/** Chrome 内置翻译的客户端标识；`gtx` 会被接口当滥用流量回 429。 */
const GOOGLE_CLIENT = "dict-chrome-ex";
const BING_ENDPOINT = "https://edge.microsoft.com/translate/translatetext";
/** 单次请求的期限；超过就按失败处理，界面给重试入口。 */
const REQUEST_TIMEOUT_MS = 15000;

/** 配置里的服务名只可能是这两个值；写坏了按默认的微软处理。 */
export const providerOf = (value: unknown): TranslationProvider => value === "google" ? "google" : "bing";

/** 配置里的目标语言只可能是这四个值；写坏了按「跟随界面语言」处理。 */
export const targetPreferenceOf = (value: unknown): TargetPreference =>
    value === "zhCn" || value === "zhTw" || value === "en" ? value : "auto";

/**
 * 思源的界面语言（`zh_CN`、`zh_TW`、`en_US` …）转成翻译接口认识的标签。
 *
 * 简体与繁体必须分开：只取语言前缀的话 `zh_TW` 会被翻成简体，等于把用户的语言选错了。
 * 认不出的语言退回语言前缀（`de_DE` → `de`），再认不出就退回英文。
 */
const uiLanguageTag = (language: string): string => {
    const normalized = language.trim().replace(/_/g, "-");
    if (!normalized) {
        return "en";
    }
    const [primary, region = ""] = normalized.split("-");
    if (primary.toLowerCase() === "zh") {
        return /^(tw|hk|mo)$/i.test(region) || /hant/i.test(region) ? "zh-TW" : "zh-CN";
    }
    return primary.toLowerCase();
};

const targetTag = (preference: TargetPreference, uiLanguage: string): string => {
    switch (preference) {
        case "zhCn":
            return "zh-CN";
        case "zhTw":
            return "zh-TW";
        case "en":
            return "en";
        default:
            return uiLanguageTag(uiLanguage);
    }
};

/**
 * 两家服务对中文标签的写法不同：谷歌认 `zh-CN` / `zh-TW`，微软认 `zh-Hans` / `zh-Hant`。
 * 其余语言两家一致，原样传。
 */
const providerTag = (tag: string, provider: TranslationProvider): string => {
    const lower = tag.toLowerCase();
    if (lower === "zh-cn" || lower === "zh-hans") {
        return provider === "google" ? "zh-CN" : "zh-Hans";
    }
    if (lower === "zh-tw" || lower === "zh-hant" || lower === "zh-hk") {
        return provider === "google" ? "zh-TW" : "zh-Hant";
    }
    return tag;
};

/** 把面板上的语言选项解析成这家服务真正要的语言标签。 */
export const resolveTargetLanguage = (
    preference: TargetPreference,
    uiLanguage: string,
    provider: TranslationProvider,
): string => providerTag(targetTag(preference, uiLanguage), provider);

/** 按服务拼出请求；源语言一律交给服务自动识别。 */
export const buildRequest = (request: TranslationRequest): RequestSpec => {
    if (request.provider === "google") {
        const url = new URL(GOOGLE_ENDPOINT);
        url.searchParams.set("client", GOOGLE_CLIENT);
        url.searchParams.set("sl", "auto");
        url.searchParams.set("tl", request.target);
        url.searchParams.set("dt", "t");
        return {
            url: url.href,
            contentType: "application/x-www-form-urlencoded",
            payload: new URLSearchParams({q: request.text}).toString(),
        };
    }
    const url = new URL(BING_ENDPOINT);
    url.searchParams.set("to", request.target);
    url.searchParams.set("isEnterpriseClient", "false");
    return {
        url: url.href,
        contentType: "application/json",
        payload: JSON.stringify([request.text]),
    };
};

/** 从服务响应里取出译文；形状不对一律当失败，绝不把半截 JSON 当译文显示。 */
export const parseTranslation = (provider: TranslationProvider, payload: unknown): string => {
    if (!Array.isArray(payload)) {
        throw new Error(`${provider} returned an invalid translation`);
    }
    const first: unknown = payload[0];
    if (provider === "google") {
        if (!Array.isArray(first) || first.length === 0) {
            throw new Error("google returned an invalid translation");
        }
        return first.map((segment: unknown) => {
            if (!Array.isArray(segment) || typeof segment[0] !== "string") {
                throw new Error("google returned an invalid translation segment");
            }
            return segment[0];
        }).join("");
    }
    if (typeof first !== "object" || first === null) {
        throw new Error("bing returned an invalid translation");
    }
    const translations = (first as {translations?: unknown;}).translations;
    if (!Array.isArray(translations) || translations.length === 0) {
        throw new Error("bing returned no translation");
    }
    const translated = translations[0] as {text?: unknown;};
    if (typeof translated?.text !== "string") {
        throw new Error("bing returned an invalid translation");
    }
    return translated.text;
};

/**
 * 发一次翻译请求。
 *
 * 失败一律抛错，由调用方决定是「保留原文 + 提示重试」；错误信息只带服务名与状态码，
 * 绝不带思考正文 —— 日志与界面提示都不该把用户的思考内容再复制一份。
 */
export const requestTranslation = async (request: TranslationRequest, signal: AbortSignal): Promise<string> => {
    const spec = buildRequest(request);
    let response: ForwardProxyResponse;
    try {
        response = await fetchSyncPost(
            "/api/network/forwardProxy",
            {
                url: spec.url,
                method: "POST",
                timeout: REQUEST_TIMEOUT_MS,
                contentType: spec.contentType,
                payload: spec.payload,
                redirect: false,
            },
            undefined,
            false,
            signal,
        ) as unknown as ForwardProxyResponse;
    } catch {
        // 取消是正常路径（折叠、切换设置、卸载），不要把 AbortError 变成「翻译失败」。
        signal.throwIfAborted();
        throw new Error(`${request.provider} translation request failed`);
    }
    signal.throwIfAborted();
    if (response?.code !== 0) {
        throw new Error(`${request.provider} translation proxy error (code ${String(response?.code)})`);
    }
    const status = response.data?.status ?? 0;
    if (status < 200 || status >= 300) {
        throw new Error(`${request.provider} translation failed (HTTP ${status})`);
    }
    let payload: unknown;
    try {
        payload = JSON.parse(response.data?.body ?? "");
    } catch {
        throw new Error(`${request.provider} translation returned invalid JSON`);
    }
    return parseTranslation(request.provider, payload);
};
