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
    it("desktop and desktop window both count as desktop", () => {
        mockState.frontend = "desktop";
        expect(currentFrontend()).toBe("desktop");
        mockState.frontend = "desktop-window";
        expect(currentFrontend()).toBe("desktop");
    });

    it("mobile and browser-mobile both count as mobile", () => {
        mockState.frontend = "mobile";
        expect(currentFrontend()).toBe("mobile");
        mockState.frontend = "browser-mobile";
        expect(currentFrontend()).toBe("mobile");
    });

    it("an unknown frontend is treated as desktop", () => {
        mockState.frontend = "tablet";
        expect(currentFrontend()).toBe("desktop");
    });

    it("isMobile agrees with currentFrontend", () => {
        mockState.frontend = "mobile";
        expect(isMobile()).toBe(true);
        mockState.frontend = "desktop";
        expect(isMobile()).toBe(false);
    });
});

describe("supportsCurrentFrontend", () => {
    it("both frontends work when frontends is not declared", () => {
        mockState.frontend = "mobile";
        expect(supportsCurrentFrontend(definitionWith())).toBe(true);
        mockState.frontend = "desktop";
        expect(supportsCurrentFrontend(definitionWith())).toBe(true);
    });

    it("an empty array means no restriction", () => {
        expect(supportsCurrentFrontend(definitionWith([]))).toBe(true);
    });

    it("applies when only the current frontend is listed", () => {
        mockState.frontend = "browser-mobile";
        expect(supportsCurrentFrontend(definitionWith(["mobile"]))).toBe(true);
        expect(supportsCurrentFrontend(definitionWith(["desktop"]))).toBe(false);
    });

    it("always applies when both frontends are listed", () => {
        mockState.frontend = "desktop";
        expect(supportsCurrentFrontend(definitionWith(["desktop", "mobile"]))).toBe(true);
        mockState.frontend = "mobile";
        expect(supportsCurrentFrontend(definitionWith(["desktop", "mobile"]))).toBe(true);
    });
});

describe("withoutMobileInputFocus", () => {
    it("on desktop it runs the body untouched, without touching focus", () => {
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

    it("on mobile input / textarea focusing is blocked while other elements pass", () => {
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

    it("focus is restored afterwards so the user can still edit", () => {
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

    it("focus is restored on throw too, and the error reaches the caller", () => {
        mockState.frontend = "mobile";
        const original = HTMLElement.prototype.focus;
        expect(() =>
            withoutMobileInputFocus(() => {
                throw new Error("host refused");
            })
        ).toThrow("host refused");
        expect(HTMLElement.prototype.focus).toBe(original);
    });

    it("nested calls never restore the host method to the wrapper", () => {
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
