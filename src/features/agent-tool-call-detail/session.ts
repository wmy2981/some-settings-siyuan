/**
 * 会话存档的被动读取与索引。
 *
 * 界面上工具行只有工具名（胶囊里就是 `block`、`search` 这样的裸名字），参数与结果虽然
 * 都随会话一起存下来了，但没有任何插件 API 能把它们拿出来。所以这里守在 `fetch` 上：
 * 智能体面板本来就会请求 `/api/ai/agent/getSession`（切换 / 载入会话）和
 * `/api/ai/agent/saveSession`（把这一轮写回存档），响应体里就是完整会话 ——
 * 我们不额外发请求，只是在旁边把已经回来的那一份读一遍。
 *
 * 读的是响应的副本（见 `tap.ts`）：原始响应留给宿主自己消费，读副本失败（例如请求被取消、
 * 响应不是 JSON）就直接放弃这一次，宿主的行为一点都不受影响。
 *
 * 存档是权威数据，但**滞后**：这一轮要到写回时才出现在这里。工具一开始执行就能看到的细节
 * 走实时流（`live.ts`），两者在 `annotate.ts` 里合起来用。
 *
 * 索引结构对应界面上的两张表：
 * - 思考条目（界面上那张思考卡片，靠 `data-message-id` 对上）→ 它的各步；
 * - 会话里全部工具调用，按调用 ID 索引（思考步骤只记了 ID 或工具名，参数与结果
 *   存在 assistant 条目里）。
 *
 * 部分模型不给调用 ID，那时步骤里只有工具名，按会话内的顺序取同名的下一个来兜底。
 * 兜底也可能对不上（例如同一个工具在同一轮里被删掉一次），所以调用方拿到数据后
 * 还要按工具名核一遍，对不上就不显示，而不是显示错的。
 */
import type {ToolCallData} from "./summary";
import {createResponseTap} from "./tap";

/** 思考条目的一步：界面上就是一条「Tool calls:」行。 */
export type IndexedStep = {
    /** 工具名，与这一行的胶囊同序（同名重复时会出现多次）。 */
    names: string[];
    /** 同序的调用数据；定位不到具体调用时是 undefined。 */
    calls: Array<ToolCallData | undefined>;
};

export type SessionIndex = {
    /** 装上被动观察，返回撤销函数。 */
    observe(): () => void;
    /** 某个思考条目（界面上的思考卡片）的各步。 */
    stepsOf(entryID: string): IndexedStep[] | undefined;
    /** 索引变化（会话载入 / 写回）时回调，返回退订函数。 */
    subscribe(listener: () => void): () => void;
};

const GET_SESSION = "/api/ai/agent/getSession";
const SAVE_SESSION = "/api/ai/agent/saveSession";
const isSessionURL = (url: string): boolean => url.endsWith(GET_SESSION) || url.endsWith(SAVE_SESSION);
/** 缓存条目上限：够覆盖最近几个会话，又不会因为长期开着面板一直涨。 */
const MAX_ENTRIES = 2000;
/** 每次调用的结果最多留多少字符：界面上只看开头一段，长尾没有用处。 */
const RESULT_KEEP = 1024;

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const readToolCall = (raw: unknown): ToolCallData | undefined => {
    if (!isRecord(raw) || typeof raw.name !== "string" || !raw.name) {
        return undefined;
    }
    return {
        id: typeof raw.id === "string" && raw.id ? raw.id : undefined,
        name: raw.name,
        arguments: isRecord(raw.arguments) ? raw.arguments : undefined,
        // 结果在界面上只显示开头一段（见 summary.ts 的 RESULT_LIMIT），这里先砍掉长尾：
        // 读文档、搜索这类调用的返回值动辄几十 KB，全留在内存里没有任何用处。
        result: typeof raw.result === "string" && raw.result ? raw.result.slice(0, RESULT_KEEP) : undefined,
    };
};

/**
 * 把一步里的工具名对上具体调用。
 *
 * 首选按调用 ID 对齐（当前版本的思源会给每个调用发 ID）；ID 缺一个就对不齐，
 * 那时按名字从这次会话的调用队列里取下一个没被认领的。
 */
const buildStep = (
    raw: unknown,
    callsByID: Map<string, ToolCallData>,
    callsByName: Map<string, ToolCallData[]>,
    claimed: Set<ToolCallData>,
    cursors: Map<string, number>,
): IndexedStep => {
    const step = isRecord(raw) ? raw : {};
    const names = Array.isArray(step.toolNames) ?
        step.toolNames.filter((name): name is string => typeof name === "string" && !!name) :
        [];
    const ids = Array.isArray(step.toolCallIDs) ? step.toolCallIDs : [];
    const aligned = ids.length === names.length;
    const calls = names.map((name, index) => {
        const byID = aligned ? callsByID.get(String(ids[index])) : undefined;
        if (byID) {
            claimed.add(byID);
            return byID;
        }
        const queue = callsByName.get(name);
        if (!queue) {
            return undefined;
        }
        for (let i = cursors.get(name) ?? 0; i < queue.length; i++) {
            if (claimed.has(queue[i])) {
                continue;
            }
            cursors.set(name, i + 1);
            claimed.add(queue[i]);
            return queue[i];
        }
        return undefined;
    });
    return {names, calls};
};

/** 读一份会话存档，产出「思考条目 → 各步」的索引。 */
const buildEntries = (session: unknown): Map<string, IndexedStep[]> => {
    const entries = isRecord(session) && Array.isArray(session.entries) ? session.entries : [];
    const callsByID = new Map<string, ToolCallData>();
    const callsByName = new Map<string, ToolCallData[]>();
    for (const entry of entries) {
        const toolCalls = isRecord(entry) && Array.isArray(entry.toolCalls) ? entry.toolCalls : [];
        for (const raw of toolCalls) {
            const call = readToolCall(raw);
            if (!call) {
                continue;
            }
            if (call.id) {
                callsByID.set(call.id, call);
            }
            const queue = callsByName.get(call.name);
            if (queue) {
                queue.push(call);
            } else {
                callsByName.set(call.name, [call]);
            }
        }
    }

    const result = new Map<string, IndexedStep[]>();
    const claimed = new Set<ToolCallData>();
    const cursors = new Map<string, number>();
    for (const entry of entries) {
        if (!isRecord(entry) || entry.type !== "thinking" || typeof entry.id !== "string" || !entry.id) {
            continue;
        }
        const steps = Array.isArray(entry.steps) ? entry.steps : [];
        result.set(entry.id, steps.map((step) => buildStep(step, callsByID, callsByName, claimed, cursors)));
    }
    return result;
};

/**
 * 从一次响应里取出会话。
 *
 * `getSession` 的 `data` 就是会话本身，`saveSession` 的 `data` 是 `{revision, session}`，
 * 两个都认。
 */
const sessionOf = (payload: unknown): unknown => {
    if (!isRecord(payload) || payload.code !== 0 || !isRecord(payload.data)) {
        return undefined;
    }
    return isRecord(payload.data.session) ? payload.data.session : payload.data;
};

export const createSessionIndex = (): SessionIndex => {
    /** 思考条目 id → 各步。条目 id 由思源生成，跨会话唯一，所以可以合成一张表。 */
    const entries = new Map<string, IndexedStep[]>();
    const listeners = new Set<() => void>();

    const notify = () => listeners.forEach((listener) => listener());

    const remember = (session: unknown) => {
        const built = buildEntries(session);
        if (built.size === 0) {
            return;
        }
        built.forEach((steps, entryID) => {
            // 先删再写：Map 的插入顺序就是淘汰顺序，重新写入让它回到最新一端。
            entries.delete(entryID);
            entries.set(entryID, steps);
        });
        while (entries.size > MAX_ENTRIES) {
            const oldest = entries.keys().next();
            if (oldest.done) {
                break;
            }
            entries.delete(oldest.value);
        }
        // 存档可能在同一个回合里被写回多次（每一步都在长），交给调用方重扫一遍。
        notify();
    };

    /** `readResponse` 拿到的是响应副本（见 `tap.ts`），直接读它自己就行。 */
    const readResponse = (response: Response) => {
        if (!response.ok || (response.headers.get("Content-Type") || "").indexOf("application/json") < 0) {
            return;
        }
        void response.json().then((payload) => {
            const session = sessionOf(payload);
            if (session !== undefined) {
                remember(session);
            }
        }).catch(() => {
            // 请求被取消或响应不是合法 JSON：放弃这一次，宿主的行为不受影响
        });
    };

    return {
        observe: () => createResponseTap(isSessionURL, readResponse),
        stepsOf: (entryID) => entries.get(entryID),
        subscribe: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
};
