/**
 * 普通「新建文档」的固定父级。
 *
 * 思源把「新建文档」的入口撒在菜单、页签栏的 `+`、空白页、搜索结果、
 * 快捷键和命令面板里，但它们最后都只走一条链路：`newFile()` 先
 * `POST /api/filetree/planDocCreate`（purpose=document、按配置位置）拿计划，
 * 再逐条 `createDocByParent` 落盘。逐个去拦 DOM 与按键永远会漏：命令面板直接
 * 调用函数，既没有点击也没有键盘事件；将来新增的入口同样不会有。
 *
 * 所以这里只守这条链路唯一的汇聚点：临时接管 `window.fetch`，把这一次计划请求的
 * notebook / contextID 换成本功能配置的固定父级。建文档、标题模板、排序、页签打开、
 * 失败提示、移动端与桌面端差异全部仍由思源自己完成，我们只改「建在哪」。
 *
 * 只认普通新建文档：`placement === "child"` 的「新建子文档 / 同级文档」、
 * `purpose` 为 `reference` 的引用类创建与 `dailyNote` 的日记都不在范围内。
 * 唯一的例外是编辑器提示面板里的「新建文档（插入块引用）」：它和普通新建的请求体一模一样，
 * 只能靠发起点认出来，那一条保持宿主行为（建在当前文档下、随后插入块引用）。
 * 目标不可用时**不回落**到思源默认位置，直接把这次计划请求判失败，由宿主照常提示。
 */
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

/** 普通新建文档的计划接口：所有原生入口都汇到这一次请求。 */
const PLAN_PATH = "/api/filetree/planDocCreate";
const ID_PATTERN = /^\d{14}-[a-z0-9]{7}$/;

/** 编辑器提示面板里「新建文档（并插入块引用）」那一条的内建值：宿主的 `Constants.ZWSP + 4`。 */
const REF_DOC_VALUE = "\u200b4";
const HINT_POPUP = ".protyle-hint";

interface NotebookLike {
    id: string;
    closed?: boolean;
}

interface ApiResponse<T = unknown> {
    code?: number;
    msg?: string;
    data?: T;
}

interface BlockInfo {
    id?: string;
    rootID?: string;
    type?: string;
    box?: string;
}

interface Target {
    notebook: string;
    parentID: string | null;
}

const urlOf = (input: RequestInfo | URL): string => {
    if (typeof input === "string") {
        return input;
    }
    if (input instanceof URL) {
        return input.href;
    }
    return input.url;
};

/** 请求的路径部分：相对地址、绝对地址、带查询参数（宿主的 app 标识）都要认出来。 */
const pathOf = (input: RequestInfo | URL): string => {
    const raw = urlOf(input);
    try {
        return new URL(raw, location.href).pathname;
    } catch {
        return raw.split(/[?#]/)[0];
    }
};

/**
 * 认出「普通新建文档」的计划请求，返回它的请求体与 init。
 *
 * 返回 `undefined` 表示这一次请求跟我们无关，原样交给宿主；只有识别成功时
 * 调用方才可能改写它。请求体必须是 JSON 字符串 —— 宿主的这类接口都这么发。
 */
const planRequest = (
    input: RequestInfo | URL,
    init?: RequestInit,
): {payload: Record<string, unknown>; init: RequestInit;} | undefined => {
    if (!pathOf(input).endsWith(PLAN_PATH) || (init?.method ?? "").toUpperCase() !== "POST") {
        return undefined;
    }
    if (typeof init?.body !== "string") {
        return undefined;
    }
    let body: unknown;
    try {
        body = JSON.parse(init.body);
    } catch {
        return undefined;
    }
    if (!body || typeof body !== "object") {
        return undefined;
    }
    const payload = body as Record<string, unknown>;
    // placement 缺省时宿主按 configured 处理，与「新建子文档」的 child 明确区分。
    return payload.purpose === "document" && payload.placement !== "child" ? {payload, init} : undefined;
};

/**
 * 这一次交互是不是从编辑器提示面板里选中了「新建文档（插入块引用）」。
 *
 * 那一条走的是和普通新建文档**完全一样**的计划请求（purpose=document、配置位置），
 * 请求体里没有任何可以区分的字段，唯一的不同是发起点：斜杠菜单 / 块引提示里的候选。
 * 宿主的语义是「在当前文档下建一篇并把它引用到光标处」，本功能不该改它的位置，
 * 所以在候选被点中（或键盘选中）的那一次交互里放行随后的计划请求。
 * 认不出来时只会退回「按固定位置创建」，不会误伤别处。
 */
const isRefDocItem = (element: Element | null): boolean => {
    const popup = element?.closest(HINT_POPUP);
    if (!popup || popup.classList.contains("fn__none")) {
        return false;
    }
    const item = element?.closest("[data-value]");
    const raw = item && popup.contains(item) ? item.getAttribute("data-value") : null;
    if (!raw) {
        return false;
    }
    try {
        return decodeURIComponent(raw) === REF_DOC_VALUE;
    } catch {
        return false;
    }
};

const notebooks = (): NotebookLike[] => {
    const holder = window as unknown as {siyuan?: {notebooks?: NotebookLike[];};};
    const value = holder.siyuan?.notebooks;
    return Array.isArray(value) ? value : [];
};

const openNotebook = (id: string): NotebookLike | undefined =>
    notebooks().find(notebook => notebook.id === id && !notebook.closed);

/** 用未经改写的 fetch 发一次内核请求，避免自己的查询也被自己拦下。 */
const post = async <T>(send: typeof fetch, url: string, data: unknown): Promise<ApiResponse<T>> => {
    const response = await send.call(window, url, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(data),
    });
    return await response.json() as ApiResponse<T>;
};

/** ID 先按笔记本精确匹配，再按文档根块解析；普通正文块不能当父文档。 */
const resolveTarget = async (rawId: string, host: FeatureHost, send: typeof fetch): Promise<Target | undefined> => {
    const id = rawId.trim();
    if (!id) {
        return undefined;
    }
    if (!ID_PATTERN.test(id)) {
        throw new Error(host.i18n("feature.newDocFixedTarget.invalid"));
    }
    if (openNotebook(id)) {
        return {notebook: id, parentID: null};
    }
    const response = await post<BlockInfo>(send, "/api/block/getBlock", {id});
    const block = response.data;
    if (response.code !== 0 || !block) {
        throw new Error(response.msg || host.i18n("feature.newDocFixedTarget.invalid"));
    }
    if (block.type !== "d" || block.id !== id || block.rootID !== id || !block.box || !openNotebook(block.box)) {
        throw new Error(host.i18n("feature.newDocFixedTarget.invalid"));
    }
    return {notebook: block.box, parentID: id};
};

/** 目标不可用时的响应：形状与内核的失败响应一致，宿主会照原样提示。 */
const failure = (message: string): Response =>
    new Response(JSON.stringify({code: -1, msg: message, data: null}), {
        status: 200,
        headers: {"Content-Type": "application/json"},
    });

/** 把这一次计划请求的目标换成固定父级；返回宿主自己的响应。 */
const retarget = async (
    host: FeatureHost,
    send: typeof fetch,
    input: RequestInfo | URL,
    init: RequestInit,
    payload: Record<string, unknown>,
): Promise<Response> => {
    let target: Target | undefined;
    try {
        target = await resolveTarget(String(host.config.target ?? ""), host, send);
    } catch (error) {
        host.log.warn("failed to resolve the configured target", error);
        return failure(
            error instanceof Error && error.message ? error.message : host.i18n("feature.newDocFixedTarget.failed"),
        );
    }
    if (!target || host.signal.aborted) {
        return await send.call(window, input, init);
    }
    return await send.call(window, input, {
        ...init,
        body: JSON.stringify({
            ...payload,
            notebook: target.notebook,
            contextID: target.parentID,
            placement: "child",
        }),
    });
};

export const mountNewDocFixedTarget = (host: FeatureHost): FeatureInstance => {
    const original = window.fetch;
    /** 当前这次交互来自「新建文档（插入块引用）」，随后的计划请求要交还宿主。 */
    let bypass = false;

    /** 放行只对同一次交互有效：宿主在点击 / 按键的同一个任务里就发出了计划请求。 */
    const allowHost = (): void => {
        bypass = true;
        window.setTimeout(() => {
            bypass = false;
        }, 0);
    };

    const onClick = (event: MouseEvent): void => {
        if (event.button !== 0 || !(event.target instanceof Element)) {
            return;
        }
        if (isRefDocItem(event.target)) {
            allowHost();
        }
    };

    const onKeydown = (event: KeyboardEvent): void => {
        if (event.isComposing || (event.key !== "Enter" && event.key !== "Tab")) {
            return;
        }
        if (isRefDocItem(document.querySelector(`${HINT_POPUP} .b3-list-item--focus`))) {
            allowHost();
        }
    };

    const patched = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const request = planRequest(input, init);
        if (!request) {
            return original.call(window, input, init);
        }
        // 放行标记只被下一次计划请求消费，别的请求不会把它吃掉
        const allowed = bypass;
        bypass = false;
        if (allowed || host.signal.aborted || !String(host.config.target ?? "").trim()) {
            return original.call(window, input, init);
        }
        return retarget(host, original, input, request.init, request.payload);
    };
    window.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onKeydown, true);
    window.fetch = patched;

    return {
        destroy: () => {
            window.removeEventListener("click", onClick, true);
            window.removeEventListener("keydown", onKeydown, true);
            // 只还原自己装上的那一个：期间可能已有别的代码换了 fetch
            if (window.fetch === patched) {
                window.fetch = original;
            }
        },
    };
};
