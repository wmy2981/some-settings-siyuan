/**
 * 一轮对话的实时流（SSE）的被动读取。
 *
 * 「工具调用细节」有两个数据来源：会话存档（`session.ts`，权威但要等这一轮写回）与这里的实时流。
 * 智能体面板跑一轮对话走的是 `POST /api/ai/agent/chat` 的事件流，而内核在**工具执行之前**
 * 就把这一批调用的名字与参数一次性发出来（`tool_call`），执行完再发 `tool_result`。
 * 界面上的胶囊在收到 `tool_call` 的那一刻就画出来了，所以跟着这条流读一遍，参数就能跟胶囊同时出现，
 * 不必等到这一轮结束。结果稍后补上，存档回来之后整份数据由存档接管（见 `annotate.ts`）。
 *
 * 读的是 `response.clone()`：原始响应整个留给宿主自己消费，我们只是把同一份字节再解析一遍，
 * 不额外发请求，也不改动宿主的任何行为。只解析关心的事件，正文 token 那几类连 JSON 都不碰。
 *
 * 步骤的切法与存档完全一致：内核每进入新一轮模型调用就发一个 `thinking`，这一轮里的调用都算它的一步
 * （存档那边也是这么切的，见宿主的 `collectCurrentThinkingStep`），所以同一张卡片上
 * 「界面上的工具行」与这里的步骤一一对得上。
 */
import type {IndexedStep} from "./session";
import type {ToolCallData} from "./summary";
import {createResponseTap} from "./tap";

/** 一轮对话的事件流。 */
const CHAT = "/api/ai/agent/chat";
/** 只关心这三类事件，其余（正文 token、用量、快照…）与工具细节无关。 */
const WANTED = new Set(["thinking", "tool_call", "tool_result"]);
/** 结果最多留多少字符：与存档那边口径一致，界面上只看开头一段。 */
const RESULT_KEEP = 1024;
/** 保留多少张卡片的实时数据：够覆盖最近几次对话，又不会因为长期开着面板一直涨。 */
const MAX_CARDS = 200;

export type LiveSteps = {
    /** 装上被动观察，返回撤销函数。 */
    observe(): () => void;
    /**
     * 告诉索引界面上正在流式的是哪张思考卡片（`data-message-id`）。
     *
     * 卡片切走了就从零开始记：上一张卡片该显示的细节早就画在界面上了，它的实时数据没有别的用处。
     */
    bind(cardID: string): void;
    /** 某张卡片到目前为止的步骤；没跟着读过就是 undefined。 */
    stepsOf(cardID: string): IndexedStep[] | undefined;
    /** 读到新事件时回调，返回退订函数。 */
    subscribe(listener: () => void): () => void;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

/** 读一次 `tool_call`：名字必需，参数与结果按存档那边的口径裁剪。 */
const readCall = (data: Record<string, unknown>): ToolCallData | undefined => {
    if (typeof data.name !== "string" || !data.name) {
        return undefined;
    }
    return {
        id: typeof data.callID === "string" && data.callID ? data.callID : undefined,
        name: data.name,
        arguments: isRecord(data.arguments) ? data.arguments : undefined,
    };
};

/**
 * 把一份事件流读完。
 *
 * 与宿主的读法一致：`event:` 记下事件名，随后的 `data:` 才是载荷（内核每条事件都只写一行 data）。
 * 不是合法 JSON 的那一条直接跳过，后面的照读。
 */
const readStream = async (response: Response, handle: (event: string, data: Record<string, unknown>) => boolean) => {
    const reader = response.body?.getReader();
    if (!reader) {
        return;
    }
    const decoder = new TextDecoder();
    let buffer = "";
    let current = "";
    for (;;) {
        const chunk = await reader.read();
        if (chunk.done) {
            break;
        }
        buffer += decoder.decode(chunk.value, {stream: true});
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
            if (line.startsWith("event:")) {
                current = line.slice(6).trim();
                continue;
            }
            if (!line.startsWith("data:")) {
                continue;
            }
            const event = current;
            current = "";
            if (!WANTED.has(event)) {
                continue;
            }
            try {
                handle(event, JSON.parse(line.slice(5).trim()) as Record<string, unknown>);
            } catch {
                // 这一条读不出来就跳过，不影响后面的事件
            }
        }
    }
};

export const createLiveSteps = (): LiveSteps => {
    /** 卡片 id → 它的步骤。 */
    const cards = new Map<string, IndexedStep[]>();
    /** 当前绑定的卡片；为空表示还没绑定，此时收到的步骤归下一张绑定的卡片。 */
    let boundID = "";
    let steps: IndexedStep[] = [];
    const listeners = new Set<() => void>();

    const notify = () => listeners.forEach((listener) => listener());

    const bind = (cardID: string) => {
        if (cardID === boundID) {
            return;
        }
        if (boundID !== "") {
            // 换卡片：能复用的只有这张卡片之前留下的那一份（正常情况下没有）
            steps = cards.get(cardID) ?? [];
        }
        boundID = cardID;
        cards.set(cardID, steps);
        while (cards.size > MAX_CARDS) {
            const oldest = cards.keys().next();
            if (oldest.done || oldest.value === boundID) {
                break;
            }
            cards.delete(oldest.value);
        }
    };

    /**
     * 取当前这一步。
     *
     * 插件在一轮对话中途才被启用时，前面那个 `thinking` 事件已经过去了，所以没有步骤就现开一个。
     */
    const currentStep = (): IndexedStep => {
        let step = steps[steps.length - 1];
        if (!step) {
            step = {names: [], calls: []};
            steps.push(step);
        }
        return step;
    };

    /**
     * 结果回来时把那个调用换成一份带结果的**副本**。
     *
     * 界面那边按调用对象缓存过一次展示文本（见 `annotate.ts`），就地改字段会一直读到没有结果的旧文本，
     * 所以这里换对象而不是改对象。同一个调用只会被认领一次，所以按 id（没有 id 就按名字）从后往前找。
     */
    const attachResult = (data: Record<string, unknown>, result: string) => {
        const id = typeof data.callID === "string" ? data.callID : "";
        const name = typeof data.name === "string" ? data.name : "";
        const groups = [steps];
        cards.forEach((value) => {
            if (value !== steps) {
                groups.push(value);
            }
        });
        for (const group of groups) {
            for (let s = group.length - 1; s >= 0; s--) {
                const calls = group[s].calls;
                for (let i = calls.length - 1; i >= 0; i--) {
                    const call = calls[i];
                    if (!call || call.result !== undefined) {
                        continue;
                    }
                    if (id ? call.id !== id : call.name !== name) {
                        continue;
                    }
                    calls[i] = {...call, result};
                    return true;
                }
            }
        }
        return false;
    };

    /** 处理一条关心的事件；返回 true 表示索引变了。 */
    const handle = (event: string, data: Record<string, unknown>): boolean => {
        if (event === "thinking") {
            // 内核每进入新一轮模型调用就发一个 thinking，与存档那边「一步」的切法一致
            steps.push({names: [], calls: []});
            return true;
        }
        if (event === "tool_call") {
            const call = readCall(data);
            if (!call) {
                return false;
            }
            const step = currentStep();
            step.names.push(call.name);
            step.calls.push(call);
            return true;
        }
        const result = typeof data.result === "string" ? data.result.slice(0, RESULT_KEEP) : "";
        return result ? attachResult(data, result) : false;
    };

    return {
        observe: () =>
            createResponseTap((url) => url.endsWith(CHAT), (response) => {
                if (!response.ok || (response.headers.get("Content-Type") || "").indexOf("text/event-stream") < 0) {
                    return;
                }
                const changed = (event: string, data: Record<string, unknown>) => {
                    const touched = handle(event, data);
                    if (touched) {
                        notify();
                    }
                    return touched;
                };
                void readStream(response, changed).catch(() => {
                    // 这一轮被中止（用户点了停止、切换了会话）就安静收场，宿主那边自己会收尾
                });
            }),
        bind,
        stepsOf: (cardID) => cards.get(cardID),
        subscribe: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
};
