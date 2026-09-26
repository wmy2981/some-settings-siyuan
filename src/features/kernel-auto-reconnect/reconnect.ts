/**
 * 断连自动重连的实现。
 *
 * 断连的信号就是内核自己创建的 `#errorLog` 面板出现（也是"内核掉了"这件事
 * 唯一稳定可观察的外部表现）；面板消失说明主 WebSocket 已经重新连上，
 * 这时立刻停掉自己的重试。
 *
 * 注意 `unit: "kernelAutoReconnect.times"` 走的是 i18n：数字行的单位标签与其它
 * 文案一样由面板翻译，所以"次"在中英两种语言下都正确。
 */
import {fetchPost} from "siyuan";
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

const ERROR_LOG_ID = "errorLog";
const DEFAULT_ATTEMPTS = 2;
const DEFAULT_INTERVAL = 500;
const PROBE_TIMEOUT_MS = 2000;

const attemptsOf = (host: FeatureHost): number => {
    const value = Number(host.config.attempts);
    if (!Number.isFinite(value)) {
        return DEFAULT_ATTEMPTS;
    }
    return Math.min(20, Math.max(0, Math.round(value)));
};

const intervalOf = (host: FeatureHost): number => {
    const value = Number(host.config.interval);
    if (!Number.isFinite(value)) {
        return DEFAULT_INTERVAL;
    }
    return Math.min(10000, Math.max(100, Math.round(value)));
};

/** 探一次内核是否已经恢复。超时或异常一律按"没恢复"处理。 */
const probeKernel = (): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (alive: boolean) => {
            if (settled) {
                return;
            }
            settled = true;
            window.clearTimeout(timer);
            resolve(alive);
        };
        const timer = window.setTimeout(() => finish(false), PROBE_TIMEOUT_MS);
        try {
            fetchPost("/api/system/currentTime", {}, (response) => finish(response?.code === 0));
        } catch {
            finish(false);
        }
    });

const wait = (ms: number): Promise<void> =>
    new Promise<void>((resolve) => {
        window.setTimeout(resolve, ms);
    });

export const mountKernelAutoReconnect = (host: FeatureHost): FeatureInstance => {
    let running = false;
    let disposed = false;

    const isOffline = (): boolean => Boolean(document.getElementById(ERROR_LOG_ID));

    const run = async (): Promise<void> => {
        const attempts = attemptsOf(host);
        if (running || disposed || attempts <= 0) {
            return;
        }
        running = true;
        try {
            for (let index = 0; index < attempts; index++) {
                await wait(intervalOf(host));
                if (disposed || !isOffline()) {
                    return;
                }
                if (await probeKernel()) {
                    host.log(`第 ${index + 1} 次探测到内核已恢复，重载前端以重建 WebSocket`);
                    window.location.reload();
                    return;
                }
            }
            host.log(`${attempts} 次自动重连都没有探测到内核，交回思源自身的重连机制`);
        } finally {
            running = false;
        }
    };

    const start = () => {
        void run();
    };

    if (isOffline()) {
        start();
    }
    const observer = new MutationObserver(() => {
        if (isOffline()) {
            start();
        }
    });
    observer.observe(document.body, {childList: true});

    return {
        destroy: () => {
            disposed = true;
            observer.disconnect();
        },
    };
};
