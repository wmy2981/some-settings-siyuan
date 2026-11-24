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
    "/api/query/sql": () => ({code: 0, data: [{id: TARGET, type: "d", root_id: TARGET, box: NOTEBOOK}]}),
    "/api/block/getBlockInfo": () => ({code: 0, data: {rootID: TARGET}}),
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
        title: "Note",
        id: DOCUMENT_ID,
        ...overrides,
    }),
});

describe("new document to a fixed target", () => {
    beforeEach(() => {
        savedFetch = window.fetch;
        (window.siyuan as any).notebooks = [{id: NOTEBOOK, closed: false}];
    });

    afterEach(() => {
        mounted.splice(0).forEach(instance => instance.destroy?.());
        window.fetch = savedFetch as typeof fetch;
    });

    it("the plan request of a normal new document goes to the configured parent, other parameters and the response stay unchanged", async () => {
        const plan = {code: 0, data: {notebook: NOTEBOOK, title: "Note", steps: []}};
        const seen = installKernel(defaultRoutes({"/api/filetree/planDocCreate": () => plan}));
        mountForTest(hostOf());

        const response = await window.fetch("/api/filetree/planDocCreate", planRequest());

        expect(seen.map(request => request.path)).toEqual(["/api/query/sql", "/api/filetree/planDocCreate"]);
        expect(seen[0].body).toEqual({stmt: "select id, type, root_id, box from blocks where id = '" + TARGET + "'"});
        expect(seen[1].body).toEqual({
            notebook: NOTEBOOK,
            contextID: TARGET,
            purpose: "document",
            placement: "child",
            title: "Note",
            id: DOCUMENT_ID,
        });
        // 计划请求的响应原封不动交给宿主的 newFile 链路
        await expect(response.json()).resolves.toEqual(plan);
    });

    it("a notebook ID creates in the notebook root without a parent document", async () => {
        const seen = installKernel(defaultRoutes());
        mountForTest(hostOf(NOTEBOOK));

        await window.fetch("/api/filetree/planDocCreate", planRequest());

        expect(seen).toHaveLength(1);
        expect(seen[0].body).toMatchObject({notebook: NOTEBOOK, contextID: null, placement: "child"});
    });

    it("relative addresses from the command palette and addresses with query parameters are recognized as well", async () => {
        const seen = installKernel(defaultRoutes());
        mountForTest(hostOf());

        await window.fetch(`${location.origin}/api/filetree/planDocCreate?app=window1`, planRequest());

        expect(seen[0].body).toEqual({stmt: "select id, type, root_id, box from blocks where id = '" + TARGET + "'"});
        expect(seen[1].body).toMatchObject({contextID: TARGET, placement: "child"});
        expect(seen[1].url).toBe(`${location.origin}/api/filetree/planDocCreate?app=window1`);
    });

    it("does not intercept child documents, references, daily notes or other endpoints", async () => {
        const seen = installKernel(defaultRoutes());
        mountForTest(hostOf());

        const cases: [string, RequestInit][] = [
            ["/api/filetree/planDocCreate", planRequest({placement: "child"})],
            ["/api/filetree/planDocCreate", planRequest({purpose: "reference", placement: "configured"})],
            ["/api/filetree/planDocCreate", planRequest({purpose: "dailyNote", placement: undefined})],
            ["/api/block/getBlockInfo", planRequest()],
        ];
        for (const [url, init] of cases) {
            const response = await window.fetch(url, init);
            expect(await response.json()).toBeTruthy();
        }

        expect(seen.map(request => request.path)).toEqual(cases.map(([url]) => url));
        expect(seen[0].body).toMatchObject({placement: "child", contextID: CURRENT_DOC});
        expect(seen[1].body).toMatchObject({purpose: "reference", contextID: CURRENT_DOC});
    });

    it("an empty target keeps the SiYuan default behavior untouched", async () => {
        const seen = installKernel(defaultRoutes());
        mountForTest(hostOf(""));

        await window.fetch("/api/filetree/planDocCreate", planRequest());

        expect(seen).toHaveLength(1);
        expect(seen[0].body).toMatchObject({contextID: CURRENT_DOC, placement: "configured"});
    });

    it("a malformed target ID fails this request only, with no plan request and no fallback to the default location", async () => {
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

    it("a missing document fails with the kernel message", async () => {
        const seen = installKernel(defaultRoutes({
            "/api/query/sql": () => ({code: -1, msg: "block not found"}),
        }));
        mountForTest(hostOf());

        const response = await window.fetch("/api/filetree/planDocCreate", planRequest());

        expect(seen).toHaveLength(1);
        await expect(response.json()).resolves.toEqual({code: -1, msg: "block not found", data: null});
    });

    it("plain paragraph blocks and closed notebooks cannot be targets", async () => {
        const seen = installKernel(defaultRoutes({
            "/api/query/sql": () => ({
                code: 0,
                data: [{id: TARGET, type: "p", root_id: "x", box: NOTEBOOK}],
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

    it("the slash menu entry for a new document with a block reference keeps the host behavior", async () => {
        const seen = installKernel(defaultRoutes());
        mountForTest(hostOf());
        document.body.innerHTML = `<div class="protyle-hint b3-list">
            <button class="b3-list-item" data-value="%E2%80%8B4"><span class="b3-list-item__text">New Document</span></button>
            <button class="b3-list-item" data-value="%E4%BB%A3%E7%A0%81"><span class="b3-list-item__text">Code Block</span></button>
        </div>`;

        document.querySelector(".protyle-hint .b3-list-item__text").dispatchEvent(
            new MouseEvent("click", {bubbles: true, button: 0}),
        );
        await window.fetch("/api/filetree/planDocCreate", planRequest());

        expect(seen).toHaveLength(1);
        expect(seen[0].body).toMatchObject({contextID: CURRENT_DOC, placement: "configured"});
    });

    it("the new document with a block reference picked by keyboard keeps the host behavior too", async () => {
        const seen = installKernel(defaultRoutes());
        mountForTest(hostOf());
        document.body.innerHTML = `<div class="protyle-hint b3-list">
            <button class="b3-list-item b3-list-item--focus" data-value="%E2%80%8B4">
                <span class="b3-list-item__text">New Document</span>
            </button>
        </div>`;

        window.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", cancelable: true}));
        await window.fetch("/api/filetree/planDocCreate", planRequest());

        expect(seen).toHaveLength(1);
        expect(seen[0].body).toMatchObject({contextID: CURRENT_DOC, placement: "configured"});
    });

    it("clicking another hint item, or a collapsed hint panel, still uses the fixed parent for a normal new document", async () => {
        const seen = installKernel(defaultRoutes());
        mountForTest(hostOf());
        document.body.innerHTML = `<div class="protyle-hint b3-list">
            <button class="b3-list-item" data-value="%E4%BB%A3%E7%A0%81"><span>Code Block</span></button>
        </div>`;

        document.querySelector(".protyle-hint span").dispatchEvent(new MouseEvent("click", {bubbles: true, button: 0}));
        await window.fetch("/api/filetree/planDocCreate", planRequest());

        document.querySelector(".protyle-hint").classList.add("fn__none");
        document.querySelector(".protyle-hint span").dispatchEvent(new MouseEvent("click", {bubbles: true, button: 0}));
        await window.fetch("/api/filetree/planDocCreate", planRequest());

        expect(seen.map(request => request.path)).toEqual([
            "/api/query/sql",
            "/api/filetree/planDocCreate",
            "/api/query/sql",
            "/api/filetree/planDocCreate",
        ]);
        expect(seen[3].body).toMatchObject({contextID: TARGET, placement: "child"});
    });

    it("the pass-through applies to that one interaction and does not leak to later new documents", async () => {
        const seen = installKernel(defaultRoutes());
        mountForTest(hostOf());
        document.body.innerHTML = `<div class="protyle-hint b3-list">
            <button class="b3-list-item" data-value="%E2%80%8B4"><span>New Document</span></button>
        </div>`;

        document.querySelector(".protyle-hint span").dispatchEvent(new MouseEvent("click", {bubbles: true, button: 0}));
        await new Promise(resolve => setTimeout(resolve, 5));
        await window.fetch("/api/filetree/planDocCreate", planRequest());

        expect(seen.map(request => request.path)).toEqual(["/api/query/sql", "/api/filetree/planDocCreate"]);
        expect(seen[1].body).toMatchObject({contextID: TARGET, placement: "child"});
    });

    it("unmounting fully restores the original entry", async () => {
        installKernel(defaultRoutes());
        const patchedFetch = window.fetch;
        const instance = mountForTest(hostOf());
        expect(window.fetch).not.toBe(patchedFetch);

        instance.destroy?.();

        expect(window.fetch).toBe(patchedFetch);
    });

    it("unmounting leaves a fetch installed by someone else untouched", () => {
        installKernel(defaultRoutes());
        const instance = mountForTest(hostOf());
        const other = vi.fn() as unknown as typeof fetch;
        window.fetch = other;

        instance.destroy?.();

        expect(window.fetch).toBe(other);
    });
});
