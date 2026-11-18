/**
 * `core/click.ts`：面板按钮的「执行期间不可再点」守卫。
 *
 * 这里的 bug 都长得像「点一下冒出两个弹窗」或「同一次保存写了两遍」，
 * 所以每个用例都要同时看「执行次数」和「按钮最终状态」。
 */
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import {bindPendingClick} from "../../src/core/click";
import {setDetailedLogging} from "../../src/core/log";
import {mockState} from "../mocks/siyuan";

const TAG = "[some-settings-siyuan__";

beforeEach(() => {
    setDetailedLogging(true);
});

afterEach(() => {
    setDetailedLogging(false);
});

const makeButton = (): HTMLButtonElement => {
    const button = document.createElement("button");
    document.body.append(button);
    return button;
};

const click = (button: HTMLButtonElement): void => {
    button.dispatchEvent(new MouseEvent("click"));
};

describe("bindPendingClick", () => {
    it("restores the button right after a synchronous run", () => {
        const button = makeButton();
        const run = vi.fn(() => undefined);
        bindPendingClick(button, "scope", run);
        click(button);
        expect(run).toHaveBeenCalledTimes(1);
        expect(button.disabled).toBe(false);
    });

    it("keeps the button disabled during an async run and restores it once settled", async () => {
        const button = makeButton();
        let resolve: () => void = () => undefined;
        const run = vi.fn(() =>
            new Promise<void>((done) => {
                resolve = done;
            })
        );
        bindPendingClick(button, "scope", run);

        click(button);
        expect(button.disabled).toBe(true);
        resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(button.disabled).toBe(false);
    });

    it("repeated clicks during a run neither dispatch nor execute again", async () => {
        const button = makeButton();
        let resolve: () => void = () => undefined;
        const run = vi.fn(() =>
            new Promise<void>((done) => {
                resolve = done;
            })
        );
        bindPendingClick(button, "scope", run);

        click(button);
        click(button);
        click(button);
        expect(run).toHaveBeenCalledTimes(1);

        resolve();
        await Promise.resolve();
        await Promise.resolve();
        click(button);
        expect(run).toHaveBeenCalledTimes(2);
    });

    it("restores the button and reports when a synchronous error is thrown", () => {
        const button = makeButton();
        const error = new Error("bad");
        bindPendingClick(button, "scope", () => {
            throw error;
        });
        click(button);
        expect(button.disabled).toBe(false);
        expect(vi.mocked(console.error)).toHaveBeenCalledWith(
            expect.stringContaining(`${TAG}scope] ERROR Error: ${error.message}`),
        );
        expect(mockState.messages).toHaveLength(1);
    });

    it("restores the button and reports when an async run fails", async () => {
        const button = makeButton();
        const error = new Error("rejected");
        bindPendingClick(button, "scope", () => Promise.reject(error));
        click(button);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(button.disabled).toBe(false);
        expect(vi.mocked(console.error)).toHaveBeenCalledWith(
            expect.stringContaining(`${TAG}scope] ERROR Error: ${error.message}`),
        );
    });

    it("does not run when the button starts out disabled", () => {
        const button = makeButton();
        button.disabled = true;
        const run = vi.fn(() => undefined);
        bindPendingClick(button, "scope", run);
        click(button);
        expect(run).not.toHaveBeenCalled();
    });

    it("a non-Promise thenable counts as asynchronous too", async () => {
        const button = makeButton();
        let released = false;
        bindPendingClick(button, "scope", () => ({
            then(done: () => void) {
                setTimeout(() => {
                    released = true;
                    done();
                }, 0);
            },
        }));
        click(button);
        expect(button.disabled).toBe(true);
        await new Promise((done) => setTimeout(done, 5));
        expect(released).toBe(true);
        expect(button.disabled).toBe(false);
    });
});
