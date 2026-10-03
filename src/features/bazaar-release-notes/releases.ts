/**
 * 集市插件的发行版数据源（网络与解析）。
 *
 * 发行版列表与发行说明都取自 GitHub 的 `GET /repos/{owner}/{repo}/releases`：那条响应里
 * 每条发行版都带着自己的 `body`，也就是发行说明的 Markdown 原文，所以**一次请求就够**
 * —— 弹窗里切换历史版本不再联网。
 *
 * 国内直连 `api.github.com` 常常不通，地址按「镜像优先、GitHub 原始地址兜底」排成一条链逐个试，
 * 取第一个返回合法 JSON 的。镜像都是社区公益服务，随时可能挂掉或限流，所以不能只认一个。
 * 请求一律交给内核的 `/api/network/forwardProxy` 发出：渲染进程直连在浏览器端与移动端 WebView
 * 里会被跨域拦掉，交给内核则两端走同一条路，也顺带复用内核自己的网络设置。
 */
import {fetchSyncPost} from "siyuan";

/** 转发接口：请求由内核发出，绕开浏览器的同源策略。 */
const FORWARD_PROXY_API = "/api/network/forwardProxy";
/** 单个地址的超时（毫秒）：镜像站偶尔要十几秒才吐出第一个字节。 */
const FORWARD_TIMEOUT_MS = 15000;
/** 一次取多少条发行版（GitHub 的上限）：任何思源插件的全部历史版本都够装。 */
const RELEASES_PER_PAGE = 100;

/**
 * 发行版接口的地址前缀，按国内可达性排序，最后一个是 GitHub 原始地址。
 *
 * 前缀式加速站把「`https://` 之后的完整地址」直接拼在自己的域名后面，所以这些地址打到的
 * 依旧是 GitHub 官方接口，换的只是出网的那一跳。
 */
const RELEASE_API_PREFIXES = [
    "https://gh-proxy.com/https://api.github.com",
    "https://ghproxy.vip/https://api.github.com",
    "https://cdn.gh-proxy.com/https://api.github.com",
    "https://api.github.com",
];

/** 一个 GitHub 仓库。 */
export interface RepoRef {
    owner: string;
    repo: string;
}

/** 一条发行版：弹窗只用到这两项。 */
export interface Release {
    /** 发行版的 tag，例如 `v1.0.3`。 */
    tag: string;
    /** 发行说明的 Markdown 原文；作者没写就是空串。 */
    notes: string;
}

/**
 * 取发行版的结果：成功给 `releases`，失败给 `reason`（用来告诉用户卡在哪一步）。
 *
 * 刻意不用「有数据 / 没数据」的判别式联合：本工程的 tsconfig 关掉了 `strictNullChecks`，
 * 布尔字面量在那里会被放宽成 `boolean`，判别式联合就再也收窄不了。
 */
export interface ReleaseResult {
    releases?: Release[];
    /** 失败原因：`HTTP 403` / 超时 / 内核自己报的错。 */
    reason?: string;
}

/** 从集市的 `repoURL` 里取出 GitHub 的 owner / repo；不是 GitHub 仓库时返回 undefined。 */
export const parseRepo = (repoURL: string): RepoRef | undefined => {
    const matched = /^https?:\/\/(?:www\.)?github\.com\/([^/?#]+)\/([^/?#]+)/i.exec(repoURL.trim());
    if (!matched) {
        return undefined;
    }
    return {owner: matched[1], repo: matched[2].replace(/\.git$/i, "")};
};

/**
 * 一条发行版记录里我们真正要的两项；草稿（`draft`）不算发行版。
 *
 * `published_at` 是 ISO 8601，字典序就是时间序，直接拿它排序；缺失的当空串排到最后。
 */
const toRelease = (item: unknown): {tag: string; notes: string; publishedAt: string;} | undefined => {
    if (!item || typeof item !== "object") {
        return undefined;
    }
    const raw = item as {tag_name?: unknown; body?: unknown; draft?: unknown; published_at?: unknown;};
    if (raw.draft === true || typeof raw.tag_name !== "string" || raw.tag_name === "") {
        return undefined;
    }
    return {
        tag: raw.tag_name,
        notes: typeof raw.body === "string" ? raw.body : "",
        publishedAt: typeof raw.published_at === "string" ? raw.published_at : "",
    };
};

/** 解析发行版列表；不是数组（镜像站返回了 HTML 错误页之类）时返回 undefined。 */
const parseReleases = (body: string): Release[] | undefined => {
    let data: unknown;
    try {
        data = JSON.parse(body);
    } catch {
        return undefined;
    }
    if (!Array.isArray(data)) {
        return undefined;
    }
    const releases = data.map((item) => toRelease(item)).filter((item) => Boolean(item));
    // 最新的排在最前面：弹窗里第一个就是「最新」的那个
    releases.sort((left, right) =>
        left.publishedAt < right.publishedAt ? 1 : left.publishedAt > right.publishedAt ? -1 : 0
    );
    return releases.map((item) => ({tag: item.tag, notes: item.notes}));
};

/** 交给内核转发一次 GET；拿到响应文本与失败原因，任何一步失败都不抛。 */
const forwardGet = async (url: string, signal: AbortSignal): Promise<{body?: string; reason?: string;}> => {
    try {
        const response = await fetchSyncPost(
            FORWARD_PROXY_API,
            {
                url,
                method: "GET",
                timeout: FORWARD_TIMEOUT_MS,
                contentType: "application/json",
                // GitHub 的接口按这个 Accept 返回 JSON；镜像站转发时也会带上
                headers: [{accept: "application/vnd.github+json"}],
            },
            undefined,
            false,
            signal,
        );
        if (response.code !== 0) {
            // 内核自己报的错：地址非法、发不出去、响应体过大…请求都算没送出去
            return {reason: response.msg || `code ${response.code}`};
        }
        const {status, body} = response.data;
        if (status < 200 || status >= 300) {
            return {reason: `HTTP ${status}`};
        }
        return {body};
    } catch (error) {
        // 前端根本没问到内核（内核重启、连远程内核时掉线），或者这次请求被取消
        return {reason: error instanceof Error ? error.message : String(error)};
    }
};

/**
 * 取一个仓库的全部发行版：按顺序试各个镜像，第一个给出合法 JSON 的就用它。
 * 每个地址都失败时返回最后一个失败原因。
 */
export const fetchReleases = async (repo: RepoRef, signal: AbortSignal): Promise<ReleaseResult> => {
    const path = `/repos/${encodeURIComponent(repo.owner)}/${
        encodeURIComponent(repo.repo)
    }/releases?per_page=${RELEASES_PER_PAGE}`;
    let reason = "";
    for (const prefix of RELEASE_API_PREFIXES) {
        if (signal.aborted) {
            // 功能已经卸载，后面的地址不用再试了
            break;
        }
        const response = await forwardGet(`${prefix}${path}`, signal);
        if (typeof response.body === "string") {
            const releases = parseReleases(response.body);
            if (releases) {
                return {releases};
            }
            reason = "unexpected response body";
            continue;
        }
        reason = response.reason ?? "";
    }
    return {reason};
};
