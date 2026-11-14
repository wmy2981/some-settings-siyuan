import {
    describe,
    expect,
    it,
    vi,
} from "vitest";
import {
    createAnnotator,
    DETAIL_CSS,
} from "../../src/features/agent-tool-call-detail/annotate";
import definition from "../../src/features/agent-tool-call-detail/index";
import type {LiveSteps} from "../../src/features/agent-tool-call-detail/live";
import {createLiveSteps} from "../../src/features/agent-tool-call-detail/live";
import type {IndexedStep} from "../../src/features/agent-tool-call-detail/session";
import {createSessionIndex} from "../../src/features/agent-tool-call-detail/session";
import {
    describeToolCall,
    mergeInline,
    mergeTooltip,
} from "../../src/features/agent-tool-call-detail/summary";
import type {
    ToolCallData,
    ToolCallLabels,
} from "../../src/features/agent-tool-call-detail/summary";
import {createResponseTap} from "../../src/features/agent-tool-call-detail/tap";
import {mountFeature} from "../helpers/feature-host";

const LABELS: ToolCallLabels = {args: "参数", result: "结果", noArgs: "无"};

const CHAT_URL = "/api/ai/agent/chat";
const GET_SESSION_URL = "/api/ai/agent/getSession";

/** 造一个假的 `window.fetch`；测试里所有被动观察都从它取响应。 */
const stubFetch = (impl: (...args: any[]) => Promise<Response>): ReturnType<typeof vi.fn> => {
    const stub = vi.fn(impl);
    window.fetch = stub as unknown as typeof window.fetch;
    return stub;
};

/** 一段 JSON 响应；`ok: false` 时状态码 500，用来验证「失败响应不读」。 */
const jsonResponse = (
    payload: unknown,
    options: {ok?: boolean; contentType?: string;} = {},
): Response =>
    new Response(JSON.stringify(payload), {
        status: options.ok === false ? 500 : 200,
        headers: {"Content-Type": options.contentType ?? "application/json"},
    });

/** 一段事件流响应；每个元素单独入队，用来验证跨 chunk 的行缓冲。 */
const sseResponse = (chunks: string[], contentType = "text/event-stream"): Response => {
    const encoder = new TextEncoder();
    return new Response(
        new ReadableStream({
            start(controller) {
                chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
                controller.close();
            },
        }),
        {headers: {"Content-Type": contentType}},
    );
};

/** `event:` + `data:` 一条；内核每条事件都只写一行 data。 */
const sseEvent = (event: string, data: unknown): string => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

const waitFor = async (assertion: () => void): Promise<void> => {
    await vi.waitFor(assertion, {timeout: 2000, interval: 5});
};

/** 等几帧，让 observe → schedule → requestAnimationFrame → reconcile 这一串跑完。 */
const settle = async (): Promise<void> => {
    for (let index = 0; index < 4; index++) {
        await new Promise((resolve) => window.requestAnimationFrame(resolve));
    }
};

describe("智能体工具调用显示细节", () => {
    describe("describeToolCall（摘要与悬停文本）", () => {
        it("没有参数时内联摘要为空，悬停里写明「无参数」", () => {
            // 工具名由胶囊自己显示，摘要里再重复一遍只会让那一行更长
            expect(describeToolCall({name: "search"}, LABELS)).toEqual({
                inline: "",
                tooltip: "search\n参数: 无",
            });
        });

        it("优先把 action 放进摘要，再取一个能定位目标的参数", () => {
            const view = describeToolCall({
                name: "block",
                arguments: {action: "get", id: "20240101000000-abc", query: "hello"},
            }, LABELS);

            // id 在对象里排在 query 前面，所以取 id：两者都在定位键白名单里，取声明顺序靠前的那个
            expect(view.inline).toBe("get 20240101000000-abc");
        });

        it("定位键白名单里的字段优先于普通字段", () => {
            const view = describeToolCall({
                name: "search",
                arguments: {custom: "noise", query: "思源"},
            }, LABELS);

            // `custom` 不是白名单键，`query` 才是「这一次查了什么」的答案
            expect(view.inline).toBe("思源");
        });

        it("没有白名单键时取第一个非内容型字段，最后才退回内容型大字段", () => {
            expect(describeToolCall({name: "x", arguments: {extra: "a", data: "b"}}, LABELS).inline)
                .toBe("a");
            // 只剩内容型字段时仍要给出摘要，否则整行看起来像没有参数
            expect(describeToolCall({name: "x", arguments: {data: "b"}}, LABELS).inline).toBe("b");
        });

        it("丢掉内核注入的内部字段与空值", () => {
            const view = describeToolCall({
                name: "search",
                arguments: {
                    _sessionID: "s1",
                    _toolCallID: "c1",
                    query: "",
                    notebook: null,
                    keyword: " 关键词 ",
                },
            }, LABELS);

            expect(view.inline).toBe("关键词");
            // 内部字段也不能出现在悬停的 JSON 里：用户看不懂它们
            expect(view.tooltip).not.toContain("_sessionID");
            expect(view.tooltip).not.toContain("_toolCallID");
            expect(view.tooltip).toContain('"keyword": " 关键词 "');
        });

        it("数组按标量拼接，混入对象时只报规模，对象只报「{…}」", () => {
            expect(describeToolCall({name: "x", arguments: {ids: ["a", "b"]}}, LABELS).inline).toBe("a,b");
            expect(describeToolCall({name: "x", arguments: {ids: [1, 2, 3]}}, LABELS).inline).toBe("1,2,3");
            expect(describeToolCall({name: "x", arguments: {ids: ["a", {id: 1}]}}, LABELS).inline).toBe("[2]");
            expect(describeToolCall({name: "x", arguments: {id: {x: 1}}}, LABELS).inline).toBe("{…}");
            expect(describeToolCall({name: "x", arguments: {id: 42}}, LABELS).inline).toBe("42");
            expect(describeToolCall({name: "x", arguments: {id: false}}, LABELS).inline).toBe("false");
        });

        it("字符串里的换行与连续空白压成一个空格", () => {
            // 内联摘要只有一行，未折叠的换行会把工具行撑成好几行
            expect(describeToolCall({name: "x", arguments: {query: "  a \n\t b  "}}, LABELS).inline).toBe("a b");
        });

        it("内联摘要超过 44 字符时截断并以省略号结尾", () => {
            const view = describeToolCall({name: "x", arguments: {query: "q".repeat(60)}}, LABELS);
            expect(view.inline).toBe(`${"q".repeat(43)}…`);
            expect(view.inline).toHaveLength(44);
        });

        it("有结果时追加一行折叠后的结果，没有结果就不出现这一行", () => {
            const withResult = describeToolCall({
                name: "block",
                arguments: {id: "b1"},
                result: "line1\n  line2",
            }, LABELS);
            // 悬停里的参数是缩进过的 JSON：换行原样保留，提示框里才看得清结构
            expect(withResult.tooltip).toBe('block b1\n参数: {\n  "id": "b1"\n}\n结果: line1 line2');

            const withoutResult = describeToolCall({name: "block", arguments: {id: "b1"}, result: ""}, LABELS);
            expect(withoutResult.tooltip).not.toContain("结果:");
        });

        it("参数 JSON 截到 600 字符、结果截到 240 字符", () => {
            // 摘要（内联用的那一份）保持很短：否则悬停文本会先撞上 1600 的总长上限，
            // 量到的「参数那一行」就不再是 600，而是被总长截断后的残段
            const longArgs = describeToolCall({
                name: "x",
                arguments: {query: "short", data: "q".repeat(1000)},
            }, LABELS);
            const argsLine = longArgs.tooltip.slice(longArgs.tooltip.indexOf("参数: ") + "参数: ".length);
            expect(argsLine).toHaveLength(600);
            expect(argsLine.endsWith("…")).toBe(true);

            const longResult = describeToolCall({name: "x", result: "r".repeat(300)}, LABELS);
            const resultLine = longResult.tooltip.slice(longResult.tooltip.indexOf("结果: ") + "结果: ".length);
            expect(resultLine).toHaveLength(240);
            expect(resultLine.endsWith("…")).toBe(true);
        });

        it("整段悬停文本超过 1600 字符时统一截断", () => {
            // 工具名本身也可能很长（内核允许自定义工具），总长必须兜住
            const view = describeToolCall({name: "n".repeat(1700)}, LABELS);
            expect(view.tooltip).toHaveLength(1600);
            expect(view.tooltip.endsWith("…")).toBe(true);
        });
    });

    describe("mergeInline / mergeTooltip（一个胶囊并多次调用）", () => {
        it("多次调用的摘要用「 / 」连接并标出次数", () => {
            expect(mergeInline([{inline: "a", tooltip: ""}, {inline: "b", tooltip: ""}])).toBe("a / b ×2");
        });

        it("只有一条调用时不标次数", () => {
            expect(mergeInline([{inline: "a", tooltip: ""}])).toBe("a");
        });

        it("占位摘要被跳过，但次数仍按胶囊上的调用数算", () => {
            // 没有参数的调用也占一个调用位置，次数必须说真话
            expect(mergeInline([{inline: "", tooltip: ""}, {inline: "b", tooltip: ""}])).toBe("b ×2");
        });

        it("全部为空、或没有调用时返回空串", () => {
            expect(mergeInline([])).toBe("");
            expect(mergeInline([{inline: "", tooltip: ""}])).toBe("");
        });

        it("合并后的内联摘要上限是 56 字符", () => {
            const merged = mergeInline([
                {inline: "a".repeat(44), tooltip: ""},
                {inline: "b".repeat(44), tooltip: ""},
            ]);
            expect(merged).toHaveLength(56);
            expect(merged.endsWith("…")).toBe(true);
        });

        it("悬停详情用空行分隔，总长同样兜到 1600", () => {
            expect(mergeTooltip([{inline: "", tooltip: "t1"}, {inline: "", tooltip: "t2"}])).toBe("t1\n\nt2");
            expect(mergeTooltip([])).toBe("");
            const long = mergeTooltip([{inline: "", tooltip: "x".repeat(1600)}, {inline: "", tooltip: "y"}]);
            expect(long).toHaveLength(1600);
        });
    });

    describe("createSessionIndex（会话存档）", () => {
        /**
         * 装一个「按队列出响应」的 fetch 桩，并在它之上装观察。
         *
         * tap（tap.ts）只包住**装上那一刻**的 `window.fetch`，之后谁再换掉它，观察就整个失效。
         * 所以桩必须先装、之后只往队列里塞响应，不能再换 `window.fetch`。
         */
        const openIndex = () => {
            const queue: Response[] = [];
            window.fetch = vi.fn(async () =>
                queue.shift() ?? new Response(null, {status: 204})
            ) as unknown as typeof window.fetch;
            const index = createSessionIndex();
            const stop = index.observe();
            /** 推一份会话进索引，并等到最后那个条目真的被记住。 */
            const pushSession = async (payload: unknown, lastID: string, url = GET_SESSION_URL) => {
                queue.push(jsonResponse(payload));
                await window.fetch(url);
                await waitFor(() => expect(index.stepsOf(lastID)).toBeDefined());
            };
            /** 推一份任意响应（失败码、非 JSON…），观察层自己决定读不读。 */
            const pushRaw = async (response: Response, url = GET_SESSION_URL) => {
                queue.push(response);
                await window.fetch(url);
            };
            return {index, stop, pushSession, pushRaw};
        };

        it("思考条目的步按调用 ID 对齐，结果与参数都留在索引里", async () => {
            const {index, stop, pushSession} = openIndex();
            await pushSession({
                code: 0,
                data: {
                    entries: [
                        {
                            type: "assistant",
                            id: "a1",
                            toolCalls: [
                                {id: "c1", name: "search", arguments: {query: "q1"}, result: "R1"},
                                {id: "c2", name: "block", arguments: {id: "b2"}},
                            ],
                        },
                        {
                            type: "thinking",
                            id: "t1",
                            steps: [{toolNames: ["search", "block"], toolCallIDs: ["c1", "c2"]}],
                        },
                    ],
                },
            }, "t1");

            const steps = index.stepsOf("t1");
            expect(steps).toHaveLength(1);
            expect(steps?.[0].names).toEqual(["search", "block"]);
            expect(steps?.[0].calls.map((call) => call?.id)).toEqual(["c1", "c2"]);
            expect(steps?.[0].calls[0]?.result).toBe("R1");
            expect(steps?.[0].calls[1]?.arguments).toEqual({id: "b2"});
            stop();
        });

        it("缺调用 ID 时按名字顺序取下一个没被认领的调用", async () => {
            // 部分模型不给调用 ID，存档里步骤只留工具名；只能按会话内顺序兜底
            const {index, stop, pushSession} = openIndex();
            await pushSession({
                code: 0,
                data: {
                    entries: [
                        {
                            type: "assistant",
                            toolCalls: [
                                {name: "block", arguments: {id: "first"}},
                                {name: "block", arguments: {id: "second"}},
                            ],
                        },
                        {type: "thinking", id: "t1", steps: [{toolNames: ["block"]}, {toolNames: ["block"]}]},
                    ],
                },
            }, "t1");

            const steps = index.stepsOf("t1");
            expect(steps?.[0].calls[0]?.arguments).toEqual({id: "first"});
            // 游标前进：第二次同名调用不会再把第一条认领一遍
            expect(steps?.[1].calls[0]?.arguments).toEqual({id: "second"});
            stop();
        });

        it("ID 数量与名字数量对不上时整体退回按名字匹配", async () => {
            const {index, stop, pushSession} = openIndex();
            await pushSession({
                code: 0,
                data: {
                    entries: [
                        {type: "assistant", toolCalls: [{id: "c1", name: "search", arguments: {query: "by-name"}}]},
                        {type: "thinking", id: "t1", steps: [{toolNames: ["search"], toolCallIDs: ["c1", "c2"]}]},
                    ],
                },
            }, "t1");

            // 少一个 ID 就说明这份存档的 ID 不可信，宁可走名字也不按下标乱套
            expect(index.stepsOf("t1")?.[0].calls[0]?.arguments).toEqual({query: "by-name"});
            stop();
        });

        it("步里的名字在调用表里找不到时保留名字、调用留空", async () => {
            const {index, stop, pushSession} = openIndex();
            await pushSession({
                code: 0,
                data: {
                    entries: [
                        {
                            type: "thinking",
                            id: "t1",
                            steps: [{toolNames: ["ghost", 42, ""], toolCallIDs: []}],
                        },
                    ],
                },
            }, "t1");

            // 名字要给界面用来对胶囊；对不上数据时就是 undefined，界面据此保持原样
            expect(index.stepsOf("t1")?.[0].names).toEqual(["ghost"]);
            expect(index.stepsOf("t1")?.[0].calls).toEqual([undefined]);
            stop();
        });

        it("跳过非 thinking 条目、没有 id 的条目与没有名字的调用", async () => {
            const {index, stop, pushSession} = openIndex();
            await pushSession({
                code: 0,
                data: {
                    entries: [
                        {type: "assistant", id: "a1", toolCalls: [{name: ""}, {arguments: {}}]},
                        {type: "thinking", id: "", steps: []},
                        {type: "thinking", steps: []},
                        {type: "thinking", id: "t1", steps: "nope"},
                    ],
                },
            }, "t1");

            expect(index.stepsOf("t1")).toEqual([]);
            expect(index.stepsOf("a1")).toBeUndefined();
            stop();
        });

        it("结果只留前 1024 字符，参数不是对象时不收", async () => {
            // 读文档、搜索这类调用动辄几十 KB，全留在内存里没有任何用处
            const {index, stop, pushSession} = openIndex();
            await pushSession({
                code: 0,
                data: {
                    entries: [
                        {
                            type: "assistant",
                            toolCalls: [{id: "c1", name: "read", arguments: "not-an-object", result: "r".repeat(5000)}],
                        },
                        {type: "thinking", id: "t1", steps: [{toolNames: ["read"], toolCallIDs: ["c1"]}]},
                    ],
                },
            }, "t1");

            const call = index.stepsOf("t1")?.[0].calls[0];
            expect(call?.result).toHaveLength(1024);
            expect(call?.arguments).toBeUndefined();
            stop();
        });

        it("getSession 的 data 是会话本身，saveSession 的 data.session 才解包", async () => {
            const {index, stop, pushSession} = openIndex();
            const entries = [{type: "thinking", id: "t1", steps: [{toolNames: ["a"]}]}];

            await pushSession({code: 0, data: {entries}}, "t1");
            expect(index.stepsOf("t1")?.[0].names).toEqual(["a"]);

            await pushSession(
                {
                    code: 0,
                    data: {
                        revision: 3,
                        session: {
                            entries: [{type: "thinking", id: "t2", steps: [{toolNames: ["b"]}]}],
                        },
                    },
                },
                "t2",
                "/api/ai/agent/saveSession",
            );
            // saveSession 外面多包了一层 revision/session，解包错了这里就只剩一层空对象
            expect(index.stepsOf("t2")?.[0].names).toEqual(["b"]);
            stop();
        });

        it("失败响应、非 JSON 响应与非 0 code 都不读", async () => {
            const {index, stop, pushRaw} = openIndex();
            const listener = vi.fn();
            index.subscribe(listener);

            await pushRaw(jsonResponse({code: 0, data: {entries: []}}, {ok: false}));
            await pushRaw(jsonResponse({code: 0, data: {entries: []}}, {contentType: "text/plain"}));
            await pushRaw(jsonResponse({code: 500, data: {entries: [{type: "thinking", id: "t1"}]}}));
            await pushRaw(new Response("not json", {headers: {"Content-Type": "application/json"}}));

            await settle();
            expect(listener).not.toHaveBeenCalled();
            expect(index.stepsOf("t1")).toBeUndefined();
            stop();
        });

        it("读到新条目时通知订阅者，退订后不再通知", async () => {
            const {index, stop, pushSession} = openIndex();
            const listener = vi.fn();
            const unsubscribe = index.subscribe(listener);

            await pushSession({code: 0, data: {entries: [{type: "thinking", id: "t1", steps: []}]}}, "t1");
            await waitFor(() => expect(listener).toHaveBeenCalledTimes(1));

            unsubscribe();
            await pushSession({code: 0, data: {entries: [{type: "thinking", id: "t2", steps: []}]}}, "t2");
            expect(listener).toHaveBeenCalledTimes(1);
            stop();
        });

        it("索引上限 2000 条，重新写入的条目回到最新一端、不被优先淘汰", async () => {
            const {index, stop, pushSession} = openIndex();
            const ids = Array.from({length: 2000}, (_value, index_) => `e${index_}`);

            await pushSession(
                {code: 0, data: {entries: ids.map((id) => ({type: "thinking", id, steps: []}))}},
                "e1999",
            );
            expect(index.stepsOf("e0")).toBeDefined();

            // 重新写入 e0：先删再写让它的插入顺序回到最新，淘汰时该轮到 e1
            await pushSession({
                code: 0,
                data: {entries: [{type: "thinking", id: "e0", steps: [{toolNames: ["search"]}]}]},
            }, "e0");
            await waitFor(() => expect(index.stepsOf("e0")?.[0].names).toEqual(["search"]));

            await pushSession({code: 0, data: {entries: [{type: "thinking", id: "extra", steps: []}]}}, "extra");

            expect(index.stepsOf("e1")).toBeUndefined();
            expect(index.stepsOf("e0")).toBeDefined();
            stop();
        });

        it("observe 的撤销函数把 fetch 还原", async () => {
            const original = stubFetch(async () => jsonResponse({code: 0}));
            const index = createSessionIndex();
            const stop = index.observe();
            expect(window.fetch).not.toBe(original);

            stop();
            expect(window.fetch).toBe(original);
        });
    });

    describe("createLiveSteps（实时事件流）", () => {
        /**
         * 建一份实时索引 + 一个可复用的 fetch 桩（桩先装、观察后装）。
         *
         * 与存档那边同一个原因：tap 只包住装上那一刻的 `window.fetch`，
         * 之后只能往队列里塞响应，不能换掉 `window.fetch` 本身。
         */
        const openLive = () => {
            const queue: Response[] = [];
            window.fetch = vi.fn(async () =>
                queue.shift() ?? new Response(null, {status: 204})
            ) as unknown as typeof window.fetch;
            const live = createLiveSteps();
            const stop = live.observe();
            /** 推一段事件流，并等它被读完。 */
            const pushEvents = async (chunks: string[], contentType?: string) => {
                queue.push(sseResponse(chunks, contentType));
                await window.fetch(CHAT_URL);
            };
            const pushRaw = async (response: Response) => {
                queue.push(response);
                await window.fetch(CHAT_URL);
            };
            return {live, stop, pushEvents, pushRaw};
        };

        it("bind 之后 thinking / tool_call 归到这张卡片", async () => {
            const {live, stop, pushEvents} = openLive();
            live.bind("card-1");

            await pushEvents([
                sseEvent("thinking", {n: 1}),
                sseEvent("tool_call", {callID: "c1", name: "search", arguments: {query: "q1"}}),
                sseEvent("tool_call", {callID: "c2", name: "block", arguments: {id: "b1"}}),
            ]);
            await waitFor(() => expect(live.stepsOf("card-1")).toHaveLength(1));

            const step = live.stepsOf("card-1")?.[0];
            expect(step?.names).toEqual(["search", "block"]);
            expect(step?.calls.map((call) => call?.id)).toEqual(["c1", "c2"]);
            expect(step?.calls[0]?.arguments).toEqual({query: "q1"});
            stop();
        });

        it("每进入新一轮模型调用就新开一步（与存档的切法一致）", async () => {
            const {live, stop, pushEvents} = openLive();
            live.bind("card-1");

            await pushEvents([
                sseEvent("tool_call", {name: "search"}),
                sseEvent("thinking", {n: 2}),
                sseEvent("tool_call", {name: "block"}),
            ]);
            await waitFor(() => expect(live.stepsOf("card-1")).toHaveLength(2));

            const steps = live.stepsOf("card-1") ?? [];
            expect(steps[0].names).toEqual(["search"]);
            expect(steps[1].names).toEqual(["block"]);
            stop();
        });

        it("插件在一轮中途才启用时，没有步骤就先开一个", async () => {
            // 第一个 thinking 事件已经过去了，工具行却已经在界面上
            const {live, stop, pushEvents} = openLive();
            live.bind("card-1");

            await pushEvents([sseEvent("tool_call", {name: "search"})]);
            await waitFor(() => expect(live.stepsOf("card-1")?.[0].names).toEqual(["search"]));
            stop();
        });

        it("tool_result 换成一份带结果的新对象，不改旧对象", async () => {
            // 界面按调用对象缓存过展示文本，就地改字段会一直读到没有结果的旧文本
            const {live, stop, pushEvents} = openLive();
            live.bind("card-1");

            await pushEvents([sseEvent("tool_call", {callID: "c1", name: "search"})]);
            await waitFor(() => expect(live.stepsOf("card-1")?.[0].calls[0]).toBeDefined());
            const before = live.stepsOf("card-1")![0].calls[0]!;
            expect(before.result).toBeUndefined();

            await pushEvents([sseEvent("tool_result", {callID: "c1", name: "search", result: "done"})]);
            await waitFor(() => expect(live.stepsOf("card-1")?.[0].calls[0]?.result).toBe("done"));

            const after = live.stepsOf("card-1")![0].calls[0]!;
            expect(after).not.toBe(before);
            expect(before.result).toBeUndefined();
            stop();
        });

        it("没有 callID 时按名字认领，同名调用各自只认领一次", async () => {
            const {live, stop, pushEvents} = openLive();
            live.bind("card-1");

            await pushEvents([
                sseEvent("thinking", {}),
                sseEvent("tool_call", {name: "block", arguments: {id: "first"}}),
                sseEvent("tool_call", {name: "block", arguments: {id: "second"}}),
            ]);
            await waitFor(() => expect(live.stepsOf("card-1")?.[0].calls).toHaveLength(2));

            await pushEvents([sseEvent("tool_result", {name: "block", result: "R-second"})]);
            await waitFor(() => expect(live.stepsOf("card-1")?.[0].calls[1]?.result).toBe("R-second"));
            // 从后往前找：第二条先被认领，第一条保持没有结果
            expect(live.stepsOf("card-1")?.[0].calls[0]?.result).toBeUndefined();
            stop();
        });

        it("对不上的 tool_result 不改变索引，也不通知", async () => {
            const {live, stop, pushEvents} = openLive();
            const listener = vi.fn();
            live.subscribe(listener);
            live.bind("card-1");

            await pushEvents([sseEvent("tool_call", {callID: "c1", name: "search"})]);
            await waitFor(() => expect(listener).toHaveBeenCalledTimes(1));

            await pushEvents([
                sseEvent("tool_result", {callID: "nope", name: "other", result: "x"}),
                sseEvent("tool_result", {callID: "c1", name: "search"}),
            ]);
            await settle();
            expect(listener).toHaveBeenCalledTimes(1);
            expect(live.stepsOf("card-1")?.[0].calls[0]?.result).toBeUndefined();
            stop();
        });

        it("结果截到 1024 字符；名字缺失的 tool_call 被丢掉", async () => {
            const {live, stop, pushEvents} = openLive();
            live.bind("card-1");

            await pushEvents([sseEvent("tool_call", {callID: "c1", name: "read"})]);
            await waitFor(() => expect(live.stepsOf("card-1")?.[0].names).toEqual(["read"]));

            await pushEvents([
                sseEvent("tool_call", {callID: "c2"}),
                sseEvent("tool_result", {callID: "c1", name: "read", result: "r".repeat(5000)}),
            ]);
            await waitFor(() => expect(live.stepsOf("card-1")?.[0].calls[0]?.result).toBeDefined());
            expect(live.stepsOf("card-1")?.[0].calls[0]?.result).toHaveLength(1024);
            expect(live.stepsOf("card-1")?.[0].names).toEqual(["read"]);
            stop();
        });

        it("跨 chunk 的事件行能拼回来，坏 JSON 只跳过那一条", async () => {
            // 网络分片不会保证按行切，行缓冲错了就会「偶发丢事件」
            const {live, stop, pushEvents} = openLive();
            live.bind("card-1");

            await pushEvents([
                'event: thinking\ndata: {"n":1}\n\n',
                'event: tool_call\ndata: {"na',
                'me":"search"}\n\n',
                "event: tool_call\ndata: not-json\n\n",
                'event: tool_call\ndata: {"name":"block"}\n\n',
            ]);
            await waitFor(() => expect(live.stepsOf("card-1")?.[0].names).toEqual(["search", "block"]));
            stop();
        });

        it("只读 text/event-stream 且成功的响应", async () => {
            const {live, stop, pushEvents, pushRaw} = openLive();
            const listener = vi.fn();
            live.subscribe(listener);
            live.bind("card-1");

            await pushEvents([sseEvent("tool_call", {name: "search"})], "application/json");
            await settle();
            // bind 会先登记一张空卡片，所以「什么都没读到」的样子是空步骤数组，不是 undefined
            expect(live.stepsOf("card-1")).toEqual([]);

            await pushRaw(new Response(null, {status: 500, headers: {"Content-Type": "text/event-stream"}}));
            await settle();
            expect(live.stepsOf("card-1")).toEqual([]);
            expect(listener).not.toHaveBeenCalled();
            stop();
        });

        it("bind 换卡片时旧卡片的实时数据留在原处，新卡片从空开始", async () => {
            const {live, stop, pushEvents} = openLive();
            live.bind("card-1");
            await pushEvents([sseEvent("tool_call", {name: "search"})]);
            await waitFor(() => expect(live.stepsOf("card-1")?.[0].names).toEqual(["search"]));

            live.bind("card-2");
            expect(live.stepsOf("card-2")).toEqual([]);
            await pushEvents([sseEvent("tool_call", {name: "block"})]);
            await waitFor(() => expect(live.stepsOf("card-2")?.[0].names).toEqual(["block"]));
            // 旧卡片的数据不被新卡片覆盖
            expect(live.stepsOf("card-1")?.[0].names).toEqual(["search"]);
            stop();
        });

        it("同一张卡片重复 bind 不重置它的步骤", async () => {
            const {live, stop, pushEvents} = openLive();
            live.bind("card-1");
            await pushEvents([sseEvent("tool_call", {name: "search"})]);
            await waitFor(() => expect(live.stepsOf("card-1")?.[0].names).toEqual(["search"]));

            live.bind("card-1");
            expect(live.stepsOf("card-1")?.[0].names).toEqual(["search"]);
            stop();
        });

        it("bind 之前收到的事件归到第一张绑定的卡片上", async () => {
            // 界面先画出胶囊、后绑定卡片：这批事件不能丢
            const {live, stop, pushEvents} = openLive();
            await pushEvents([sseEvent("tool_call", {name: "search"})]);
            await settle();

            live.bind("card-1");
            expect(live.stepsOf("card-1")?.[0].names).toEqual(["search"]);
            stop();
        });

        it("卡片上限 200 张，最早的被淘汰", async () => {
            const {live, stop} = openLive();
            // 每次 bind 一张新卡片（bind 同一张才会早退，这里都是不同的 id）
            for (let index = 0; index < 201; index++) {
                live.bind(`card-${index}`);
            }
            expect(live.stepsOf("card-0")).toBeUndefined();
            expect(live.stepsOf("card-1")).toBeDefined();
            stop();
        });

        it("observe 的撤销函数把 fetch 还原", async () => {
            const original = stubFetch(async () => sseResponse([]));
            const live = createLiveSteps();
            const stop = live.observe();
            expect(window.fetch).not.toBe(original);
            stop();
            expect(window.fetch).toBe(original);
        });
    });

    describe("createResponseTap（被动读取响应副本）", () => {
        it("命中的地址读到副本，调用方拿到的还是原始响应", async () => {
            const outer = jsonResponse({code: 0, value: 1});
            const original = stubFetch(async () => outer);
            const read = vi.fn();
            const stop = createResponseTap((url) => url.endsWith("/tapped"), read);

            const returned = await window.fetch("/tapped");
            expect(returned).toBe(outer);
            await waitFor(() => expect(read).toHaveBeenCalledTimes(1));

            const copy = read.mock.calls[0][0] as Response;
            expect(copy).not.toBe(outer);
            // 副本被读走之后，原始响应体仍然归宿主使用
            expect(await returned.json()).toEqual({code: 0, value: 1});
            stop();
            expect(window.fetch).toBe(original);
        });

        it("不命中的地址既不复制也不读", async () => {
            stubFetch(async () => jsonResponse({code: 0}));
            const read = vi.fn();
            const stop = createResponseTap(() => false, read);

            await window.fetch("/elsewhere");
            await settle();
            expect(read).not.toHaveBeenCalled();
            stop();
        });

        it("string / URL / Request 三种入参都能取出地址", async () => {
            stubFetch(async () => jsonResponse({code: 0}));
            const read = vi.fn();
            const stop = createResponseTap((url) => url.endsWith("/t"), read);

            await window.fetch("/base/t");
            await window.fetch(new URL("http://kernel/base/t"));
            await window.fetch({url: "http://kernel/base/t"} as unknown as Request);
            await waitFor(() => expect(read).toHaveBeenCalledTimes(3));
            stop();
        });

        it("请求失败时调用方照旧收到同一个错误，读副本这一路静默放弃", async () => {
            const boom = new Error("boom");
            stubFetch(async () => {
                throw boom;
            });
            const read = vi.fn();
            const stop = createResponseTap(() => true, read);

            await expect(window.fetch("/any")).rejects.toBe(boom);
            await settle();
            expect(read).not.toHaveBeenCalled();
            stop();
        });

        it("读副本抛错不影响调用方", async () => {
            const outer = jsonResponse({code: 0});
            stubFetch(async () => outer);
            const stop = createResponseTap(() => true, () => {
                throw new Error("reader exploded");
            });

            const returned = await window.fetch("/any");
            await settle();
            expect(returned).toBe(outer);
            stop();
        });

        it("撤销时只还原自己装上的那个 fetch，不覆盖期间别人换掉的实现", async () => {
            stubFetch(async () => jsonResponse({code: 0}));
            const stop = createResponseTap(() => false, () => undefined);
            const other = vi.fn(async () => jsonResponse({code: 1}));
            window.fetch = other as unknown as typeof window.fetch;

            stop();
            expect(window.fetch).toBe(other);
        });
    });

    describe("createAnnotator（写进思考卡片）", () => {
        const cardHtml = (id: string, lines: string[][], done = false): string =>
            `<div class="agent-chat__msg--thinking${done ? " agent-chat__msg--thinking-done" : ""}"
                data-message-id="${id}">
                <div class="agent-chat__thinking-body">
                    ${
                lines.map((names) =>
                    `<div class="agent-chat__thinking-tools-line">
                            <span class="agent-chat__thinking-summary">Tool calls:</span>
                            ${names.map((name) => `<span class="agent-chat__thinking-tool">${name}</span>`).join("")}
                        </div>`
                ).join("")
            }
                </div>
            </div>`;

        const fakeLive = (steps?: Record<string, IndexedStep[]>) => {
            const bound: string[] = [];
            const live: LiveSteps = {
                observe: () => () => undefined,
                bind: (cardID: string) => {
                    bound.push(cardID);
                },
                stepsOf: (cardID: string) => steps?.[cardID],
                subscribe: () => () => undefined,
            };
            return {live, bound};
        };

        const chips = (): HTMLElement[] =>
            Array.from(document.querySelectorAll<HTMLElement>(".agent-chat__thinking-tool"));
        const details = (): HTMLElement[] =>
            Array.from(document.querySelectorAll<HTMLElement>(".ss-agent-tool-detail"));

        const step = (names: string[], calls: Array<ToolCallData | undefined>): IndexedStep => ({names, calls});

        it("在胶囊后面插一个摘要节点，胶囊自身的文本一个字符都不改", async () => {
            // 宿主的运行态完全按胶囊的 textContent === 工具名匹配，改了它「运行中」动画就没了
            document.body.innerHTML = cardHtml("c1", [["search"]]);
            const {live} = fakeLive();
            const annotator = createAnnotator({
                stepsOf: () => [step(["search"], [{name: "search", arguments: {query: "思源"}}])],
                live,
                labels: LABELS,
            });
            await settle();

            const chip = chips()[0];
            expect(chip.textContent).toBe("search");
            const detail = chip.nextElementSibling as HTMLElement;
            expect(detail.classList.contains("ss-agent-tool-detail")).toBe(true);
            expect(detail.textContent).toBe("思源");
            expect(chip.getAttribute("title")).toContain("search 思源");
            expect(detail.getAttribute("title")).toBe(chip.getAttribute("title"));
            annotator.destroy();
        });

        it("重复对账是幂等的：同一个节点不重建、文本不重写", async () => {
            document.body.innerHTML = cardHtml("c1", [["search"]]);
            const {live} = fakeLive();
            const steps = [step(["search"], [{name: "search", arguments: {query: "q"}}])];
            const annotator = createAnnotator({stepsOf: () => steps, live, labels: LABELS});
            await settle();

            const detail = details()[0];
            let written = 0;
            const originalSet = Object.getOwnPropertyDescriptor(Node.prototype, "textContent");
            // 用属性写入次数判断「有没有无谓地重写 DOM」：每帧都写会让界面一直重排
            Object.defineProperty(detail, "textContent", {
                configurable: true,
                get: () => originalSet?.get?.call(detail),
                set: (value: string) => {
                    written += 1;
                    originalSet?.set?.call(detail, value);
                },
            });

            annotator.schedule();
            await settle();
            annotator.schedule();
            await settle();

            expect(details()).toHaveLength(1);
            expect(details()[0]).toBe(detail);
            expect(written).toBe(0);
            annotator.destroy();
        });

        it("数据对不上时清掉摘要与 title、不留残影；整份数据读不到时反而保持原样", async () => {
            document.body.innerHTML = cardHtml("c1", [["search"]]);
            const {live} = fakeLive();
            let steps: IndexedStep[] | undefined = [step(["search"], [{name: "search", arguments: {query: "q"}}])];
            const annotator = createAnnotator({stepsOf: () => steps, live, labels: LABELS});
            await settle();
            expect(details()).toHaveLength(1);

            // 存档里的这一步换成了别的工具（原来那次调用被删掉了）：名字对不上任何胶囊，
            // 残影必须清掉，否则界面显示的是「一次并不存在的调用」的参数
            steps = [step(["ghost"], [])];
            annotator.schedule();
            await settle();
            expect(details()).toHaveLength(0);
            expect(chips()[0].hasAttribute("title")).toBe(false);

            // 数据又对得上了：按新内容重写，说明清场之后还能恢复
            steps = [step(["search"], [{name: "search", arguments: {query: "q2"}}])];
            annotator.schedule();
            await settle();
            expect(details()[0].textContent).toBe("q2");

            // 整份数据读不到（这一轮还没写回、条目被淘汰）时相反：卡片保持原样。
            // 读不到 ≠ 数据变了，按空处理会让摘要闪一下，见 annotate.ts 里 reconcile 的注释
            steps = undefined;
            annotator.schedule();
            await settle();
            expect(details()).toHaveLength(1);
            expect(details()[0].textContent).toBe("q2");
            annotator.destroy();
        });

        it("实时渲染把同名的多次调用并成一个胶囊时，把它们合到那个胶囊上", async () => {
            document.body.innerHTML = cardHtml("c1", [["block"]]);
            const {live} = fakeLive();
            const stepOne = step(["block", "block"], [
                {name: "block", arguments: {id: "first"}},
                {name: "block", arguments: {id: "second"}},
            ]);
            const annotator = createAnnotator({stepsOf: () => [stepOne], live, labels: LABELS});
            await settle();

            // 两个调用都并到这个胶囊上：摘要用「 / 」连接并标出 ×2
            expect(details()[0].textContent).toBe("first / second ×2");
            annotator.destroy();
        });

        it("存档里已有条目时优先用存档，实时流只在这张卡片还没写回时顶上", async () => {
            document.body.innerHTML = cardHtml("c1", [["search"]]);
            const {live} = fakeLive({
                c1: [step(["search"], [{name: "search", arguments: {query: "from-live"}}])],
            });
            const annotator = createAnnotator({
                stepsOf: () => [step(["search"], [{name: "search", arguments: {query: "from-archive"}}])],
                live,
                labels: LABELS,
            });
            await settle();

            // 存档是权威数据（带结果），能读到时就不该显示实时流那一份
            expect(details()[0].textContent).toBe("from-archive");
            annotator.destroy();
        });

        it("存档里还没有这个条目时退回实时流", async () => {
            document.body.innerHTML = cardHtml("c1", [["search"]]);
            const {live} = fakeLive({
                c1: [step(["search"], [{name: "search", arguments: {query: "from-live"}}])],
            });
            const annotator = createAnnotator({stepsOf: () => undefined, live, labels: LABELS});
            await settle();

            expect(details()[0].textContent).toBe("from-live");
            annotator.destroy();
        });

        it("读不到数据的卡片保持原样（连 title 都不加）", async () => {
            document.body.innerHTML = cardHtml("c1", [["search"], ["block"]]);
            const {live} = fakeLive();
            const annotator = createAnnotator({stepsOf: () => undefined, live, labels: LABELS});
            await settle();

            expect(details()).toHaveLength(0);
            chips().forEach((chip) => expect(chip.hasAttribute("title")).toBe(false));
            annotator.destroy();
        });

        it("一行里名字对不上存档时整行都不显示（宁可空着，也不显示错位的参数）", async () => {
            // 一条工具行要按名字逐个对上这一步的调用；只要有一个名字对不上，整行就跳过。
            // 部分匹配会把后面的参数挂到错的胶囊上，显示错的参数比不显示更糟
            document.body.innerHTML = cardHtml("c1", [["search", "ghost"]]);
            const {live} = fakeLive();
            const annotator = createAnnotator({
                stepsOf: () => [step(["search", "block"], [
                    {name: "search", arguments: {query: "q"}},
                    {name: "block", arguments: {id: "b"}},
                ])],
                live,
                labels: LABELS,
            });
            await settle();

            expect(details()).toHaveLength(0);
            chips().forEach((chip) => expect(chip.hasAttribute("title")).toBe(false));
            annotator.destroy();
        });

        it("实时渲染把一步拆成多行时按顺序续上，不会从头重复认领", async () => {
            document.body.innerHTML = cardHtml("c1", [["search", "block"], ["block"]]);
            const {live} = fakeLive();
            const annotator = createAnnotator({
                stepsOf: () => [step(["search", "block", "block"], [
                    {name: "search", arguments: {query: "q"}},
                    {name: "block", arguments: {id: "b1"}},
                    {name: "block", arguments: {id: "b2"}},
                ])],
                live,
                labels: LABELS,
            });
            await settle();

            expect(details().map((detail) => detail.textContent)).toEqual(["q", "b1", "b2"]);
            annotator.destroy();
        });

        it("只把最后一张未完成的卡片绑给实时流", async () => {
            document.body.innerHTML = cardHtml("done", [["search"]], true) +
                cardHtml("streaming", [["block"]]);
            const {live, bound} = fakeLive();
            const annotator = createAnnotator({stepsOf: () => undefined, live, labels: LABELS});
            await settle();

            expect(bound).toEqual(["streaming"]);
            annotator.destroy();
        });

        it("卡片全部结束时不绑定任何卡片", async () => {
            document.body.innerHTML = cardHtml("done", [["search"]], true);
            const {live, bound} = fakeLive();
            const annotator = createAnnotator({stepsOf: () => undefined, live, labels: LABELS});
            await settle();

            expect(bound).toEqual([]);
            annotator.destroy();
        });

        it("destroy 清掉全部摘要与 title，并停止观察", async () => {
            document.body.innerHTML = cardHtml("c1", [["search"]]);
            const {live} = fakeLive();
            const annotator = createAnnotator({
                stepsOf: () => [step(["search"], [{name: "search", arguments: {query: "q"}}])],
                live,
                labels: LABELS,
            });
            await settle();
            expect(details()).toHaveLength(1);

            annotator.destroy();
            expect(details()).toHaveLength(0);
            expect(chips()[0].hasAttribute("title")).toBe(false);

            // 观察器已断开：再往 body 里塞卡片也不会重新写摘要
            document.body.insertAdjacentHTML("beforeend", cardHtml("c2", [["search"]]));
            for (let index = 0; index < 4; index++) {
                await new Promise((resolve) => window.requestAnimationFrame(resolve));
            }
            expect(details()).toHaveLength(0);
        });
    });

    describe("mountAgentToolCallDetail（装配）", () => {
        const cardHtml = (id: string, names: string[]): string =>
            `<div class="agent-chat__msg--thinking" data-message-id="${id}">
                <div class="agent-chat__thinking-body">
                    <div class="agent-chat__thinking-tools-line">
                        <span class="agent-chat__thinking-summary">Tool calls:</span>
                        ${names.map((name) => `<span class="agent-chat__thinking-tool">${name}</span>`).join("")}
                    </div>
                </div>
            </div>`;

        it("注入把工具行排成两列网格的 CSS", () => {
            const harness = mountFeature(definition);

            expect(harness.records.styles).toHaveLength(1);
            expect(harness.css()).toContain("grid-template-columns: auto minmax(0, 1fr)");
            expect(harness.css()).toContain(
                ".agent-chat__thinking-body > .agent-chat__thinking-tools-line > .ss-agent-tool-detail",
            );
            expect(harness.styleElement()).not.toBeNull();
            // 摘要用正文色、单行省略：参数再长也只占这一行
            expect(harness.css()).toContain("text-overflow: ellipsis");
            expect(DETAIL_CSS).toBe(harness.css());

            harness.dispose();
            expect(harness.styleElement()).toBeNull();
        });

        it("会话存档回来后把摘要补到已渲染的卡片上", async () => {
            // 桩必须先装：tap 只包住装上那一刻的 window.fetch（见 tap.ts）
            stubFetch(async () =>
                jsonResponse({
                    code: 0,
                    data: {
                        entries: [
                            {type: "assistant", toolCalls: [{id: "c1", name: "search", arguments: {query: "思源"}}]},
                            {type: "thinking", id: "m1", steps: [{toolNames: ["search"], toolCallIDs: ["c1"]}]},
                        ],
                    },
                })
            );
            const harness = mountFeature(definition);
            document.body.insertAdjacentHTML("beforeend", cardHtml("m1", ["search"]));

            await window.fetch(GET_SESSION_URL);
            await settle();

            const detail = document.querySelector(".ss-agent-tool-detail");
            expect(detail?.textContent).toBe("思源");
            harness.dispose();
        });

        it("实时流先给出参数，不必等这一轮写回存档", async () => {
            // 同上：桩先装，mount 时才会把它包进观察层
            stubFetch(async () =>
                sseResponse([
                    sseEvent("thinking", {n: 1}),
                    sseEvent("tool_call", {callID: "c1", name: "search", arguments: {query: "实时"}}),
                ])
            );
            const harness = mountFeature(definition);
            document.body.insertAdjacentHTML("beforeend", cardHtml("m1", ["search"]));

            await window.fetch(CHAT_URL);
            await settle();

            expect(document.querySelector(".ss-agent-tool-detail")?.textContent).toBe("实时");
            harness.dispose();
        });

        it("卸载后两路观察都放开、DOM 里不留摘要", async () => {
            const original = stubFetch(async () => jsonResponse({code: 0}));
            const harness = mountFeature(definition);
            document.body.insertAdjacentHTML("beforeend", cardHtml("m1", ["search"]));
            expect(window.fetch).not.toBe(original);

            harness.dispose();

            expect(window.fetch).toBe(original);
            expect(document.querySelectorAll(".ss-agent-tool-detail")).toHaveLength(0);
            expect(document.querySelector(".agent-chat__thinking-tool")?.hasAttribute("title")).toBe(false);
        });

        it("声明：默认关闭、分类为 ai、只有一个开关", () => {
            expect(definition.id).toBe("agent-tool-call-detail");
            expect(definition.category).toBe("ai");
            expect(definition.enabled).toBe(true);
            expect(definition.settings).toEqual([
                {kind: "switch", key: "enabled", title: "common.enabled", default: false},
            ]);
        });
    });
});
