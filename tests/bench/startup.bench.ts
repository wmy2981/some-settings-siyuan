/**
 * 启动基准：onload 阶段把每个功能的配置从工作区读出来。
 *
 * 插件的 `loadData` 是一次内核请求，真实工作区里单次要几毫秒；这里给播件加同样的
 * 人工延迟，用来观察「逐个 await」与「并发预读、按原顺序应用」的差别 ——
 * 延迟是常量，所以两种写法读的是同一批数据，差别只在墙钟时间。
 */
import type {Plugin} from "siyuan";
import {
    describe,
    it,
} from "vitest";
import {FeatureManager} from "../../src/core/bootstrap";
import {setDetailedLogging} from "../../src/core/log";
import {activeFeatures} from "../../src/core/registry";
import {
    measureAsync,
    printRows,
} from "./harness";
import type {BenchRow} from "./harness";

/** 每次 loadData 都耗掉 2ms：模拟本地内核的一次往返。 */
const IO_DELAY_MS = 2;

class SlowHost {
    readonly name = "some-settings-siyuan";
    readonly displayName = "some settings";
    readonly i18n: Record<string, string> = {};
    readonly eventBus = {on: () => undefined, off: () => undefined, emit: () => undefined};
    readonly protyleSlash: unknown[] = [];

    async loadData(): Promise<unknown> {
        await new Promise((resolve) => setTimeout(resolve, IO_DELAY_MS));
        return "";
    }

    async saveData(): Promise<unknown> {
        return {code: 0};
    }

    async removeData(): Promise<unknown> {
        return {code: 0};
    }

    addIcons(): void {}

    asPlugin(): Plugin {
        return this as unknown as Plugin;
    }
}

describe("startup", () => {
    it("prints the benchmark table", async () => {
        setDetailedLogging(false);
        const host = new SlowHost();
        const features = activeFeatures();
        const rows: BenchRow[] = [
            await measureAsync("FeatureManager.load()", async () => {
                const manager = new FeatureManager(host.asPlugin());
                await manager.load();
                manager.dispose();
            }, {iterations: 3, rounds: 3, warmup: 1}),
        ];
        process.stdout.write(`\n## startup (${features.length} active features, ${IO_DELAY_MS}ms per read)\n`);
        printRows("startup", rows);
    });
});
