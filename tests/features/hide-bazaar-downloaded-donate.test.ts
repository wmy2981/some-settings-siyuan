import {
    describe,
    expect,
    it,
} from "vitest";
import type {FeatureHost} from "../../src/core/types";
import definition from "../../src/features/hide-bazaar-downloaded-donate/index";
import {mountHideBazaarDownloadedDonate} from "../../src/features/hide-bazaar-downloaded-donate/style";
import {mountFeature} from "../helpers/feature-host";

describe("隐藏集市已下载列表的捐赠按钮", () => {
    it("注入只覆盖两种捐赠按钮的已下载卡片样式", () => {
        let css = "";
        const host = {addStyle: (value: string) => css = value} as unknown as FeatureHost;

        expect(mountHideBazaarDownloadedDonate(host)).toEqual({});
        expect(css).toContain("#configBazaarDownloaded > .b3-card > .b3-card__actions");
        expect(css).toContain('a.block__icon[target="_blank"][href]');
        expect(css).toContain('span.block__icon[data-type="copy-funding"]');
        expect(css).toContain("display: none");
        expect(css).not.toContain(":has(");
        expect(css).not.toContain("#configBazaarReadme");
    });

    it("两条规则都锚在卡片自己的操作区上，不会连整块操作区一起藏掉", () => {
        const harness = mountFeature(definition);
        const css = harness.css();

        // 选择器必须一路落到具体的两种图标上：藏 `.b3-card__actions` 本身会把收藏、
        // 设置、卸载、开关一并藏掉，那是比「多藏一个按钮」严重得多的回归。
        const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
        const body = bare.slice(bare.indexOf("{") + 1, bare.lastIndexOf("}"));
        const targets = bare.slice(0, bare.indexOf("{")).split(",").map((target) => target.trim());
        expect(targets).toHaveLength(2);
        // 一段 CSS 里只有这两条选择器与一条声明，没有多余的规则
        expect(body.replace(/\s+/g, " ").trim()).toBe("display: none;");
        targets.forEach((target) => {
            expect(
                target.endsWith('a.block__icon[target="_blank"][href]') || target.endsWith(
                    'span.block__icon[data-type="copy-funding"]',
                ),
            ).toBe(true);
            expect(target.startsWith("#configBazaarDownloaded > .b3-card > .b3-card__actions > ")).toBe(true);
        });
        expect(css).not.toMatch(/\.b3-card__actions\s*\{/);
    });

    it("只作用于「已下载」列表，包详情页与其它分类不受影响", () => {
        const css = mountFeature(definition).css();

        // 捐赠按钮在集市详情页是主操作，藏掉会直接影响赞助链接的点击；
        // 因此每条规则都必须以已下载列表的 id 开头。
        expect(css.match(/#configBazaarDownloaded/g)).toHaveLength(2);
        expect(css).not.toContain("#configBazaarInstalled");
        expect(css).not.toContain(".b3-card__img");
        expect(css).not.toContain(".b3-card__actions {");
    });

    it("卸载后样式元素从 <head> 里消失，不留任何监听", () => {
        const harness = mountFeature(definition);
        expect(harness.styleElement()).not.toBeNull();
        expect(harness.records.bus).toHaveLength(0);
        expect(harness.records.configListeners).toHaveLength(0);

        harness.dispose();
        expect(harness.styleElement()).toBeNull();
        expect(document.querySelectorAll("style[data-some-settings-style]")).toHaveLength(0);
    });

    it("声明里默认关闭、且不返回 destroy（纯样式功能没有运行期状态）", () => {
        expect(definition.id).toBe("hide-bazaar-downloaded-donate");
        expect(definition.category).toBe("settings");
        expect(definition.enabled).toBe(true);
        expect(definition.settings).toEqual([
            {kind: "switch", key: "enabled", title: "common.enabled", default: false},
        ]);
        expect(mountFeature(definition).instance).toEqual({});
    });
});
