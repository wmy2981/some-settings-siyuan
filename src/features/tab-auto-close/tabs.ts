/**
 * 「自动收起闲置页签」的运行时。
 *
 * 只做三件事：采集页签、按 `policy.ts` 的规则判定、调用宿主自己的关闭入口。
 * 关闭走的是原生路径——桌面端点页签上的关闭按钮，移动端调页签模型的 `close()`，
 * 因此「保存排版、更新最近关闭时间、钉住的页签不参与」这些行为全部照宿主自己的逻辑走，
 * 本功能不复制一份，也不用改动宿主 DOM 结构。
 *
 * 判定用的「最后一次活动」有两个来源，取较晚的那个：
 * - 宿主的 `data-activetime`（页签被切到前台的时间，见 `app/src/layout/util.ts`）；
 *   它只在切换时刷新，光靠它会把「一直开着、一直在写」的页签当成闲置，所以还要——
 * - 本功能自己记的活动时间：指针、键盘、滚轮、输入事件落在哪个页签的面板里，就刷新哪个。
 */
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";
import type {IdleTabCandidate} from "./policy";
import {
    parseKeywords,
    pickIdleTabs,
} from "./policy";

/** 扫描间隔：一分钟级的阈值下，15 秒一次的精度足够，也不至于让定时器显得多余。 */
const SCAN_INTERVAL_MS = 15_000;

/** 一轮最多收几个：宿主每关一个页签都会存一次排版，一次收一屏会明显卡一下。 */
const MAX_CLOSES_PER_ROUND = 5;

/** 计入「正在用」的输入事件。 */
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "input", "wheel", "touchstart"] as const;

/** 活动时间表：页签 id -> 最近一次活动的时间戳。 */
type ActivityTable = Map<string, number>;

interface MobileTabLike {
    id: string;
    activeAt?: number;
    pin?: boolean;
    current?: {
        title?: string;
        rootID?: string;
    };
}

interface MobileTabsLike {
    state?: {
        activeTabID?: string;
        tabs?: MobileTabLike[];
    };
    close?: (tabID: string) => Promise<void> | void;
}

const minutesOf = (value: unknown): number => {
    const minutes = Number(value);
    if (!Number.isFinite(minutes)) {
        return 5;
    }
    return Math.min(240, Math.max(1, Math.round(minutes)));
};

/** 移动端页签模型（`window.siyuan.mobile.tabs`）；桌面端没有这个对象。 */
const mobileTabs = (): MobileTabsLike | undefined => {
    const siyuan = (window as unknown as {
        siyuan?: {
            mobile?: {
                tabs?: MobileTabsLike;
            };
        };
    }).siyuan;
    return siyuan?.mobile?.tabs;
};

/** 采集桌面端所有分屏里的页签。 */
const desktopCandidates = (activity: ActivityTable): IdleTabCandidate[] => {
    const candidates: IdleTabCandidate[] = [];
    document.querySelectorAll<HTMLElement>('[data-type="wnd"]').forEach((wnd) => {
        const bar = wnd.querySelector<HTMLElement>("ul.layout-tab-bar:not(.layout-tab-bar--readonly)");
        const container = wnd.querySelector<HTMLElement>(".layout-tab-container");
        if (!bar || !container) {
            // 左/右/下侧栏的 wnd 没有页签栏或页签容器，直接跳过
            return;
        }
        const headers = Array.from(bar.children).filter((item): item is HTMLElement =>
            item instanceof HTMLElement && item.matches('li.item[data-type="tab-header"]')
        );
        headers.forEach((header) => {
            const id = header.dataset.id;
            if (!id) {
                return;
            }
            const panel = Array.from(container.children).find((item) =>
                item instanceof HTMLElement && item.dataset.id === id
            ) as HTMLElement | undefined;
            candidates.push({
                id,
                title: header.querySelector(".item__text")?.textContent?.trim() ?? "",
                active: header.classList.contains("item--focus"),
                pinned: header.classList.contains("item--pin"),
                siblings: headers.length,
                lastActive: Math.max(Number(header.dataset.activetime) || 0, activity.get(id) ?? 0),
                closeable: Boolean(panel),
            });
        });
    });
    return candidates;
};

/** 采集移动端页签模型里的页签。 */
const mobileCandidates = (activity: ActivityTable): IdleTabCandidate[] => {
    const tabs = mobileTabs()?.state?.tabs;
    if (!Array.isArray(tabs)) {
        return [];
    }
    return tabs.map((tab) => ({
        id: tab.id,
        title: tab.current?.title ?? "",
        active: tab.id === mobileTabs()?.state?.activeTabID,
        pinned: Boolean(tab.pin),
        siblings: tabs.length,
        lastActive: Math.max(Number(tab.activeAt) || 0, activity.get(tab.id) ?? 0),
        closeable: Boolean(tab.current?.rootID),
    }));
};

/** 用宿主自己的关闭按钮关掉一个桌面端页签；找不到该页签或按钮时返回 null。 */
const requestDesktopClose = (id: string): HTMLElement | null => {
    const header = Array.from(document.querySelectorAll<HTMLElement>('li.item[data-type="tab-header"]'))
        .find((item) => item.dataset.id === id);
    const closeButton = header?.querySelector<HTMLElement>(".item__close");
    if (!header || !closeButton) {
        return null;
    }
    closeButton.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true}));
    return header;
};

/**
 * 宿主关页签带一次过渡动画：点完按钮的同一帧里节点还在，要等动画结束才判断它到底关没关。
 *
 * 这段等待也是「关成功没有」的唯一依据：数一数请求过的页签里还有几个留在文档里，
 * 剩下的算没关成（宿主有自己的保留规则），不去猜。
 */
const settleDesktopCloses = async (
    requests: {header: HTMLElement; tab: IdleTabCandidate;}[],
): Promise<IdleTabCandidate[]> => {
    if (requests.length === 0) {
        return [];
    }
    await new Promise((resolve) => {
        window.setTimeout(resolve, 400);
    });
    return requests.filter(({header}) => !header.isConnected).map(({tab}) => tab);
};

/**
 * 移动端页签模型关掉后台页签时会顺手把「页签总览」抽屉打开（宿主用来交代上下文）。
 * 自动收起不该弹东西给用户看，所以只关掉我们自己打开的那一份：原本就开着就不动它。
 */
const closeMobileOverviewIfOpened = (wasOpen: boolean): void => {
    if (wasOpen) {
        return;
    }
    const model = document.getElementById("model");
    if (!model?.style.transform || !model.querySelector("#modelMain .mobile-tabs")) {
        return;
    }
    document.getElementById("modelClose")?.dispatchEvent(new MouseEvent("click", {bubbles: true}));
};

const markActivity = (activity: ActivityTable, event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) {
        return;
    }
    const panel = target.closest<HTMLElement>(".layout-tab-container > [data-id]");
    const panelId = panel?.dataset.id;
    if (panelId) {
        activity.set(panelId, Date.now());
        return;
    }
    const tabs = mobileTabs();
    const activeID = tabs?.state?.activeTabID;
    if (tabs && activeID && target.closest("#editor, .protyle")) {
        activity.set(activeID, Date.now());
    }
};

export const mountTabAutoClose = (host: FeatureHost): FeatureInstance => {
    const activity: ActivityTable = new Map();
    let timer: number | undefined;
    let disposed = false;

    /** 给当前所有页签重新计时：刚启用、刚回到前台时都不该立刻收东西。 */
    const restartIdleTimers = (reason: string): void => {
        const now = Date.now();
        [...desktopCandidates(activity), ...mobileCandidates(activity)].forEach((tab) => {
            activity.set(tab.id, now);
        });
        host.log.info(`idle timers restart (${reason})`);
    };

    const scan = async (): Promise<void> => {
        if (disposed || document.visibilityState === "hidden") {
            // 界面在后台时不收页签：用户看不见发生了什么，回来只会觉得东西没了
            return;
        }
        const idleMs = minutesOf(host.config.minutes) * 60_000;
        const keywords = parseKeywords(String(host.config.keepKeywords ?? ""));
        const candidates = [...desktopCandidates(activity), ...mobileCandidates(activity)];
        const idle = pickIdleTabs(candidates, {now: Date.now(), idleMs, keywords}).slice(0, MAX_CLOSES_PER_ROUND);
        if (idle.length === 0) {
            return;
        }

        const requests: {header: HTMLElement; tab: IdleTabCandidate;}[] = [];
        const remaining: IdleTabCandidate[] = [];
        idle.forEach((tab) => {
            try {
                const header = requestDesktopClose(tab.id);
                if (header) {
                    requests.push({header, tab});
                } else {
                    remaining.push(tab);
                }
            } catch (error) {
                host.log.warn("cannot close an idle tab", {id: tab.id, error});
            }
        });
        const closed = await settleDesktopCloses(requests);

        if (remaining.length > 0) {
            const tabs = mobileTabs();
            const model = document.getElementById("model");
            const overviewWasOpen = Boolean(model?.style.transform);
            for (const tab of remaining) {
                if (!tabs?.close) {
                    break;
                }
                try {
                    await tabs.close(tab.id);
                    closed.push(tab);
                } catch (error) {
                    host.log.warn("cannot close an idle mobile tab", {id: tab.id, error});
                }
            }
            closeMobileOverviewIfOpened(overviewWasOpen);
        }

        if (closed.length === 0) {
            return;
        }
        host.log.info(`closed ${closed.length} idle tab(s)`, {
            minutes: Math.round(idleMs / 60_000),
            tabs: closed.map((tab) => `${tab.title} (${Math.round((Date.now() - tab.lastActive) / 60_000)} min)`),
        });
        if (host.config.notify === "on") {
            host.showMessage(
                host.i18n("feature.tabAutoClose.closedNotice")
                    .replace("{count}", String(closed.length))
                    .replace("{minutes}", String(Math.round(idleMs / 60_000))),
            );
        }
    };

    const onActivity = (event: Event) => markActivity(activity, event);
    ACTIVITY_EVENTS.forEach((type) => {
        window.addEventListener(type, onActivity, {capture: true, passive: true});
    });
    const onVisibilityChange = () => {
        if (document.visibilityState === "visible") {
            restartIdleTimers("visible");
        }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    host.onConfigChange(() => {
        host.log.info("configuration changed", {
            minutes: minutesOf(host.config.minutes),
            notify: host.config.notify === "on",
        });
    });

    restartIdleTimers("mount");
    host.log.info("watching idle tabs", {
        minutes: minutesOf(host.config.minutes),
        interval: SCAN_INTERVAL_MS,
        mobile: Boolean(mobileTabs()),
    });
    timer = window.setInterval(() => {
        void scan();
    }, SCAN_INTERVAL_MS);

    return {
        destroy: () => {
            disposed = true;
            if (timer !== undefined) {
                window.clearInterval(timer);
                timer = undefined;
            }
            ACTIVITY_EVENTS.forEach((type) => {
                window.removeEventListener(type, onActivity, {capture: true});
            });
            document.removeEventListener("visibilitychange", onVisibilityChange);
            activity.clear();
        },
    };
};
