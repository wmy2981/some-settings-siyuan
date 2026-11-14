/**
 * 基准测试配置。
 *
 * 与 `vitest.config.mts` 分开：`*.bench.ts` 不是回归测试，`npm test` 不跑它们，
 * 只在需要对比性能时用 `npm run bench` 手动执行。
 */
import {fileURLToPath} from "node:url";
import {defineConfig} from "vitest/config";

const pathOf = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
    resolve: {
        alias: {
            siyuan: pathOf("./tests/mocks/siyuan.ts"),
        },
    },
    test: {
        environment: "jsdom",
        include: ["tests/bench/**/*.bench.ts"],
        setupFiles: [pathOf("./tests/setup.ts")],
        pool: "forks",
        testTimeout: 120_000,
        hookTimeout: 120_000,
    },
});
