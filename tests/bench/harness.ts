/**
 * 基准测试的最小计时器。
 *
 * 只做一件事：重复执行同一段代码，取每轮平均耗时的中位数 —— 中位数能挡掉
 * 偶发的 GC / 调度抖动，比平均值稳定。输出统一成「每次操作多少毫秒」，
 * 两版代码在同一台机器上用同一份脚本各跑一遍即可对比。
 */

export interface BenchRow {
    /** 被测代码的名字。 */
    name: string;
    /** 每轮迭代次数。 */
    iterations: number;
    /** 一次操作耗时的中位数（毫秒）。 */
    meanMs: number;
    /** 每秒可执行次数。 */
    opsPerSec: number;
}

export interface MeasureOptions {
    iterations?: number;
    rounds?: number;
    /** 预热次数：JIT 与 DOM 路径在头几次都不是稳态。 */
    warmup?: number;
}

/** 同步代码的耗时：返回一次操作的毫秒中位数。 */
export const measure = (name: string, action: () => void, options: MeasureOptions = {}): BenchRow => {
    const iterations = options.iterations ?? 1000;
    const rounds = options.rounds ?? 7;
    const warmup = options.warmup ?? Math.min(iterations, 100);
    for (let index = 0; index < warmup; index += 1) {
        action();
    }
    const samples: number[] = [];
    for (let round = 0; round < rounds; round += 1) {
        const start = performance.now();
        for (let index = 0; index < iterations; index += 1) {
            action();
        }
        samples.push((performance.now() - start) / iterations);
    }
    samples.sort((left, right) => left - right);
    const meanMs = samples[Math.floor(samples.length / 2)];
    return {name, iterations, meanMs, opsPerSec: meanMs > 0 ? 1000 / meanMs : Number.POSITIVE_INFINITY};
};

/** 异步代码的耗时（每轮迭代本身是串行的）。 */
export const measureAsync = async (
    name: string,
    action: () => Promise<void>,
    options: MeasureOptions = {},
): Promise<BenchRow> => {
    const iterations = options.iterations ?? 50;
    const rounds = options.rounds ?? 5;
    const warmup = options.warmup ?? Math.min(iterations, 5);
    for (let index = 0; index < warmup; index += 1) {
        await action();
    }
    const samples: number[] = [];
    for (let round = 0; round < rounds; round += 1) {
        const start = performance.now();
        for (let index = 0; index < iterations; index += 1) {
            await action();
        }
        samples.push((performance.now() - start) / iterations);
    }
    samples.sort((left, right) => left - right);
    const meanMs = samples[Math.floor(samples.length / 2)];
    return {name, iterations, meanMs, opsPerSec: meanMs > 0 ? 1000 / meanMs : Number.POSITIVE_INFINITY};
};

const pad = (value: string, width: number): string => value.padEnd(width, " ");

/** 把结果打成一张定宽表：数字按毫秒输出，便于两版对比。 */
export const printRows = (title: string, rows: BenchRow[]): void => {
    const nameWidth = Math.max(...rows.map((row) => row.name.length), 8) + 2;
    const lines = [`\n## ${title}`];
    lines.push(`${pad("case", nameWidth)}${pad("ms/op", 12)}${pad("ops/s", 12)}iterations`);
    rows.forEach((row) => {
        lines.push(
            `${pad(row.name, nameWidth)}${pad(row.meanMs.toFixed(4), 12)}${
                pad(row.opsPerSec >= 1000 ? Math.round(row.opsPerSec).toString() : row.opsPerSec.toFixed(1), 12)
            }${row.iterations}`,
        );
    });
    // 测试环境里 `console` 被 setup 全局静音，基准结果直接写 stdout
    process.stdout.write(`${lines.join("\n")}\n`);
};
