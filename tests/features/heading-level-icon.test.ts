/**
 * 引用列表与搜索面板里的标题图标带上层级。
 *
 * 这个功能的工作流是「扫描 → 批量问内核 → 换 `<use>` 的 href」，中间隔着一次 `fetch`
 * 和一帧 `requestAnimationFrame`，所以断言全部走 `vi.waitFor`，不靠 sleep。
 * 要守的点：
 * - 一次批量 `IN` 查询，最多 50 个 id，问过的（含「查无此块」）要落缓存，不重复问；
 * - 查询失败只记一条日志、冷却期内不重试，但已经缓存的层级照旧要应用上去；
 * - `destroy()` 把图标还给内核（纯 H）并拆掉观察，新增条目不能再改 DOM。
 */
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import type {FeatureHost} from "../../src/core/types";
import definition from "../../src/features/heading-level-icon";
import {mountHeadingLevelIcon} from "../../src/features/heading-level-icon/level";
import {
    mountFeature,
    noopLogger,
} from "../helpers/feature-host";

const PLAIN = "#iconHeadings";

const fetchMock = vi.fn();

/** 造一次成功的内核 SQL 响应。 */
const respond = (
    rows: {id?: string; subtype?: string;}[],
    options: {code?: number; msg?: string; ok?: boolean; status?: number;} = {},
): void => {
    fetchMock.mockResolvedValueOnce({
        ok: options.ok ?? true,
        status: options.status ?? 200,
        json: async () => ({code: options.code ?? 0, msg: options.msg, data: rows}),
    });
};

/** 搜索面板 / 未引用面板 / 移动端搜索共用的条目。 */
const buildSearchItem = (id: string | null, icon = PLAIN): HTMLElement => {
    const item = document.createElement("div");
    item.setAttribute("data-type", "search-item");
    if (id !== null) {
        item.setAttribute("data-node-id", id);
    }
    item.innerHTML = `<svg class="b3-list-item__graphic"><use href="${icon}" xlink:href="${icon}"></use></svg>`;
    document.body.append(item);
    return item;
};

/** `((` 引用列表的候选：容器是 `.protyle-hint`，条目里逐层带 id。 */
const buildHintItem = (id: string): HTMLElement => {
    const container = document.createElement("div");
    container.className = "protyle-hint";
    const item = document.createElement("div");
    item.className = "b3-list-item";
    item.innerHTML = `<span data-id="${id}">标题</span><svg><use href="${PLAIN}"></use></svg>`;
    container.append(item);
    document.body.append(container);
    return item;
};

const useOf = (item: Element): SVGUseElement => item.querySelector("use") as unknown as SVGUseElement;

/** 等一帧 rAF 加一次宏任务：给「不应该发生」的断言用。 */
const settle = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 60));
};

const bodyOfLastQuery = (): {stmt: string;} => {
    const call = fetchMock.mock.calls.at(-1);
    return JSON.parse((call?.[1] as {body: string;}).body) as {stmt: string;};
};

describe("标题图标显示层级", () => {
    const mounted: {dispose: () => void; records: {logs: unknown[][];};}[] = [];

    const mount = () => {
        const harness = mountFeature(definition);
        mounted.push(harness);
        return harness;
    };

    beforeEach(() => {
        fetchMock.mockReset();
        vi.stubGlobal("fetch", fetchMock);
    });

    afterEach(() => {
        mounted.splice(0).forEach((harness) => harness.dispose());
        vi.unstubAllGlobals();
    });

    it("声明里默认关闭，两端都适用", () => {
        expect(definition.frontends).toBeUndefined();
        expect(definition.settings[0]).toMatchObject({kind: "switch", key: "enabled", default: false});
        expect(definition.category).toBe("editor");
    });

    it("标题块换成对应的 H1～H6 图标，href 与 xlink:href 一起改", () => {
        const item = buildSearchItem("block-1");
        respond([{id: "block-1", subtype: "h2"}]);
        mount();

        return vi.waitFor(() => {
            expect(useOf(item).getAttribute("href")).toBe("#iconH2");
            // 思源自己的图标引用两套属性都有，只改一套会在部分主题下不生效
            expect(useOf(item).getAttribute("xlink:href")).toBe("#iconH2");
            expect(item.getAttribute("data-ss-heading-level")).toBe("2");
        });
    });

    it("一次性批量查询：POST /api/query/sql，IN 列表就是条目上的块 id", () => {
        buildSearchItem("a1");
        buildSearchItem("a2");
        respond([{id: "a1", subtype: "h1"}, {id: "a2", subtype: "h3"}]);
        mount();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("/api/query/sql");
        expect(init).toMatchObject({method: "POST", headers: {"Content-Type": "application/json"}});
        expect(bodyOfLastQuery().stmt).toBe("SELECT id, subtype FROM blocks WHERE id IN ('a1','a2')");
    });

    it("不是标题块也落缓存：标记为空串，图标保持纯 H", () => {
        const item = buildSearchItem("para-1");
        respond([{id: "para-1", subtype: "p"}]);
        const harness = mount();

        return vi.waitFor(() => {
            expect(item.hasAttribute("data-ss-heading-level")).toBe(true);
            expect(item.getAttribute("data-ss-heading-level")).toBe("");
            expect(useOf(item).getAttribute("href")).toBe(PLAIN);
        }).then(async () => {
            // 同一个块再来一行：层级已在缓存里（空串也是缓存），不该再问一次内核
            document.body.append(item.cloneNode(true) as HTMLElement);
            await settle();
            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(harness.records.logs).toHaveLength(0);
        });
    });

    it("内核没返回的 id 也记成「查过了」，避免每次扫描重复问", () => {
        const item = buildSearchItem("gone-1");
        respond([]);
        mount();

        return vi.waitFor(() => {
            expect(item.getAttribute("data-ss-heading-level")).toBe("");
        }).then(async () => {
            buildSearchItem("gone-1");
            await settle();
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });
    });

    it("单批最多 50 个 id，剩下的下一轮再问", async () => {
        const items: HTMLElement[] = [];
        for (let index = 0; index < 60; index += 1) {
            items.push(buildSearchItem(`b${index.toString().padStart(2, "0")}`));
        }
        const firstBatch = items.slice(0, 50).map((item, index) => ({
            id: `b${index.toString().padStart(2, "0")}`,
            subtype: "h1",
        }));
        respond(firstBatch);
        respond([{id: "b59", subtype: "h6"}]);
        mount();

        await vi.waitFor(() => {
            expect(fetchMock).toHaveBeenCalledTimes(2);
            expect(items[59].getAttribute("data-ss-heading-level")).toBe("6");
        });
        expect(bodyOfLastQuery().stmt).toBe(
            "SELECT id, subtype FROM blocks WHERE id IN ('b50','b51','b52','b53','b54','b55','b56','b57','b58','b59')",
        );
        expect(fetchMock.mock.calls[0][1]).toMatchObject({method: "POST"});
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("「((」候选里的 id 在内层元素上也能取到", () => {
        const item = buildHintItem("hint-1");
        respond([{id: "hint-1", subtype: "h5"}]);
        mount();

        return vi.waitFor(() => {
            expect(bodyOfLastQuery().stmt).toContain("'hint-1'");
            expect(useOf(item).getAttribute("href")).toBe("#iconH5");
        });
    });

    it("id 不合规、或条目已带标记、或图标不是通用 H 时一律跳过", async () => {
        const invalid = buildSearchItem("bad id");
        const noId = buildSearchItem(null);
        const marked = buildSearchItem("marked-1");
        marked.setAttribute("data-ss-heading-level", "3");
        const customIcon = buildSearchItem("custom-1", "#iconH1");
        mount();

        await settle();

        // 一条查询都不发：三个条目分别因为 id 非法 / 已处理 / 图标不是纯 H 被跳过
        expect(fetchMock).not.toHaveBeenCalled();
        expect(invalid.hasAttribute("data-ss-heading-level")).toBe(false);
        expect(noId.hasAttribute("data-ss-heading-level")).toBe(false);
        expect(marked.getAttribute("data-ss-heading-level")).toBe("3");
        expect(useOf(customIcon).getAttribute("href")).toBe("#iconH1");
    });

    it("HTTP 非 2xx / code 非 0 / 网络失败都只记一条日志，不抛到宿主", async () => {
        const cases: (() => void)[] = [
            () => respond([], {ok: false, status: 500}),
            () => respond([], {code: 3, msg: "permission denied"}),
            () => fetchMock.mockRejectedValueOnce(new Error("offline")),
        ];
        for (const arrange of cases) {
            buildSearchItem(`fail-${cases.indexOf(arrange)}`);
            arrange();
            const harness = mount();
            await vi.waitFor(() => expect(harness.records.logs).toHaveLength(1));
            expect(harness.records.logs[0][0]).toContain("Block subtype query failed");
            mounted.splice(0).forEach((harness_) => harness_.dispose());
            document.body.innerHTML = "";
            fetchMock.mockReset();
        }
    });

    it("失败后冷却 60 秒：期间不再查询，期满才重试，且不重复刷日志", async () => {
        const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
        buildSearchItem("c1");
        fetchMock.mockRejectedValue(new Error("offline"));
        const harness = mount();

        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        await vi.waitFor(() => expect(harness.records.logs).toHaveLength(1));

        buildSearchItem("c2");
        await settle();
        expect(fetchMock).toHaveBeenCalledTimes(1);

        now.mockReturnValue(1_000_000 + 60_001);
        buildSearchItem("c3");
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

        await settle();
        // 第二次失败同样被吞掉，但日志不再增加：失败只在第一次上报
        expect(harness.records.logs).toHaveLength(1);
    });

    it("冷却只挡查询，不挡已缓存的层级落地", async () => {
        const first = buildSearchItem("d1");
        respond([{id: "d1", subtype: "h4"}]);
        mount();

        await vi.waitFor(() => expect(useOf(first).getAttribute("href")).toBe("#iconH4"));

        buildSearchItem("d2");
        fetchMock.mockRejectedValueOnce(new Error("offline"));
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

        // 同一份块再来一行（缓存里是 "4"），即使处在冷却期也要立刻换成 H4
        const duplicate = buildSearchItem("d1");
        await vi.waitFor(() => expect(useOf(duplicate).getAttribute("href")).toBe("#iconH4"));
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("内核返回的行 id 畸形时跳过，不写进缓存也不影响同一批的其它行", () => {
        const item = buildSearchItem("x1");
        respond([{id: "bad id", subtype: "h1"}, {id: "x1", subtype: "h2"}]);
        mount();

        return vi.waitFor(() => {
            expect(useOf(item).getAttribute("href")).toBe("#iconH2");
        }).then(() => {
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });
    });

    it("同一批 id 还在查询中时不会再发一次请求", async () => {
        let resolveFetch: (value: unknown) => void = () => undefined;
        fetchMock.mockReturnValueOnce(
            new Promise((resolve) => {
                resolveFetch = resolve;
            }),
        );
        const item = buildSearchItem("y1");
        mount();
        expect(fetchMock).toHaveBeenCalledTimes(1);

        // 查询未返回时又出现同一个块：这批 id 已经在飞行中，不能再问一遍
        buildSearchItem("y1");
        await settle();
        expect(fetchMock).toHaveBeenCalledTimes(1);

        resolveFetch({ok: true, status: 200, json: async () => ({code: 0, data: [{id: "y1", subtype: "h3"}]})});
        await vi.waitFor(() => expect(useOf(item).getAttribute("href")).toBe("#iconH3"));
    });

    it("一帧只扫一次：同一帧里的两批新增合并到同一次扫描与同一条查询", async () => {
        mount();

        buildSearchItem("z1");
        // 让 MutationObserver 的回调先跑（它会排上一帧），此后再来一次新增
        await Promise.resolve();
        buildSearchItem("z2");
        await Promise.resolve();

        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        const stmt = bodyOfLastQuery().stmt;
        expect(stmt).toContain("'z1'");
        expect(stmt).toContain("'z2'");
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("只有可能带着条目的新增子树才触发扫描", async () => {
        mount();

        // 纯文本节点连 Element 都不是，观察者的第一条判断就该把它跳过
        document.body.append(document.createTextNode("纯文本节点"));

        const plain = document.createElement("div");
        plain.innerHTML = "<span>正文里的普通节点</span>";
        document.body.append(plain);
        await settle();
        expect(fetchMock).not.toHaveBeenCalled();

        // 容器一次性插进来（搜索页签、提示面板都是这种形态）：要能从新增子树里认出来
        const wrapper = document.createElement("div");
        wrapper.innerHTML = `<div data-type="search-item" data-node-id="w1">
            <svg><use href="${PLAIN}"></use></svg></div>`;
        document.body.append(wrapper);

        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        expect(bodyOfLastQuery().stmt).toContain("'w1'");
    });

    it("`.protyle-hint` 容器本身出现也算「可能带条目」", async () => {
        mount();
        const container = document.createElement("div");
        container.className = "protyle-hint";
        container.innerHTML = `<div class="b3-list-item" data-id="p1"><svg><use href="${PLAIN}"></use></svg></div>`;
        document.body.append(container);

        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        expect(bodyOfLastQuery().stmt).toContain("'p1'");
    });

    it("destroy 把图标还给内核并清掉标记", async () => {
        const heading = buildSearchItem("e1");
        const plain = buildSearchItem("e2");
        respond([{id: "e1", subtype: "h3"}, {id: "e2", subtype: "p"}]);
        const harness = mount();

        await vi.waitFor(() => expect(useOf(heading).getAttribute("href")).toBe("#iconH3"));

        harness.dispose();

        expect(useOf(heading).getAttribute("href")).toBe(PLAIN);
        expect(useOf(heading).getAttribute("xlink:href")).toBe(PLAIN);
        expect(heading.hasAttribute("data-ss-heading-level")).toBe(false);
        // 不是标题块的条目本来就没换过图标，只把标记清掉
        expect(useOf(plain).getAttribute("href")).toBe(PLAIN);
        expect(plain.hasAttribute("data-ss-heading-level")).toBe(false);
    });

    it("destroy 之后新增条目不查询、不改写", async () => {
        const harness = mount();
        harness.dispose();

        const item = buildSearchItem("f1");
        await settle();

        expect(fetchMock).not.toHaveBeenCalled();
        expect(item.hasAttribute("data-ss-heading-level")).toBe(false);
    });

    it("destroy 取消已排上的那一帧，不再扫描", async () => {
        const harness = mount();
        // 先让 MutationObserver 的回调跑完（它会把 rAF 排上），再在 rAF 之前卸载
        buildSearchItem("g1");
        await Promise.resolve();
        harness.dispose();

        await settle();

        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("挂载即扫描一次现有条目，destroy 后移除观察者", async () => {
        const item = buildSearchItem("i1");
        respond([{id: "i1", subtype: "h6"}]);
        const host = {
            config: {},
            log: noopLogger,
        } as unknown as FeatureHost;

        const instance = mountHeadingLevelIcon(host);
        await vi.waitFor(() => expect(useOf(item).getAttribute("href")).toBe("#iconH6"));

        instance?.destroy();

        expect(useOf(item).getAttribute("href")).toBe(PLAIN);
        expect(item.hasAttribute("data-ss-heading-level")).toBe(false);
    });
});
