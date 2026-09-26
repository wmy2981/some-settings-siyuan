/**
 * 控制台日志抓取与查看窗口的实现。
 *
 * 抓取方式是最直接的 `console` 方法包装：调用原方法保证日志照旧出现在
 * 真正的控制台里，同时把格式化后的文本放进环形缓冲。
 * 缓冲放在模块作用域而不是挂载实例里，这样即使功能被临时卸载，
 * 面板上的按钮也还是能打开已经收到的日志。
 */
import {Dialog} from "siyuan";
import {isMobile} from "../../core/frontend";
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

const LEVELS = ["debug", "log", "info", "warn", "error"] as const;
type Level = typeof LEVELS[number];

const DEFAULT_CAPACITY = 2000;
const MAX_ROWS = 4000;

interface LogEntry {
    time: number;
    level: Level;
    text: string;
}

const entries: LogEntry[] = [];
const originals = new Map<Level, (...args: unknown[]) => void>();
let capacity = DEFAULT_CAPACITY;
let installed = false;
let activeHost: FeatureHost | undefined;
let openDialog: Dialog | undefined;
let refreshFrame = 0;

const CONSOLE_CSS = `
.ss-console-log {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 0;
    overflow: hidden;
}

.ss-console-log__bar {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--b3-theme-surface-lighter);
    color: var(--b3-theme-on-surface);
    font-size: 12px;
    line-height: 20px;
}

.ss-console-log__count {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.ss-console-log__list {
    flex: 1;
    min-height: 0;
    padding: 4px 0;
    overflow: auto;
    background-color: var(--b3-theme-background);
    -webkit-overflow-scrolling: touch;
}

.ss-console-log__row {
    display: flex;
    gap: 8px;
    padding: 2px 12px;
    border-bottom: 1px solid var(--b3-theme-background-light, transparent);
    color: var(--b3-theme-on-background);
    font-family: var(--b3-font-family-code);
    font-size: 12px;
    line-height: 18px;
    word-break: break-all;
    white-space: pre-wrap;
}

.ss-console-log__row:hover {
    background-color: var(--b3-list-hover);
}

.ss-console-log__time {
    flex: 0 0 auto;
    color: var(--b3-theme-on-surface-light);
    font-variant-numeric: tabular-nums;
}

.ss-console-log__level {
    flex: 0 0 44px;
    font-weight: 600;
    text-transform: uppercase;
}

.ss-console-log__text {
    flex: 1;
    min-width: 0;
    -webkit-user-select: text;
    user-select: text;
}

.ss-console-log__row--debug .ss-console-log__level,
.ss-console-log__row--debug .ss-console-log__text {
    color: var(--b3-theme-on-surface-light);
}

.ss-console-log__row--warn .ss-console-log__level {
    color: #e69500;
}

.ss-console-log__row--error .ss-console-log__level {
    color: var(--b3-theme-error);
}

.ss-console-log__empty {
    padding: 24px 12px;
    color: var(--b3-theme-on-surface);
    text-align: center;
    opacity: .7;
}
`;

const escapeHtml = (value: string): string =>
    value.replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

const describe = (value: unknown): string => {
    if (typeof value === "string") {
        return value;
    }
    if (value instanceof Error) {
        return `${value.name}: ${value.message}`;
    }
    if (typeof value === "undefined") {
        return "undefined";
    }
    if (typeof value === "function") {
        return `[function ${value.name || "anonymous"}]`;
    }
    try {
        const json = JSON.stringify(value);
        return typeof json === "string" ? json : String(value);
    } catch {
        return String(value);
    }
};

const pad = (value: number, width = 2): string => value.toString().padStart(width, "0");

const formatTime = (time: number): string => {
    const date = new Date(time);
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${
        pad(date.getMilliseconds(), 3)
    }`;
};

const trim = (): void => {
    if (entries.length > capacity) {
        entries.splice(0, entries.length - capacity);
    }
};

const push = (level: Level, args: unknown[]): void => {
    entries.push({time: Date.now(), level, text: args.map(describe).join(" ")});
    trim();
    scheduleRefresh();
};

const install = (): void => {
    if (installed) {
        return;
    }
    installed = true;
    LEVELS.forEach((level) => {
        const existing = console[level] as ((...args: unknown[]) => void) | undefined;
        if (typeof existing !== "function") {
            return;
        }
        const original = existing.bind(console);
        originals.set(level, original);
        (console as unknown as Record<string, unknown>)[level] = (...args: unknown[]) => {
            push(level, args);
            original(...args);
        };
    });
};

const uninstall = (): void => {
    if (!installed) {
        return;
    }
    installed = false;
    originals.forEach((original, level) => {
        (console as unknown as Record<string, unknown>)[level] = original;
    });
    originals.clear();
};

const rowsHtml = (): string =>
    entries.slice(-MAX_ROWS).map((entry) =>
        `<div class="ss-console-log__row ss-console-log__row--${entry.level}">` +
        `<span class="ss-console-log__time">${escapeHtml(formatTime(entry.time))}</span>` +
        `<span class="ss-console-log__level">${entry.level}</span>` +
        `<span class="ss-console-log__text">${escapeHtml(entry.text)}</span>` +
        "</div>"
    ).join("");

const plainText = (): string =>
    entries.map((entry) => `[${formatTime(entry.time)}] ${entry.level.toUpperCase()} ${entry.text}`).join("\n");

export const openConsoleLog = (): void => {
    const host = activeHost;
    if (!host || openDialog) {
        return;
    }
    const t = (key: string): string => host.i18n(key);
    const dialog = new Dialog({
        title: t("mobileConsoleLog.title"),
        width: isMobile() ? "92vw" : "760px",
        height: "80vh",
        content: `<div class="b3-dialog__content ss-console-log">
    <div class="ss-console-log__bar">
        <span class="ss-console-log__count" data-log-count></span>
        <button class="b3-button b3-button--outline" type="button" data-log-copy>${
            escapeHtml(t("mobileConsoleLog.copy"))
        }</button>
        <button class="b3-button b3-button--outline" type="button" data-log-clear>${
            escapeHtml(t("mobileConsoleLog.clear"))
        }</button>
    </div>
    <div class="ss-console-log__list" data-log-list></div>
</div>`,
        destroyCallback: () => {
            openDialog = undefined;
        },
    });
    openDialog = dialog;

    const list = dialog.element.querySelector<HTMLElement>("[data-log-list]");
    const count = dialog.element.querySelector<HTMLElement>("[data-log-count]");

    const refresh = () => {
        if (!list || !count || !dialog.element.isConnected) {
            return;
        }
        count.textContent = t("mobileConsoleLog.count").replace("${count}", entries.length.toString());
        list.innerHTML = entries.length > 0 ?
            rowsHtml() :
            `<div class="ss-console-log__empty">${escapeHtml(t("mobileConsoleLog.empty"))}</div>`;
        list.scrollTop = list.scrollHeight;
    };

    dialog.element.querySelector<HTMLButtonElement>("[data-log-copy]")?.addEventListener("click", () => {
        void navigator.clipboard?.writeText(plainText()).then(() => {
            host.showMessage(t("mobileConsoleLog.copied"));
        }).catch(() => {
            host.showMessage(t("mobileConsoleLog.copyFailed"));
        });
    });
    dialog.element.querySelector<HTMLButtonElement>("[data-log-clear]")?.addEventListener("click", () => {
        entries.length = 0;
        refresh();
    });

    refresh();
};

const scheduleRefresh = (): void => {
    if (!openDialog || refreshFrame) {
        return;
    }
    refreshFrame = window.requestAnimationFrame(() => {
        refreshFrame = 0;
        if (!openDialog) {
            return;
        }
        const list = openDialog.element.querySelector<HTMLElement>("[data-log-list]");
        const count = openDialog.element.querySelector<HTMLElement>("[data-log-count]");
        if (list) {
            list.innerHTML = entries.length > 0 ? rowsHtml() : "";
            list.scrollTop = list.scrollHeight;
        }
        if (count && activeHost) {
            count.textContent = activeHost.i18n("mobileConsoleLog.count")
                .replace("${count}", entries.length.toString());
        }
    });
};

export const mountConsoleLog = (host: FeatureHost): FeatureInstance => {
    activeHost = host;
    host.addStyle(CONSOLE_CSS);
    const configured = Number(host.config.capacity);
    capacity = Number.isFinite(configured) && configured > 0 ?
        Math.min(20000, Math.max(200, Math.round(configured))) :
        DEFAULT_CAPACITY;
    trim();
    host.onConfigChange(() => {
        const next = Number(host.config.capacity);
        if (Number.isFinite(next) && next > 0) {
            capacity = Math.min(20000, Math.max(200, Math.round(next)));
            trim();
        }
    });
    install();

    return {
        destroy: () => {
            if (openDialog) {
                openDialog.destroy();
                openDialog = undefined;
            }
            if (refreshFrame) {
                window.cancelAnimationFrame(refreshFrame);
                refreshFrame = 0;
            }
            uninstall();
            activeHost = undefined;
        },
    };
};
