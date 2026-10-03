/**
 * 界面：把工具调用的细节写进思考卡片的工具行。
 *
 * 思源渲染的胶囊只有工具名（`<span class="agent-chat__thinking-tool">search</span>`），
 * 一行「Tool calls: search block block …」看不出到底查了什么、动了哪个块。
 * 这里在**胶囊后面**插一个自己创建的兄弟节点放摘要，并把完整信息挂到 `title` 上。
 *
 * 为什么不动胶囊本身：宿主的运行态完全是按 `textContent === 工具名` 找胶囊的
 * （工具跑起来时它给胶囊加 `--running` 类），往胶囊里塞文字会让这个匹配失效，
 * 把「运行中」的省略号动画弄丢。所以这里只读胶囊的文本，不写它。
 *
 * 工具行可能被宿主反复重建（重载会话、新一步追加），所以对账做成幂等的：
 * 每次重扫都从数据重新算一遍，写之前先比对 DOM 现状，没有变化就不碰。
 * 已经写过、这次算不出来的胶囊（例如工具被删掉了一次）会被清干净，不留残影。
 */
import type {IndexedStep} from "./session";
import {
    describeToolCall,
    mergeInline,
    mergeTooltip,
} from "./summary";
import type {
    ToolCallData,
    ToolCallLabels,
    ToolCallView,
} from "./summary";

/** 摘要节点的类名；插件卸载时按它清场。 */
const DETAIL_CLASS = "ss-agent-tool-detail";
/** 思考卡片（`data-message-id` 是思考条目的 id，靠它去会话存档里找工具调用）。 */
const CARD_SELECTOR = ".agent-chat__msg--thinking[data-message-id]";
const LINE_SELECTOR = ".agent-chat__thinking-tools-line";
const CHIP_SELECTOR = ".agent-chat__thinking-tool";

/**
 * 摘要紧跟在胶囊后面，两者之间只留 2px，而工具行本身的间距是 8px ——
 * 用负外边距把这一对粘成一个整体，读者一眼能看出摘要属于哪个工具。
 * 宽度上限 + 省略号保证再长的参数也只占一行，不会把窄面板撑出横向滚动条。
 */
const CSS = `/* 思考卡片里工具调用的参数摘要 */
.${DETAIL_CLASS} {
    margin-left: -6px;
    max-width: 22em;
    min-width: 0;
    overflow: hidden;
    font-size: 12px;
    color: var(--b3-theme-on-surface-light);
    opacity: .85;
    white-space: nowrap;
    text-overflow: ellipsis;
}
`;

/** 一张卡片里一步的对账状态。 */
type StepState = {
    names: string[];
    calls: Array<ToolCallData | undefined>;
    /** 这一步里哪些位置已经被某个胶囊取走。 */
    used: boolean[];
    /** 位置 → 取走它的胶囊，用于把同名重复调用并到同一个胶囊上。 */
    owner: Map<number, HTMLElement>;
};

export type Annotator = {
    schedule(): void;
    destroy(): void;
};

const chipName = (chip: HTMLElement): string => (chip.textContent ?? "").trim();

/** 这一步里第 index 个位置的工具名。 */
const nameAt = (step: StepState, index: number): string => step.calls[index]?.name ?? step.names[index] ?? "";

/**
 * 这一步能不能按顺序满足这一行的工具名。
 *
 * 只试算、不改状态：能就返回位置列表，不能就返回 undefined。
 * 按名字（而不是按下标）对齐，是因为宿主在**实时渲染**时会把一步里同名的多次调用
 * 去重成一个胶囊，落盘后重新渲染时又会把它们全画出来 —— 按名字对齐两种渲染都对得上。
 */
const planOf = (step: StepState, names: string[]): number[] | undefined => {
    const plan: number[] = [];
    const taken = new Set<number>();
    for (const name of names) {
        let found = -1;
        for (let i = 0; i < step.names.length; i++) {
            if (step.used[i] || taken.has(i) || nameAt(step, i) !== name) {
                continue;
            }
            found = i;
            break;
        }
        if (found < 0) {
            return undefined;
        }
        taken.add(found);
        plan.push(found);
    }
    return plan;
};

const addCall = (assigned: Map<HTMLElement, ToolCallData[]>, chip: HTMLElement, call: ToolCallData) => {
    const calls = assigned.get(chip);
    if (calls) {
        calls.push(call);
    } else {
        assigned.set(chip, [call]);
    }
};

/** 取一次调用的展示文本。 */
type Describer = (call: ToolCallData) => ToolCallView;

/** 按数据算出每个胶囊该显示哪些调用，然后写进 DOM。 */
const annotateCard = (card: HTMLElement, steps: IndexedStep[], describe: Describer) => {
    const lines = Array.from(card.querySelectorAll<HTMLElement>(LINE_SELECTOR));
    const chips = Array.from(card.querySelectorAll<HTMLElement>(CHIP_SELECTOR));
    if (lines.length === 0 || chips.length === 0) {
        return;
    }
    const states: StepState[] = steps.map((step) => ({
        names: step.names,
        calls: step.calls,
        used: step.names.map(() => false),
        owner: new Map(),
    }));

    const assigned = new Map<HTMLElement, ToolCallData[]>();
    let cursor = 0;
    for (const line of lines) {
        const lineChips = Array.from(line.querySelectorAll<HTMLElement>(CHIP_SELECTOR));
        const names = lineChips.map(chipName);
        if (names.length === 0 || names.some((name) => !name)) {
            continue;
        }
        // 先试当前的步：实时渲染会把一步的工具行拆成好几行，能续上就续上
        let target = -1;
        let plan: number[] | undefined;
        for (let index = cursor; index < states.length; index++) {
            plan = planOf(states[index], names);
            if (plan) {
                target = index;
                break;
            }
        }
        if (!plan || target < 0) {
            continue;
        }
        plan.forEach((position, order) => {
            const call = states[target].calls[position];
            states[target].used[position] = true;
            // 定位不到具体调用（存档里名字与调用对不上）时不登记：那个胶囊宁可什么都不显示
            if (call) {
                states[target].owner.set(position, lineChips[order]);
                addCall(assigned, lineChips[order], call);
            }
        });
        cursor = target;
    }

    // 一步里同名的多次调用在实时渲染时只剩一个胶囊，把没分配出去的并到它上面
    states.forEach((step) => {
        step.names.forEach((_name, index) => {
            const call = step.calls[index];
            if (step.used[index] || !call) {
                return;
            }
            const name = nameAt(step, index);
            for (let i = 0; i < step.names.length; i++) {
                if (!step.used[i] || nameAt(step, i) !== name) {
                    continue;
                }
                const chip = step.owner.get(i);
                if (chip) {
                    addCall(assigned, chip, call);
                }
                return;
            }
        });
    });

    chips.forEach((chip) => {
        const calls = assigned.get(chip);
        if (!calls || calls.length === 0) {
            clearChip(chip);
            return;
        }
        const views = calls.map((call) => describe(call));
        writeChip(chip, mergeInline(views), mergeTooltip(views));
    });
};

/** 取出胶囊后面那个属于本插件的摘要节点（没有就是 undefined）。 */
const detailOf = (chip: HTMLElement): HTMLElement | undefined => {
    const next = chip.nextElementSibling;
    return next instanceof HTMLElement && next.classList.contains(DETAIL_CLASS) ? next : undefined;
};

/** 幂等写入：只在内容真的变了时才动 DOM。 */
const writeChip = (chip: HTMLElement, inline: string, tooltip: string) => {
    let detail = detailOf(chip);
    if (inline) {
        if (!detail) {
            detail = document.createElement("span");
            detail.className = DETAIL_CLASS;
            chip.after(detail);
        }
    } else if (detail) {
        detail.remove();
        detail = undefined;
    }
    if (detail && detail.textContent !== inline) {
        detail.textContent = inline;
    }
    [chip, detail].forEach((element) => {
        if (!element) {
            return;
        }
        if (tooltip) {
            if (element.title !== tooltip) {
                element.title = tooltip;
            }
        } else if (element.hasAttribute("title")) {
            element.removeAttribute("title");
        }
    });
};

const clearChip = (chip: HTMLElement) => writeChip(chip, "", "");

export const createAnnotator = (options: {
    stepsOf: (entryID: string) => IndexedStep[] | undefined;
    labels: ToolCallLabels;
}): Annotator => {
    let frame = 0;
    let observer: MutationObserver | undefined;
    /**
     * 调用对象 → 展示文本。
     *
     * 对账在流式期间每帧都会跑一遍，而同一份存档只在写回时才换成新对象，
     * 所以按对象缓存一次就够：不缓存的话每帧都要把每个调用的参数重新 JSON 序列化。
     */
    const views = new WeakMap<ToolCallData, ToolCallView>();
    const describe: Describer = (call) => {
        const cached = views.get(call);
        if (cached) {
            return cached;
        }
        const view = describeToolCall(call, options.labels);
        views.set(call, view);
        return view;
    };

    const observe = () => {
        observer = observer ?? new MutationObserver(() => schedule());
        observer.observe(document.body, {childList: true, subtree: true});
    };
    const unobserve = () => observer?.disconnect();

    /**
     * 对账一遍当前界面上的所有思考卡片。
     *
     * 写入期间先断开观察器（本仓库的既有约定）：我们插入的摘要节点本身就是子节点变动，
     * 不断开就会让观察器自己再触发一次；虽然那一遍算下来没有变化、不会无限循环，
     * 但也没必要跑。
     */
    const reconcile = () => {
        const cards = Array.from(document.querySelectorAll<HTMLElement>(CARD_SELECTOR));
        if (cards.length === 0) {
            return;
        }
        unobserve();
        try {
            cards.forEach((card) => {
                const steps = card.dataset.messageId ? options.stepsOf(card.dataset.messageId) : undefined;
                // 拿不到存档的卡片保持原样：思源自己的工具名还在，不该因为我们读不到数据就变样
                if (steps && steps.length > 0) {
                    annotateCard(card, steps, describe);
                }
            });
        } finally {
            observe();
        }
    };

    const schedule = () => {
        if (frame) {
            return;
        }
        frame = window.requestAnimationFrame(() => {
            frame = 0;
            reconcile();
        });
    };

    observe();
    schedule();

    return {
        schedule,
        destroy: () => {
            if (frame) {
                window.cancelAnimationFrame(frame);
                frame = 0;
            }
            unobserve();
            document.querySelectorAll<HTMLElement>(`.${DETAIL_CLASS}`).forEach((detail) => detail.remove());
            document.querySelectorAll<HTMLElement>(CHIP_SELECTOR).forEach(clearChip);
        },
    };
};

export const DETAIL_CSS = CSS;
