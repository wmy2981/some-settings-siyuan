/**
 * 单元测试配置。
 *
 * `siyuan` 是宿主的运行时包，npm 上那份只有类型声明，所以统一替换成
 * `tests/mocks/siyuan.ts` 里的替身——所有测试通过它驱动宿主行为
 * （前端类型、内核响应、Setting 对话框、confirm 结果）。
 *
 * 性能上分两个 project：
 * - `vm`（绝大多数文件）用 `vmThreads`：文件级隔离不变，但省掉每个文件重建
 *   worker 与 jsdom 环境的开销。
 * - `forks`（仅两个替换 `window.location` 的文件）留在默认进程池：jsdom 的
 *   `location` 在 VM 上下文里连 `Object.defineProperty` 都拒绝，而这两个文件
 *   只能整块换掉 `location` 才能观察 `reload()`。
 */
import {fileURLToPath} from "node:url";
import {defineConfig} from "vitest/config";

const pathOf = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

/** 依赖替换整个 `window.location` 的测试文件，只能用默认进程池。 */
const locationTests = [
    pathOf("./tests/features/kernel-auto-reconnect.test.ts"),
    pathOf("./tests/features/kernel-reconnect-button.test.ts"),
];

export default defineConfig({
    resolve: {
        alias: {
            siyuan: pathOf("./tests/mocks/siyuan.ts"),
        },
    },
    test: {
        environment: "jsdom",
        // 文件清单只由两个 project 各自声明：这里的 include 会被子 project 继承并拼接。
        include: [],
        setupFiles: [pathOf("./tests/setup.ts")],
        restoreMocks: true,
        coverage: {
            provider: "v8",
            // 机制层与功能层都要算：功能是自己一个目录一个实现，漏测哪块一眼就能看出来
            include: ["src/core/**/*.ts", "src/features/**/*.ts"],
            reporter: ["text", "text-summary"],
        },
        projects: [
            {
                test: {
                    name: "vm",
                    pool: "vmThreads",
                    include: ["tests/**/*.test.ts"],
                    exclude: locationTests,
                },
            },
            {
                test: {
                    name: "forks",
                    pool: "forks",
                    include: locationTests,
                },
            },
        ],
    },
});
