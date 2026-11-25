/**
 * 「自动收起闲置页签」的运行时。
 *
 * 只做三件事：采集页签、按 `policy.ts` 的规则判定、调用宿主自己的关闭入口。
 * 关闭走的是原生路径——桌面端点页签上的关闭按钮，移动端调页签模型的 `close()`，
 * 因此「保存排版、更新最近关闭时间、钉住的页签不参与」这些行为全部照宿主自己的逻辑走，
 * 本功能不复制一份，也不用改动宿主 DOM 结构。移动端那条路会顺手弹「页签总览」抽屉，
 * 自动收起不能弹任何界面，所以只在调用期间把那一个入口遮蔽掉，关完立刻还原。
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
    /** 打开「页签总览」抽屉；宿主关掉后台页签后会自己调它。 */
    openOverview?: () => void;
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
 * 「页签总览」抽屉是不是正开着。
 *
 * 宿主把它装在共用的 `#model` 抽屉里，所以除了看抽屉有没有移出来，还要认内容：
 * 用户正看着文档树、更多菜单这些别的抽屉时不算，那时不该动人家的内容。
 */
const overviewOpen = (): boolean => {
    const model = document.getElementById("model");
    return Boolean(model?.style.transform) && Boolean(model.querySelector("#modelMain .mobile-tabs"));
};

/**
 * 把页签模型实例上的「打开总览」入口暂时收起来，返回还原函数。
 *
 * 宿主关掉一个后台页签后会在 `close()` 的最后一步调它，自动收起是后台行为，不该弹任何界面。
 * 那一步没有开关可关，只能在调用期间遮蔽这个入口；入口本来在原型上，所以还原是删掉这层遮蔽，
 * 而不是把原函数写回实例 —— 否则实例上会多出一个属性，宿主自己改动时也跟随不上。
 */
const hideOverviewEntry = (tabs: MobileTabsLike): () => void => {
    const own = Object.prototype.hasOwnProperty.call(tabs, "openOverview");
    const original = tabs.openOverview;
    tabs.openOverview = () => undefined;
    return () => {
        if (own) {
            tabs.openOverview = original;
        } else {
            delete tabs.openOverview;
        }
    };
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

    /** 给当前所有页签重新计时：刚启用这个功能时不该立刻收东西。 */
    const restartIdleTimers = (reason: string): void => {
        const now = Date.now();
        [...desktopCandidates(activity), ...mobileCandidates(activity)].forEach((tab) => {
            activity.set(tab.id, now);
        });
        host.log.info(`idle timers restart (${reason})`);
    };

    /**
     * 一轮下来一个都没收时，记一行「最接近阈值」的页签。
     *
     * 为什么不收只有它说得清，所以这行日志是排查这类问题的唯一线索；按整分钟比较，
     * 最多每分钟一条，不会在详细日志里刷屏。
     */
    let nearestLogged = -1;
    const logNearest = (candidates: IdleTabCandidate[], idleMs: number): void => {
        const nearest = candidates
            .filter((tab) => tab.closeable && !tab.active && !tab.pinned && tab.siblings > 1 && tab.lastActive)
            .sort((left, right) => left.lastActive - right.lastActive)[0];
        const minutes = nearest ? Math.floor((Date.now() - nearest.lastActive) / 60_000) : -1;
        if (minutes === nearestLogged) {
            return;
        }
        nearestLogged = minutes;
        host.log.info("nothing to close yet", {
            nearest: nearest?.title ?? "",
            idleMinutes: minutes,
            threshold: Math.round(idleMs / 60_000),
        });
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
            logNearest(candidates, idleMs);
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
        const stubborn = requests.filter(({header}) => header.isConnected).map(({tab}) => tab.id);
        if (stubborn.length > 0) {
            // 宿主的关闭入口没生效（正在上传、标题还在落盘等），下一轮会再试一次
            host.log.warn("close request had no effect", {tabs: stubborn});
        }

        const tabs = remaining.length > 0 ? mobileTabs() : undefined;
        if (tabs?.close) {
            // 用户自己开着总览时不遮蔽：界面本来就是可见的，宿主重绘列表正好把收掉的页签摘掉
            const restore = overviewOpen() ? undefined : hideOverviewEntry(tabs);
            try {
                for (const tab of remaining) {
                    try {
                        await tabs.close(tab.id);
                        closed.push(tab);
                    } catch (error) {
                        host.log.warn("cannot close an idle mobile tab", {id: tab.id, error});
                    }
                }
            } finally {
                restore?.();
            }
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
    /**
     * 界面在后台时不扫描，但**后台的时间照常算闲置**，不在回来时把计时归零。
     *
     * 归零就等于「页签必须连续五分钟停在可见的界面上」才算闲置：习惯切出去看别的软件、
     * 或者移动端频繁切前后台的人，永远等不到一次收起，功能看起来就是没生效。
     * 回来时收掉后台期间闲置的页签，正是这个功能要做的事。
     */
    let hiddenAt = 0;
    const onVisibilityChange = () => {
        if (document.visibilityState === "hidden") {
            hiddenAt = Date.now();
            host.log.info("scanning paused while hidden");
            return;
        }
        host.log.info("scanning resumed", {hiddenMs: hiddenAt ? Date.now() - hiddenAt : 0});
        hiddenAt = 0;
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
