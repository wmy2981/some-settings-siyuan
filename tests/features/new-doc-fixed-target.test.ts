import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import type {FeatureHost} from "../../src/core/types";
import {mountNewDocFixedTarget} from "../../src/features/new-doc-fixed-target/target";
import {noopLogger} from "../helpers/feature-host";

const TARGET = "20260101123000-abcdefg";
const CURRENT_DOC = "20260101090000-current";
const NOTEBOOK = "20260101123002-abcdefg";
const DOCUMENT_ID = "20260101123003-abcdefg";

const mounted: {destroy?: () => void;}[] = [];
let savedFetch: typeof fetch | undefined;

type KernelRequest = {url: string; path: string; body?: any;};

const urlOf = (input: RequestInfo | URL): string =>
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

const pathOf = (input: RequestInfo | URL): string => {
    const raw = urlOf(input);
    try {
        return new URL(raw, location.href).pathname;
    } catch {
        return raw.split(/[?#]/)[0];
    }
};

const json = (payload: unknown): Response =>
    new Response(JSON.stringify(payload), {status: 200, headers: {"Content-Type": "application/json"}});

/** 造一个只会被改写的那个请求才会碰到的内核。 */
const installKernel = (routes: Record<string, (body: any) => unknown>): KernelRequest[] => {
    const seen: KernelRequest[] = [];
    window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = urlOf(input);
        const path = pathOf(input);
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
        seen.push({url, path, body});
        const route = routes[path];
        if (!route) {
            throw new Error(`unexpected request: ${url}`);
        }
        return json(route(body));
    }) as unknown as typeof fetch;
    return seen;
};

const planOf = (body: any) => ({
    notebook: body.notebook,
    title: body.title ?? "",
    steps: [{notebook: body.notebook, parentID: body.contextID ?? null, id: "20260101123004-abcdefg"}],
});

const defaultRoutes = (overrides: Record<string, (body: any) => unknown> = {}) => ({
    "/api/block/getBlock": (body: any) => ({code: 0, data: {id: body.id, rootID: body.id, type: "d", box: NOTEBOOK}}),
    "/api/filetree/planDocCreate": (body: any) => ({code: 0, data: planOf(body)}),
    ...overrides,
});

const hostOf = (target = TARGET): FeatureHost => {
    const controller = new AbortController();
    return {
        config: {target},
        signal: controller.signal,
        i18n: (key: string) => key,
        log: noopLogger,
        showMessage: vi.fn(),
    } as unknown as FeatureHost;
};

const mountForTest = (host: FeatureHost) => {
    const instance = mountNewDocFixedTarget(host);
    mounted.push(instance);
    return instance;
};

const planRequest = (overrides: Record<string, unknown> = {}): RequestInit => ({
    method: "POST",
    body: JSON.stringify({
        notebook: NOTEBOOK,
        contextID: CURRENT_DOC,
        purpose: "document",
        placement: "configured",
        title: "笔记",
        id: DOCUMENT_ID,
        ...overrides,
    }),
});

describe("新建文档到固定位置", () => {
    beforeEach(() => {
        savedFetch = window.fetch;
        (window.siyuan as any).notebooks = [{id: NOTEBOOK, closed: false}];
    });

    afterEach(() => {
        mounted.splice(0).forEach(instance => instance.destroy?.());
        window.fetch = savedFetch as typeof fetch;
    });

    it("普通新建文档的计划请求改到指定父级，其余参数与响应原样保留", async () => {
        const plan = {code: 0, data: {notebook: NOTEBOOK, title: "笔记", steps: []}};
        const seen = installKernel(defaultRoutes({"/api/filetree/planDocCreate": () => plan}));
        mountForTest(hostOf());

        const response = await window.fetch("/api/filetree/planDocCreate", planRequest());

        expect(seen.map(request => request.path)).toEqual(["/api/block/getBlock", "/api/filetree/planDocCreate"]);
        expect(seen[0].body).toEqual({id: TARGET});
        expect(seen[1].body).toEqual({
            notebook: NOTEBOOK,
            contextID: TARGET,
            purpose: "document",
            placement: "child",
            title: "笔记",
            id: DOCUMENT_ID,
        });
        // 计划请求的响应原封不动交给宿主的 newFile 链路
        await expect(response.json()).resolves.toEqual(plan);
    });

    it("笔记本 ID 建在根目录，不带父文档", async () => {
        const seen = installKernel(defaultRoutes());
        mountForTest(hostOf(NOTEBOOK));

        await window.fetch("/api/filetree/planDocCreate", planRequest());

        expect(seen).toHaveLength(1);
        expect(seen[0].body).toMatchObject({notebook: NOTEBOOK, contextID: null, placement: "child"});
    });

    it("命令面板等入口用的相对地址与带查询参数的地址同样识别", async () => {
        const seen = installKernel(defaultRoutes());
        mountForTest(hostOf());

        await window.fetch(`${location.origin}/api/filetree/planDocCreate?app=window1`, planRequest());

        expect(seen[0].body).toEqual({id: TARGET});
        expect(seen[1].body).toMatchObject({contextID: TARGET, placement: "child"});
        expect(seen[1].url).toBe(`${location.origin}/api/filetree/planDocCreate?app=window1`);
    });

    it("不拦新建子文档、引用、日记与其它接口", async () => {
        const seen = installKernel(defaultRoutes());
        mountForTest(hostOf());

        const cases: [string, RequestInit][] = [
            ["/api/filetree/planDocCreate", planRequest({placement: "child"})],
            ["/api/filetree/planDocCreate", planRequest({purpose: "reference", placement: "configured"})],
            ["/api/filetree/planDocCreate", planRequest({purpose: "dailyNote", placement: undefined})],
            ["/api/block/getBlock", planRequest()],
        ];
        for (const [url, init] of cases) {
            const response = await window.fetch(url, init);
            expect(await response.json()).toBeTruthy();
        }

        expect(seen.map(request => request.path)).toEqual(cases.map(([url]) => url));
        expect(seen[0].body).toMatchObject({placement: "child", contextID: CURRENT_DOC});
        expect(seen[1].body).toMatchObject({purpose: "reference", contextID: CURRENT_DOC});
    });

    it("目标留空时完全保留思源默认行为", async () => {
        const seen = installKernel(defaultRoutes());
        mountForTest(hostOf(""));

        await window.fetch("/api/filetree/planDocCreate", planRequest());

        expect(seen).toHaveLength(1);
        expect(seen[0].body).toMatchObject({contextID: CURRENT_DOC, placement: "configured"});
    });

    it("目标 ID 格式不对时只判本次失败，不发计划请求也不回落默认位置", async () => {
        const seen = installKernel(defaultRoutes());
        mountForTest(hostOf("not-an-id"));

        const response = await window.fetch("/api/filetree/planDocCreate", planRequest());

        expect(seen).toHaveLength(0);
        await expect(response.json()).resolves.toEqual({
            code: -1,
            msg: "feature.newDocFixedTarget.invalid",
            data: null,
        });
    });

    it("文档不存在时用内核的提示判失败", async () => {
        const seen = installKernel(defaultRoutes({
            "/api/block/getBlock": () => ({code: -1, msg: "block not found"}),
        }));
        mountForTest(hostOf());

        const response = await window.fetch("/api/filetree/planDocCreate", planRequest());

        expect(seen).toHaveLength(1);
        await expect(response.json()).resolves.toEqual({code: -1, msg: "block not found", data: null});
    });

    it("普通正文块、已关闭的笔记本都不能当目标", async () => {
        const seen = installKernel(defaultRoutes({
            "/api/block/getBlock": (body: any) => ({
                code: 0,
                data: {id: body.id, rootID: "x", type: "p", box: NOTEBOOK},
            }),
        }));
        mountForTest(hostOf());

        const response = await window.fetch("/api/filetree/planDocCreate", planRequest());
        await expect(response.json()).resolves.toMatchObject({code: -1, msg: "feature.newDocFixedTarget.invalid"});

        (window.siyuan as any).notebooks = [{id: NOTEBOOK, closed: true}];
        const closed = await window.fetch("/api/filetree/planDocCreate", planRequest());
        await expect(closed.json()).resolves.toMatchObject({code: -1, msg: "feature.newDocFixedTarget.invalid"});
        expect(seen).toHaveLength(2);
    });

    it("斜杠菜单里的「新建文档（插入块引用）」保持宿主行为", async () => {
        const seen = installKernel(defaultRoutes());
        mountForTest(hostOf());
        document.body.innerHTML = `<div class="protyle-hint b3-list">
            <button class="b3-list-item" data-value="%E2%80%8B4"><span class="b3-list-item__text">新建文档</span></button>
            <button class="b3-list-item" data-value="%E4%BB%A3%E7%A0%81"><span class="b3-list-item__text">代码块</span></button>
        </div>`;

        document.querySelector(".protyle-hint .b3-list-item__text").dispatchEvent(
            new MouseEvent("click", {bubbles: true, button: 0}),
        );
        await window.fetch("/api/filetree/planDocCreate", planRequest());

        expect(seen).toHaveLength(1);
        expect(seen[0].body).toMatchObject({contextID: CURRENT_DOC, placement: "configured"});
    });

    it("键盘选中的「新建文档（插入块引用）」同样保持宿主行为", async () => {
        const seen = installKernel(defaultRoutes());
        mountForTest(hostOf());
        document.body.innerHTML = `<div class="protyle-hint b3-list">
            <button class="b3-list-item b3-list-item--focus" data-value="%E2%80%8B4">
                <span class="b3-list-item__text">新建文档</span>
            </button>
        </div>`;

        window.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", cancelable: true}));
        await window.fetch("/api/filetree/planDocCreate", planRequest());

        expect(seen).toHaveLength(1);
        expect(seen[0].body).toMatchObject({contextID: CURRENT_DOC, placement: "configured"});
    });

    it("提示面板里点别的候选、或面板已收起时，普通新建仍走固定父级", async () => {
        const seen = installKernel(defaultRoutes());
        mountForTest(hostOf());
        document.body.innerHTML = `<div class="protyle-hint b3-list">
            <button class="b3-list-item" data-value="%E4%BB%A3%E7%A0%81"><span>代码块</span></button>
        </div>`;

        document.querySelector(".protyle-hint span").dispatchEvent(new MouseEvent("click", {bubbles: true, button: 0}));
        await window.fetch("/api/filetree/planDocCreate", planRequest());

        document.querySelector(".protyle-hint").classList.add("fn__none");
        document.querySelector(".protyle-hint span").dispatchEvent(new MouseEvent("click", {bubbles: true, button: 0}));
        await window.fetch("/api/filetree/planDocCreate", planRequest());

        expect(seen.map(request => request.path)).toEqual([
            "/api/block/getBlock",
            "/api/filetree/planDocCreate",
            "/api/block/getBlock",
            "/api/filetree/planDocCreate",
        ]);
        expect(seen[3].body).toMatchObject({contextID: TARGET, placement: "child"});
    });

    it("放行只作用于同一次交互，不会漏给之后的普通新建", async () => {
        const seen = installKernel(defaultRoutes());
        mountForTest(hostOf());
        document.body.innerHTML = `<div class="protyle-hint b3-list">
            <button class="b3-list-item" data-value="%E2%80%8B4"><span>新建文档</span></button>
        </div>`;

        document.querySelector(".protyle-hint span").dispatchEvent(new MouseEvent("click", {bubbles: true, button: 0}));
        await new Promise(resolve => setTimeout(resolve, 5));
        await window.fetch("/api/filetree/planDocCreate", planRequest());

        expect(seen.map(request => request.path)).toEqual(["/api/block/getBlock", "/api/filetree/planDocCreate"]);
        expect(seen[1].body).toMatchObject({contextID: TARGET, placement: "child"});
    });

    it("卸载后完全恢复原入口", async () => {
        installKernel(defaultRoutes());
        const patchedFetch = window.fetch;
        const instance = mountForTest(hostOf());
        expect(window.fetch).not.toBe(patchedFetch);

        instance.destroy?.();

        expect(window.fetch).toBe(patchedFetch);
    });

    it("卸载时不动别人后来换上的 fetch", () => {
        installKernel(defaultRoutes());
        const instance = mountForTest(hostOf());
        const other = vi.fn() as unknown as typeof fetch;
        window.fetch = other;

        instance.destroy?.();

        expect(window.fetch).toBe(other);
    });
});
