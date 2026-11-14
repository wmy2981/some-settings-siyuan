/**
 * 设置面板基准：打开一次面板、每敲一个字符过滤一次。
 *
 * 用真实的注册表与真实的全部语言文件，行数、文案长度都与线上一致；
 * 时间花在字符串拼接、innerHTML 解析与逐行显隐上，正是用户能感知的那一段。
 */
import type {Plugin} from "siyuan";
import {
    describe,
    it,
} from "vitest";
import {ConfigStore} from "../../src/core/config";
import {setDetailedLogging} from "../../src/core/log";
import {activeFeatures} from "../../src/core/registry";
import {SettingsPanel} from "../../src/core/setting-dialog";
import enLocale from "../../src/i18n/en.json";
import zhLocale from "../../src/i18n/zh-CN.json";
import zhTWLocale from "../../src/i18n/zh-TW.json";
import {mockState} from "../mocks/siyuan";
import {
    measure,
    printRows,
} from "./harness";
import type {BenchRow} from "./harness";

/** 宿主播件：配置全空，读盘一次就返回。 */
class BenchHost {
    readonly name = "some-settings-siyuan";
    readonly displayName = "some settings";
    readonly i18n: Record<string, string> = zhLocale as Record<string, string>;
    readonly files = new Map<string, unknown>();
    readonly locales = [enLocale, zhLocale, zhTWLocale];

    async loadData(name: string): Promise<unknown> {
        return this.files.get(name) ?? "";
    }

    async saveData(name: string, value: unknown): Promise<unknown> {
        this.files.set(name, JSON.parse(JSON.stringify(value)) as unknown);
        return {code: 0};
    }

    async removeData(name: string): Promise<unknown> {
        this.files.delete(name);
        return {code: 0};
    }

    asPlugin(): Plugin {
        return this as unknown as Plugin;
    }
}

const openPanel = async (): Promise<{panel: SettingsPanel; host: BenchHost; input: HTMLInputElement;}> => {
    const host = new BenchHost();
    const store = new ConfigStore(host.asPlugin());
    const features = activeFeatures();
    for (const definition of features) {
        await store.register(definition);
    }
    const panel = new SettingsPanel({plugin: host.asPlugin(), store, features});
    panel.show();
    const root = mockState.settings[mockState.settings.length - 1]?.dialog?.element as HTMLElement | undefined;
    const input = root?.querySelector<HTMLInputElement>("[data-ss-search]") as HTMLInputElement | undefined;
    if (!input) {
        throw new Error("the benchmark panel did not open");
    }
    return {panel, host, input};
};

const type = (input: HTMLInputElement, value: string): void => {
    input.value = value;
    input.dispatchEvent(new Event("input", {bubbles: true}));
};

describe("settings panel", () => {
    it("prints the benchmark table", async () => {
        setDetailedLogging(false);
        const rows: BenchRow[] = [];

        // 打开 / 关闭一次面板：包含拼行、innerHTML、绑定控件、恢复页签
        const opened = await openPanel();
        rows.push(
            measure("panel.show() + close()", () => {
                opened.panel.show();
                opened.panel.close();
            }, {iterations: 12, rounds: 7, warmup: 3}),
        );

        // 每敲一个字符：过滤 + 高亮。两端交替输入，保证每次文本都真的变了
        const {panel, input} = await openPanel();
        let toggle = false;
        type(input, "image");
        rows.push(
            measure("search input (filter + highlight)", () => {
                toggle = !toggle;
                type(input, toggle ? "imag" : "image");
            }, {iterations: 60, rounds: 9, warmup: 5}),
        );
        rows.push(
            measure("search cleared (restore view)", () => {
                type(input, "image");
                type(input, "");
            }, {iterations: 40, rounds: 9, warmup: 4}),
        );
        panel.close();

        printRows("settings panel", rows);
    });
});
