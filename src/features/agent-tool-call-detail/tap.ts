/**
 * 被动读取界面自己发出的请求。
 *
 * 挂一层 `window.fetch`：命中给定地址的响应**复制一份**交给回调，原始响应原样还给宿主。
 * 复制必须发生在宿主碰响应体之前，所以这里在拿到响应、还没交还给调用方的同一轮里就 `clone()`
 * —— 我们的 `.then` 比调用方的 `await` 先注册，因此先执行。
 *
 * 读副本失败（请求被取消、响应不是预期的类型）时宿主毫不知情：这一路完全脱离宿主的成败。
 * 返回的函数只还原自己装上的那一个 `fetch`，期间可能已经有别的代码换过它。
 */

const urlOf = (input: RequestInfo | URL): string => {
    if (typeof input === "string") {
        return input;
    }
    return input instanceof URL ? input.href : input.url;
};

/**
 * 每次命中都复制一份响应交给 `read`，返回撤销函数。
 *
 * `match` 按地址后缀判断，`read` 拿到的是**副本**，可以直接读它的 body。
 */
export const createResponseTap = (match: (url: string) => boolean, read: (response: Response) => void): () => void => {
    const original = window.fetch;
    const patched = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const response = original.call(window, input, init);
        if (match(urlOf(input))) {
            void response.then((value) => read(value.clone())).catch(() => {
                // 宿主自己会处理这次失败，这里不需要做任何事
            });
        }
        return response;
    };
    window.fetch = patched;
    return () => {
        if (window.fetch === patched) {
            window.fetch = original;
        }
    };
};
