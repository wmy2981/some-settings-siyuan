// 检查 siyuan-note/siyuan 的新发行版，把可能影响本仓库功能的更新开成 issue。
// 只读写 GitHub，不调用思源本地 API；任何环节失败都直接抛错，让 workflow 失败退出。
//
// 本地调试（不写任何数据）：
//   GH_TOKEN=$(gh auth token) GITHUB_REPOSITORY=wmy2981/some-settings-siyuan DRY_RUN=1 node scripts/check-siyuan-releases.mjs
import {readFileSync} from "node:fs";
import {
    dirname,
    join,
} from "node:path";
import {fileURLToPath} from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const API_ROOT = "https://api.github.com";
const UPSTREAM_REPO = "siyuan-note/siyuan";
const LABEL = "auto-check";
const LABEL_COLOR = "fbca04";
const LABEL_DESCRIPTION = "Created by the SiYuan release compatibility workflow";
const BOT_LOGIN = "github-actions[bot]";
const TITLE_PREFIX = "Siyuan Updated to v";
const TITLE_PATTERN = /^Siyuan Updated to v(.+)$/;

// feature 键按 - 切开后的短片段白名单：这些词长度不足 3 也保留为关键词
const SHORT_KEYWORDS = new Set(["id"]);

// 关键词黑名单：即使来自 feature 键也不参与匹配的片段。分三类：
//   平台词：发行说明里到处都是，和具体功能无关
//   无区分度片段：note 命中的是每条链接里的 siyuan-note，log 命中的是 dialog / Changelogs / b3log，
//     auto 和 height 命中的是发行说明头部徽章 HTML 里的 CSS
// 拉黑后每个功能至少还剩一个关键词（例如 mobile-ref-panel-height 还剩 panel）
const BLACKLIST = new Set([
    "always",
    "never",
    "often",
    "support",
    "allow",
    "server",
    "kernel",
    "mobile",
    "desktop",
    "windows",
    "mac",
    "macos",
    "linux",
    "android",
    "ios",
    "ipad",
    "harmony",
    "open",
    "log",
    "note",
    "siyuan",
    "auto",
    "height",
]);

const TOKEN = process.env.GH_TOKEN;
const REPOSITORY = process.env.GITHUB_REPOSITORY;
const DRY_RUN = process.env.DRY_RUN === "1";

const request = async (path, {method = "GET", body, allowNotFound = false} = {}) => {
    const response = await fetch(`${API_ROOT}${path}`, {
        method,
        headers: {
            accept: "application/vnd.github+json",
            authorization: `Bearer ${TOKEN}`,
            "content-type": "application/json",
            "x-github-api-version": "2022-11-28",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (allowNotFound && response.status === 404) {
        return null;
    }
    if (!response.ok) {
        throw new Error(`${method} ${path} -> ${response.status} ${await response.text()}`);
    }
    return response.json();
};

const listAll = async (path, params = {}) => {
    const items = [];
    for (let page = 1;; page++) {
        const search = new URLSearchParams({per_page: "100", page: String(page), ...params});
        const batch = await request(`${path}?${search}`);
        items.push(...batch);
        if (batch.length < 100) {
            return items;
        }
    }
};

const readJsonFile = (name) => {
    try {
        return JSON.parse(readFileSync(join(ROOT, name), "utf8"));
    } catch (error) {
        throw new Error(`failed to read ${name}: ${error.message}`, {cause: error});
    }
};

// 关键词只来自 feature 键：按 - 切开、去空片段、转小写、去重、排除长度 1 或 2 的词
const buildKeywords = (features) => {
    const keywords = new Set();
    for (const id of Object.keys(features)) {
        for (const part of id.split("-")) {
            const keyword = part.toLowerCase();
            if (keyword === "" || BLACKLIST.has(keyword) || (keyword.length < 3 && !SHORT_KEYWORDS.has(keyword))) {
                continue;
            }
            keywords.add(keyword);
        }
    }
    return [...keywords];
};

// published_at 是 ISO 8601 字符串，字典序就是时间序
const byPublishedAt = (left, right) => {
    if (left.publishedAt === right.publishedAt) {
        return 0;
    }
    return left.publishedAt < right.publishedAt ? -1 : 1;
};

// 发行版一律按发布时间升序排列，不用版本号排序：预发行版的语义版本号排序不可靠
const fetchReleases = async () => {
    const releases = await listAll(`/repos/${UPSTREAM_REPO}/releases`);
    return releases
        .filter((release) => !release.draft)
        .map((release) => ({
            tag: release.tag_name,
            version: release.tag_name.replace(/^v/, ""),
            url: release.html_url,
            publishedAt: release.published_at,
            body: release.body ?? "",
        }))
        .sort(byPublishedAt);
};

// 本仓库已提交的自动检查 issue 标题，open 与 closed 都算已处理
const fetchHandledTitles = async () => {
    const issues = await listAll(`/repos/${REPOSITORY}/issues`, {state: "all", labels: LABEL});
    return new Set(
        issues
            .filter((issue) => !issue.pull_request && issue.user?.login === BOT_LOGIN)
            .map((issue) => issue.title),
    );
};

// 段比较：数字段按数值，其余按字符串，缺段更小（alpha.9 < alpha.10）
const compareSegments = (left, right) => {
    for (let index = 0; index < Math.max(left.length, right.length); index++) {
        const a = left[index];
        const b = right[index];
        if (a === undefined || b === undefined) {
            return a === b ? 0 : a === undefined ? -1 : 1;
        }
        if (a === b) {
            continue;
        }
        const numeric = Number(a) - Number(b);
        return Number.isNaN(numeric) || numeric === 0 ? (a < b ? -1 : 1) : Math.sign(numeric);
    }
    return 0;
};

// 3.8.6、3.8.6-alpha.4 这类版本号比较，只在 minAppVersion 不在发行列表里时用到
const compareVersions = (left, right) => {
    const parse = (version) => {
        const [base, ...prerelease] = version.split("-");
        return [base.split("."), prerelease.length > 0 ? prerelease.join("-").split(".") : null];
    };
    const [leftBase, leftPrerelease] = parse(left);
    const [rightBase, rightPrerelease] = parse(right);
    const base = compareSegments(leftBase, rightBase);
    if (base !== 0) {
        return base;
    }
    if (leftPrerelease === null || rightPrerelease === null) {
        // 同号正式版大于预发行版
        return leftPrerelease === rightPrerelease ? 0 : leftPrerelease === null ? 1 : -1;
    }
    return compareSegments(leftPrerelease, rightPrerelease);
};

// 上次已处理版本：优先取已提交 issue 中发布时间最晚的一个，否则回退到 minAppVersion
const selectPending = (releases, handledVersions, minAppVersion) => {
    const byVersion = new Map(releases.map((release) => [release.version, release]));
    const handled = [...handledVersions].map((version) => byVersion.get(version)).filter(Boolean);
    if (handled.length > 0) {
        const latest = handled.reduce((left, right) => (byPublishedAt(left, right) > 0 ? left : right));
        return releases.filter((release) => byPublishedAt(release, latest) > 0);
    }
    const anchor = byVersion.get(minAppVersion);
    if (anchor) {
        return releases.filter((release) => byPublishedAt(release, anchor) > 0);
    }
    return releases.filter((release) => compareVersions(release.version, minAppVersion) > 0);
};

// 发行说明 diff：只取当前 release 相比上一个 release 的新增行，不识别删除和修改
const diffLines = (body, previousBody) => {
    const previous = new Set(previousBody.split("\n").map((line) => line.trim()));
    return body
        .split("\n")
        .map((line) => line.replace(/\r$/, ""))
        .filter((line) => line.trim() !== "" && !previous.has(line.trim()));
};

const matchesKeyword = (line, keywords) => {
    const lower = line.toLowerCase();
    return keywords.some((keyword) => lower.includes(keyword));
};

// 条目里的上游链接会在对方仓库的时间线上留下跨仓库引用，统一改成对应列表的搜索页：
// issue 走 issues?q=、pull 走 pulls?q=。搜索页不是详情页，不会产生引用；
// 查询不带状态限定，已经关闭的 issue 也能搜到
const rewriteUpstreamLinks = (line) =>
    line.replace(
        /https:\/\/github\.com\/siyuan-note\/siyuan\/(issues|pull)\/(\d+)/g,
        (match, path, number) =>
            `https://github.com/siyuan-note/siyuan/${path === "pull" ? "pulls" : "issues"}?q=${number}`,
    );

// 展示层：原始行本身已是 Markdown，列表行、缩进续行、标题、HTML 一律原样保留，
// 只有纯文本段落补上列表符号，让条目逐条列出而不是挤成整段散文
const asEntry = (line) => {
    if (/^\s/.test(line) || /^#{1,6}\s/.test(line) || line.startsWith("<") || /^([*-+]|\d+[.)])\s/.test(line)) {
        return line;
    }
    return `- ${line}`;
};

// 按块类型分行：HTML 行不跟列表分行的话，会按 Markdown 规则吞掉紧随其后的列表
const blockKind = (line) => {
    if (/^#{1,6}\s/.test(line)) {
        return "heading";
    }
    if (line.startsWith("<")) {
        return "html";
    }
    return "list";
};

const groupBlocks = (lines) => {
    const blocks = [];
    let kind = "";
    for (const line of lines) {
        // 缩进行是上一行的续行（嵌套列表、缩进代码），跟着当前块走
        const current = /^\s/.test(line) ? kind : blockKind(line);
        if (blocks.length === 0 || current !== kind) {
            blocks.push([]);
            kind = current;
        }
        blocks[blocks.length - 1].push(line);
    }
    return blocks.map((block) => block.join("\n"));
};

const renderBody = (release, lines) =>
    [
        "本 issue 由自动工作流创建，用于提醒开发者：思源发布了新版本，以下更新可能影响本仓库已有功能。请及时检查兼容性并适配。",
        "This issue was created by an automated workflow to remind developers that a new SiYuan release may affect existing features in this repository. Please check compatibility and adapt as needed.",
        "---",
        "### 以下更新可能影响已有功能\n\nThe following updates may affect existing features:",
        ...groupBlocks(lines.map((line) => asEntry(rewriteUpstreamLinks(line)))),
        "---",
        `原始发行说明：${release.url}\n\nOriginal release notes: ${release.url}`,
    ].join("\n\n") + "\n";

const ensureLabel = async () => {
    const label = await request(`/repos/${REPOSITORY}/labels/${encodeURIComponent(LABEL)}`, {allowNotFound: true});
    if (label) {
        return;
    }
    await request(`/repos/${REPOSITORY}/labels`, {
        method: "POST",
        body: {name: LABEL, color: LABEL_COLOR, description: LABEL_DESCRIPTION},
    });
    console.log(`created label ${LABEL}`);
};

const main = async () => {
    if (!TOKEN || !REPOSITORY) {
        throw new Error("GH_TOKEN and GITHUB_REPOSITORY are required");
    }

    const features = readJsonFile("feature-control.json")?.features;
    if (features === null || typeof features !== "object" || Array.isArray(features)) {
        throw new Error("feature-control.json: features is not an object");
    }
    const minAppVersion = readJsonFile("plugin.json")?.minAppVersion;
    if (typeof minAppVersion !== "string" || minAppVersion === "") {
        throw new Error("plugin.json: minAppVersion is missing");
    }

    const keywords = buildKeywords(features);
    console.log(`keywords (${keywords.length}): ${keywords.join(" ")}`);

    const releases = await fetchReleases();
    console.log(`releases: ${releases.length}`);

    const handledTitles = await fetchHandledTitles();
    const handledVersions = new Set();
    for (const title of handledTitles) {
        const matched = TITLE_PATTERN.exec(title);
        if (matched) {
            handledVersions.add(matched[1]);
        }
    }
    console.log(`handled: ${handledVersions.size === 0 ? "(none)" : [...handledVersions].join(" ")}`);

    const pending = selectPending(releases, handledVersions, minAppVersion);
    console.log(`pending: ${pending.length === 0 ? "(none)" : pending.map((release) => release.tag).join(" ")}`);

    for (const release of pending) {
        const index = releases.indexOf(release);
        const lines = diffLines(release.body, releases[index - 1]?.body ?? "").filter((line) =>
            matchesKeyword(line, keywords)
        );
        if (lines.length === 0) {
            console.log(`${release.tag}: no matching line, skip`);
            continue;
        }
        const title = `${TITLE_PREFIX}${release.version}`;
        if (handledTitles.has(title)) {
            console.log(`${release.tag}: ${title} already exists, skip`);
            continue;
        }
        const body = renderBody(release, lines);
        if (DRY_RUN) {
            console.log(`--- ${title} (dry run) ---\n${body}`);
            continue;
        }
        await ensureLabel();
        const issue = await request(`/repos/${REPOSITORY}/issues`, {
            method: "POST",
            body: {title, body, labels: [LABEL]},
        });
        console.log(`${release.tag}: created #${issue.number} ${issue.html_url}`);
    }
};

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
