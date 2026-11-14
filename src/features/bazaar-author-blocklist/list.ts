/**
 * 在线集市列表的数据侧：接口地址、可见性过滤、以及被动读一份内核响应。
 *
 * 为什么需要这一层：列表是**虚拟化**的（宿主只渲染前 24 张卡片，其余是空占位卡），
 * 所以「当前列表里一共有多少个包、其中多少个属于被屏蔽的作者」在 DOM 里数不出来。
 * 而计数要跟着屏蔽名单走（用户明确要求连数量一起改），只能从宿主实际拿到的那份数据里算。
 *
 * 数据来源是一层 `window.fetch` 观察者：命中五个在线列表接口时复制响应交给回调，
 * 原始响应原样还给宿主。复制必须发生在宿主碰响应体之前 —— 我们的 `.then` 在拿到响应的
 * 同一轮里就注册了、比宿主的 `await` 先执行，插件里其它响应观察也是同一套做法。
 *
 * 可见性过滤照抄内核 `_renderBazaarCards` 的两步（兼容性筛选 + 主题明暗筛选）：
 * 宿主的计数器显示的是过滤后的条数，只有按同一套规则过滤才能对得上。
 * 内核以后改了规则也不会静默算错：调用方会拿算出来的条数与宿主计数器核对，对不上就不动它。
 */
export type BazaarType = "plugins" | "themes" | "icons" | "templates" | "widgets";

/** 五种在线列表，顺序与集市页签一致。 */
export const BAZAAR_TYPES: BazaarType[] = ["plugins", "themes", "icons", "templates", "widgets"];

/** 每种在线列表的接口地址。 */
export const LIST_ENDPOINT_BY_TYPE: Record<BazaarType, string> = {
    plugins: "/api/bazaar/getBazaarPlugin",
    themes: "/api/bazaar/getBazaarTheme",
    icons: "/api/bazaar/getBazaarIcon",
    templates: "/api/bazaar/getBazaarTemplate",
    widgets: "/api/bazaar/getBazaarWidget",
};

/** 每种在线列表的内容容器 id（由宿主在集市页签里渲染）。 */
export const PANEL_ID_BY_TYPE: Record<BazaarType, string> = {
    plugins: "configBazaarPlugin",
    themes: "configBazaarTheme",
    icons: "configBazaarIcon",
    templates: "configBazaarTemplate",
    widgets: "configBazaarWidget",
};

/** 过滤只关心这几个字段，其余字段原样带过。 */
export interface BazaarPackage {
    author?: string;
    modes?: string[];
    bazaarVersionUnsupported?: boolean;
    bazaarIncompatible?: boolean;
}

/** 宿主的两个兼容性筛选开关（设置里可勾选）。 */
export interface CompatibilityFilters {
    hideUnsupportedVersion?: boolean;
    hideIncompatiblePlatform?: boolean;
}

const TYPE_BY_ENDPOINT = new Map<string, BazaarType>(
    BAZAAR_TYPES.map((type) => [LIST_ENDPOINT_BY_TYPE[type], type]),
);

/** 接口地址 → 集市类型；不是在线列表接口时返回 undefined。 */
export const bazaarTypeOfUrl = (url: string): BazaarType | undefined => {
    let path: string;
    try {
        path = new URL(url, window.location.href).pathname;
    } catch {
        path = url.split(/[?#]/)[0];
    }
    return TYPE_BY_ENDPOINT.get(path);
};

/** 内核应答 → 包数组；形状不对（失败、字段缺失）时返回 undefined，不把坏数据当空列表。 */
export const packagesOfResponse = (value: unknown): BazaarPackage[] | undefined => {
    if (typeof value !== "object" || value === null) {
        return undefined;
    }
    const response = value as {code?: unknown; data?: unknown;};
    if (response.code !== 0 || typeof response.data !== "object" || response.data === null) {
        return undefined;
    }
    const packages = (response.data as {packages?: unknown;}).packages;
    return Array.isArray(packages) ? packages as BazaarPackage[] : undefined;
};

/**
 * 宿主实际会渲染出来的那批包：先按兼容性筛选，再按主题明暗筛选。
 *
 * 与内核 `filterBazaarPackagesByCompatibility` / `filterBazaarPackagesByThemeMode` 同一套规则，
 * 顺序也一致（先兼容性、后明暗）。主题明暗只对 `themes` 生效，`themeMode` 取页签上那个下拉的
 * 值："0" 浅色、"1" 深色、"2" / 缺省为全部。
 */
export const visiblePackagesOf = <T extends BazaarPackage>(
    packages: readonly T[],
    type: BazaarType,
    themeMode: string | undefined,
    filters: CompatibilityFilters | undefined,
): T[] => {
    const compatible = packages.filter((item) => {
        if (filters?.hideUnsupportedVersion === true && item.bazaarVersionUnsupported === true) {
            return false;
        }
        if (filters?.hideIncompatiblePlatform === true && item.bazaarIncompatible === true) {
            return false;
        }
        return true;
    });
    if (type !== "themes" || (themeMode !== "0" && themeMode !== "1")) {
        return compatible;
    }
    const mode = themeMode === "0" ? "light" : "dark";
    return compatible.filter((item) => !item.modes?.length || item.modes.includes(mode));
};

const urlOf = (input: RequestInfo | URL): string => {
    if (typeof input === "string") {
        return input;
    }
    return input instanceof URL ? input.href : input.url;
};

/**
 * 观察在线列表响应，命中时把包数组交给 `onPackages`。
 *
 * 读副本失败（请求被取消、响应不是 JSON）时宿主毫不知情：这一路完全脱离宿主的成败，
 * 只记一条 WARN，计数退回「不修正」。返回的函数只还原自己装上的那一个 `fetch`，
 * 期间可能已经有别的代码换过它（与插件里其它 fetch 观察者同一套约定）。
 */
export const createBazaarListTap = (
    onPackages: (type: BazaarType, packages: readonly BazaarPackage[]) => void,
    onError: (message: string, error: unknown) => void,
): () => void => {
    const original = window.fetch;
    if (typeof original !== "function") {
        return () => undefined;
    }
    const read = async (response: Response, type: BazaarType): Promise<void> => {
        const payload: unknown = await response.json();
        const packages = packagesOfResponse(payload);
        if (packages) {
            onPackages(type, packages);
        }
    };
    const patched = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const response = original.call(window, input, init);
        const type = bazaarTypeOfUrl(urlOf(input));
        if (type) {
            void response.then((value) => read(value.clone(), type)).catch((error: unknown) => {
                onError("could not read a marketplace list response", error);
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
