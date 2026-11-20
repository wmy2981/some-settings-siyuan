// @vitest-environment node
/**
 * 自动收起闲置页签的判定规则。
 *
 * 误关一个正在写的页签是这类功能最贵的错误，所以判定逐条钉死：宿主没给面板、正在用、
 * 钉住、分屏里只剩它、宿主没给时间、还没到阈值、命中保留关键字 —— 任何一条成立都不收。
 * DOM 采集与「交给宿主自己的关闭入口」那部分依赖真实页面结构，放在浏览器里验，不在 jsdom 里假造。
 */
import {
    describe,
    expect,
    it,
} from "vitest";
import type {IdleTabCandidate} from "../../src/features/tab-auto-close/policy";
import {
    matchesKeyword,
    parseKeywords,
    pickIdleTabs,
} from "../../src/features/tab-auto-close/policy";

const MINUTE = 60_000;

/** 默认是「闲置一小时、可以收」的普通文档页签，用例只写要改的字段。 */
const candidate = (overrides: Partial<IdleTabCandidate> = {}): IdleTabCandidate => ({
    id: "t1",
    title: "Note",
    active: false,
    pinned: false,
    siblings: 2,
    lastActive: 1_000,
    closeable: true,
    ...overrides,
});

describe("parseKeywords", () => {
    it("accepts commas, ideographic commas, enumeration marks and spaces", () => {
        expect(parseKeywords(" 日记, Inbox、收集 箱 ")).toEqual(["日记", "inbox", "收集", "箱"]);
    });

    it("drops empty entries and duplicates", () => {
        expect(parseKeywords(",,  Diary ,, diary ,,")).toEqual(["diary"]);
        expect(parseKeywords("   ")).toEqual([]);
    });
});

describe("matchesKeyword", () => {
    it("matches case-insensitively and only when keywords exist", () => {
        expect(matchesKeyword("Daily Inbox", parseKeywords("inbox"))).toBe(true);
        expect(matchesKeyword("Daily notes", parseKeywords("inbox"))).toBe(false);
        expect(matchesKeyword("anything", [])).toBe(false);
    });
});

describe("pickIdleTabs", () => {
    it("keeps every tab that must not be closed", () => {
        const tabs = [
            candidate({id: "idle"}),
            candidate({id: "active", active: true}),
            candidate({id: "pinned", pinned: true}),
            candidate({id: "only", siblings: 1}),
            candidate({id: "unknown-time", lastActive: 0}),
            candidate({id: "fresh", lastActive: 1_000_000 - 1_000}),
            candidate({id: "keyword", title: "日记 2026-11-20"}),
            candidate({id: "no-panel", closeable: false}),
        ];
        const picked = pickIdleTabs(tabs, {
            now: 1_000_000,
            idleMs: 5 * MINUTE,
            keywords: parseKeywords("日记"),
        });
        expect(picked.map((tab) => tab.id)).toEqual(["idle"]);
    });

    it("returns the oldest idle tab first", () => {
        const tabs = [
            candidate({id: "newer", lastActive: 700_000}),
            candidate({id: "oldest", lastActive: 100}),
            candidate({id: "middle", lastActive: 690_000}),
        ];
        const picked = pickIdleTabs(tabs, {now: 1_000_000, idleMs: 5 * MINUTE, keywords: []});
        expect(picked.map((tab) => tab.id)).toEqual(["oldest", "middle", "newer"]);
    });

    it("treats the threshold as inclusive", () => {
        const tabs = [candidate({id: "edge", lastActive: 1_000_000 - 5 * MINUTE})];
        expect(pickIdleTabs(tabs, {now: 1_000_000, idleMs: 5 * MINUTE, keywords: []})).toHaveLength(1);
        expect(pickIdleTabs(tabs, {now: 1_000_000, idleMs: 5 * MINUTE + 1, keywords: []})).toHaveLength(0);
    });
});
