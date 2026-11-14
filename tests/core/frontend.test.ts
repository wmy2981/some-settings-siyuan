/**
 * `core/frontend.ts`：前端二元判别、功能的前端适用范围、移动端打开面板时的
 * 输入框聚焦拦截。
 */
import {
    describe,
    expect,
    it,
} from "vitest";
import {
    currentFrontend,
    isMobile,
    supportsCurrentFrontend,
    withoutMobileInputFocus,
} from "../../src/core/frontend";
import type {FeatureDefinition} from "../../src/core/types";
import {mockState} from "../mocks/siyuan";

const definitionWith = (frontends?: FeatureDefinition["frontends"]): FeatureDefinition => ({
    id: "demo",
    category: "editor",
    name: "demo.name",
    enabled: true,
    settings: [],
    frontends,
});

describe("currentFrontend", () => {
    it("桌面端与桌面窗口都算 desktop", () => {
        mockState.frontend = "desktop";
        expect(currentFrontend()).toBe("desktop");
        mockState.frontend = "desktop-window";
        expect(currentFrontend()).toBe("desktop");
    });

    it("mobile 与 browser-mobile 都算 mobile", () => {
        mockState.frontend = "mobile";
        expect(currentFrontend()).toBe("mobile");
        mockState.frontend = "browser-mobile";
        expect(currentFrontend()).toBe("mobile");
    });

    it("认不出的前端按桌面端处理", () => {
        mockState.frontend = "tablet";
        expect(currentFrontend()).toBe("desktop");
    });

    it("isMobile 与 currentFrontend 一致", () => {
        mockState.frontend = "mobile";
        expect(isMobile()).toBe(true);
        mockState.frontend = "desktop";
        expect(isMobile()).toBe(false);
    });
});

describe("supportsCurrentFrontend", () => {
    it("没声明 frontends 时两端都适用", () => {
        mockState.frontend = "mobile";
        expect(supportsCurrentFrontend(definitionWith())).toBe(true);
        mockState.frontend = "desktop";
        expect(supportsCurrentFrontend(definitionWith())).toBe(true);
    });

    it("声明了空数组等同于不限制", () => {
        expect(supportsCurrentFrontend(definitionWith([]))).toBe(true);
    });

    it("只包含当前端时适用", () => {
        mockState.frontend = "browser-mobile";
        expect(supportsCurrentFrontend(definitionWith(["mobile"]))).toBe(true);
        expect(supportsCurrentFrontend(definitionWith(["desktop"]))).toBe(false);
    });

    it("两端都写上时永远适用", () => {
        mockState.frontend = "desktop";
        expect(supportsCurrentFrontend(definitionWith(["desktop", "mobile"]))).toBe(true);
        mockState.frontend = "mobile";
        expect(supportsCurrentFrontend(definitionWith(["desktop", "mobile"]))).toBe(true);
    });
});

describe("withoutMobileInputFocus", () => {
    it("桌面端直接执行，不碰 focus", () => {
        mockState.frontend = "desktop";
        const original = HTMLElement.prototype.focus;
        const seen: (() => boolean)[] = [];
        const result = withoutMobileInputFocus(() => {
            seen.push(() => HTMLElement.prototype.focus === original);
            return "done";
        });
        expect(result).toBe("done");
        expect(seen[0]()).toBe(true);
    });

    it("移动端拦下 input / textarea 的聚焦，放行其他元素", () => {
        mockState.frontend = "mobile";
        const input = document.createElement("input");
        const area = document.createElement("textarea");
        const box = document.createElement("div");
        box.tabIndex = 0;
        document.body.append(input, area, box);

        withoutMobileInputFocus(() => {
            input.focus();
            expect(document.activeElement).not.toBe(input);
            area.focus();
            expect(document.activeElement).not.toBe(area);
            box.focus();
            expect(document.activeElement).toBe(box);
        });
    });

    it("执行结束后还原 focus，用户随后仍能正常编辑", () => {
        mockState.frontend = "mobile";
        const original = HTMLElement.prototype.focus;
        const input = document.createElement("input");
        document.body.append(input);

        withoutMobileInputFocus(() => {
            expect(HTMLElement.prototype.focus).not.toBe(original);
        });
        expect(HTMLElement.prototype.focus).toBe(original);
        input.focus();
        expect(document.activeElement).toBe(input);
    });

    it("执行体抛错时同样还原 focus，并把异常抛给调用方", () => {
        mockState.frontend = "mobile";
        const original = HTMLElement.prototype.focus;
        expect(() =>
            withoutMobileInputFocus(() => {
                throw new Error("host refused");
            })
        ).toThrow("host refused");
        expect(HTMLElement.prototype.focus).toBe(original);
    });

    it("嵌套调用时不会把宿主的方法还原成包装版", () => {
        mockState.frontend = "mobile";
        const original = HTMLElement.prototype.focus;
        withoutMobileInputFocus(() => {
            withoutMobileInputFocus(() => undefined);
            // 内层退出后仍是本层的包装，而不是回到原始实现
            expect(HTMLElement.prototype.focus).not.toBe(original);
        });
        expect(HTMLElement.prototype.focus).toBe(original);
    });
});
