/**
 * 功能：集市详情页「在线集市 - 版本」的版本号变成可点的链接，点开看这个版本的发行说明。
 *
 * 装饰的是那一行的**值单元格**：内核在切包、刷新评分、更新详情时都会整体重写这块 innerHTML，
 * 所以装饰靠一个 MutationObserver 反复补回去，并且是幂等的（已经装饰过、版本也没变就什么都不做，
 * 免得自己的写入又把自己叫醒，变成每帧一次的空转）。
 *
 * 弹窗顶部是历史版本下拉：默认选中集市里显示的这个版本，列表里最新的那个标「最新」。
 * 发行说明用思源自己的 Markdown 引擎（全局 Lute）渲染，再过一遍思源自己的 DOMPurify
 * —— 集市 README 走的也是这两步；两者任一不可用时退回纯文本，绝不把未处理的 HTML 塞进 DOM。
 */
import {Dialog} from "siyuan";
import {
    guardSilent,
    reportError,
} from "../../core/error";
import {isMobile} from "../../core/frontend";
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";
import {escapeHtml} from "../../core/ui";
import {
    fetchReleases,
    parseRepo,
} from "./releases";
import type {
    Release,
    ReleaseResult,
    RepoRef,
} from "./releases";

/** 我们自己注入的那个链接的标记：既当样式钩子，也当「这一格归我们管」的标记。 */
const LINK_ATTR = "data-ss-bazaar-notes";
/** 弹窗的作用域类名：只在这个弹窗里调布局，不碰思源自己的弹窗样式。 */
const CLASS = "ss-bazaar-notes";
/** 集市详情页的侧栏：`data-repourl` 与各节都挂在它下面。 */
const SIDE_SELECTOR = "#configBazaarReadme .item__side";

const CSS = `
/* 版本号本身：思源自己的全局 a 规则已经给了主色与下划线，这里只补上「可点」的指针。 */
a[${LINK_ATTR}] {
    cursor: pointer;
}

/* 头部固定、正文滚动；高度只在内容超过视口时才起作用。 */
.${CLASS} .b3-dialog__container {
    max-height: 85vh;
}

.${CLASS}__head {
    align-items: center;
    border-bottom: 1px solid var(--b3-theme-surface-lighter);
    display: flex;
    flex: 0 0 auto;
    gap: 8px;
    padding: 12px 24px;
}

.${CLASS}__label {
    color: var(--b3-theme-on-surface);
    flex: 0 0 auto;
}

.${CLASS}__select {
    flex: 1;
    min-width: 0;
}

.${CLASS}__body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 16px 24px;
}

/* 提示、以及渲染器不可用时的 Markdown 原文：都是整段文字，各自保留换行。 */
.${CLASS}__tip {
    color: var(--b3-theme-on-surface);
    white-space: pre-wrap;
}
`;

/** 一行说明文字。 */
const tipHtml = (text: string): string => `<div class="${CLASS}__tip">${escapeHtml(text)}</div>`;

/**
 * 两个版本号是不是同一个。
 *
 * 集市里显示的一律是 `v` + 清单里的版本号，而 tag 可能带 `v`（本仓库的 CD 就是）也可能不带，
 * 所以比之前先把前缀削掉，免得默认选中落到第一个（最新）而不是用户点开的那个。
 */
const sameVersion = (tag: string, version: string): boolean => tag.replace(/^v/i, "") === version.replace(/^v/i, "");

/**
 * 把发行说明的 Markdown 渲染成 HTML。
 *
 * 两步都借用思源自己的：Lute 是它的 Markdown 引擎（集市里的 README 就是内核用 Lute 渲染的），
 * DOMPurify 是它给网络来的 HTML 消毒用的库。两者任一不可用、或者渲染本身出错时返回 undefined，
 * 由调用方退回纯文本 —— 绝不让未处理的 HTML 进 DOM。
 */
const notesHtml = (markdown: string): string | undefined => {
    const lute = window.Lute;
    const purify = window.DOMPurify;
    if (!lute || !purify) {
        return undefined;
    }
    try {
        return purify.sanitize(lute.New().MarkdownStr("", markdown));
    } catch (error) {
        reportError("bazaar-release-notes.render", error, false);
        return undefined;
    }
};

export const mountBazaarReleaseNotes = (host: FeatureHost): FeatureInstance => {
    host.addStyle(CSS);

    const t = (key: string): string => host.i18n(key);
    /** 本次挂载期间取到的发行版列表：同一个仓库反复打开弹窗不再联网，禁用功能即失效。 */
    const cache = new Map<string, Release[]>();
    let observer: MutationObserver | undefined;
    let frame = 0;
    let dialog: Dialog | undefined;
    let destroyed = false;

    /** 「在线集市」那一节里「版本」那一行的值单元格；集市没在读某个包时返回 undefined。 */
    const versionCell = (side: HTMLElement): HTMLElement | undefined => {
        // 两处文案都取思源自己的语言包，免得跟着界面语言改代码
        const market = String(window.siyuan?.languages?.bazaarMarketInfo ?? "");
        const versionLabel = String(window.siyuan?.languages?.version ?? "");
        for (const section of Array.from(side.querySelectorAll<HTMLElement>(".item__meta-section"))) {
            if (section.querySelector(".item__meta-title")?.textContent?.trim() !== market) {
                continue;
            }
            for (const row of Array.from(section.querySelectorAll<HTMLElement>(".item__meta-row"))) {
                const cells = Array.from(row.children);
                if (cells.length === 2 && cells[0].textContent?.trim() === versionLabel) {
                    return cells[1] as HTMLElement;
                }
            }
        }
        return undefined;
    };

    /**
     * 从链接上现取仓库与版本再打开弹窗。
     *
     * 都从 DOM 现取、不做缓存：集市换到别的包、或者更新了版本号，拿到的一定是最新的那一个。
     */
    const openFrom = (link: HTMLAnchorElement): void => {
        const side = link.closest<HTMLElement>(".item__side");
        const repo = parseRepo(side?.getAttribute("data-repourl") ?? "");
        const version = link.textContent?.trim() ?? "";
        if (!repo || !version) {
            return;
        }
        openNotes(repo, version, side?.querySelector(".item__title")?.textContent?.trim() || repo.repo);
    };

    /** 用一个链接取代值单元格里的版本号文字。 */
    const versionLink = (version: string): HTMLAnchorElement => {
        const link = document.createElement("a");
        link.setAttribute(LINK_ATTR, "true");
        // 没有 href 的 a 不会自己拿到指针与键盘行为，这两件事自己补上
        link.setAttribute("role", "button");
        link.setAttribute("tabindex", "0");
        link.setAttribute("aria-label", t("bazaarReleaseNotes.tip").replace("{version}", () => version));
        link.textContent = version;
        link.addEventListener("click", () => openFrom(link));
        link.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" && event.key !== " ") {
                return;
            }
            event.preventDefault();
            openFrom(link);
        });
        return link;
    };

    /** 幂等地装饰当前这一格；不是 GitHub 仓库时什么都不做。 */
    const decorate = (): void => {
        const side = document.querySelector<HTMLElement>(SIDE_SELECTOR);
        const repo = side ? parseRepo(side.getAttribute("data-repourl") ?? "") : undefined;
        const cell = side && repo ? versionCell(side) : undefined;
        const version = cell?.textContent?.trim() ?? "";
        if (!cell || !version) {
            return;
        }
        const existing = cell.querySelector<HTMLAnchorElement>(`a[${LINK_ATTR}]`);
        if (existing) {
            // 已经装饰过：只有版本号变了才需要同步文字（点开时读的是 DOM，处理器不用换）
            if (existing.textContent !== version) {
                existing.textContent = version;
            }
            return;
        }
        cell.textContent = "";
        cell.append(versionLink(version));
    };

    /** 观察整个 body：集市重写详情页、切包、刷新评分都只是它的子节点变动。 */
    const observe = (): void => {
        if (destroyed) {
            return;
        }
        observer ??= new MutationObserver(schedule);
        observer.observe(document.body, {childList: true, subtree: true});
    };

    const apply = (): void => {
        // 我们自己的写入也会触发观察器，所以每次写入前后各摘挂一次
        guardSilent("bazaar-release-notes.observer", () => observer?.disconnect());
        try {
            decorate();
        } finally {
            observe();
        }
    };

    const schedule = (): void => {
        if (destroyed || frame) {
            return;
        }
        frame = window.requestAnimationFrame(() => {
            frame = 0;
            apply();
        });
    };

    /** 取某个仓库的发行版列表：本次挂载内缓存成功的结果，失败不缓存（再点一次还能重试）。 */
    const releasesOf = async (repo: RepoRef): Promise<ReleaseResult> => {
        const key = `${repo.owner}/${repo.repo}`;
        const cached = cache.get(key);
        if (cached) {
            return {releases: cached};
        }
        const result = await fetchReleases(repo, host.signal);
        if (result.releases) {
            cache.set(key, result.releases);
        }
        return result;
    };

    /** 把某个版本的发行说明渲染进弹窗正文。 */
    const renderNotes = (body: HTMLElement, releases: Release[], tag: string): void => {
        const release = releases.find((item) => sameVersion(item.tag, tag)) ?? releases[0];
        const notes = release.notes.trim();
        if (notes === "") {
            body.innerHTML = tipHtml(t("bazaarReleaseNotes.empty"));
            return;
        }
        // 渲染器不可用（或渲染出错）时退回 Markdown 原文，至少还能读
        body.innerHTML = notesHtml(notes) ?? tipHtml(notes);
    };

    /**
     * 打开发行说明弹窗。
     *
     * 先把窗口与「正在获取」摆出来，拿到数据再补上顶部的版本下拉 —— 网络在国内可能要几秒，
     * 先给反馈比先干等好。
     */
    const openNotes = (repo: RepoRef, version: string, name: string): void => {
        guardSilent("bazaar-release-notes.dialog", () => dialog?.destroy());
        const current = new Dialog({
            // 包名来自集市索引，是第三方文本，而宿主的 Dialog 把 title 直接拼进 innerHTML：
            // 必须转义。替换用回调形式，免得包名里带 `$&` 之类被当成替换模式。
            title: t("bazaarReleaseNotes.title").replace("{name}", () => escapeHtml(name)),
            width: isMobile() ? "92vw" : "600px",
            content: `<label class="${CLASS}__head fn__none"></label>
<div class="${CLASS}__body b3-typography">${tipHtml(t("bazaarReleaseNotes.loading"))}</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel" type="button" data-ss-close>${escapeHtml(t("common.close"))}</button>
</div>`,
            destroyCallback: () => {
                if (dialog === current) {
                    dialog = undefined;
                }
            },
        });
        dialog = current;
        current.element.classList.add(CLASS);
        current.element.querySelector<HTMLButtonElement>("[data-ss-close]")?.addEventListener(
            "click",
            () => current.destroy(),
        );
        const head = current.element.querySelector<HTMLElement>(`.${CLASS}__head`);
        const body = current.element.querySelector<HTMLElement>(`.${CLASS}__body`);
        if (!head || !body) {
            return;
        }
        void releasesOf(repo).then((result) => {
            // 窗口可能已经关掉、或者又开了一个新的
            if (dialog !== current) {
                return;
            }
            const releases = result.releases;
            if (!releases) {
                host.log(`release notes failed: ${result.reason ?? "unknown"}`);
                body.innerHTML = tipHtml(
                    t("bazaarReleaseNotes.failed").replace(
                        "{reason}",
                        result.reason || t("bazaarReleaseNotes.unknownError"),
                    ),
                );
                return;
            }
            if (releases.length === 0) {
                body.innerHTML = tipHtml(t("bazaarReleaseNotes.noReleases"));
                return;
            }
            // 列表已经按发布时间倒序，第一个就是最新版
            const latestTag = releases[0].tag;
            const options = releases.map((release) => {
                const label = release.tag === latestTag ?
                    `${release.tag} (${t("bazaarReleaseNotes.latest")})` :
                    release.tag;
                return `<option value="${escapeHtml(release.tag)}"${
                    sameVersion(release.tag, version) ? " selected" : ""
                }>${escapeHtml(label)}</option>`;
            }).join("");
            head.innerHTML = `<span class="${CLASS}__label">${escapeHtml(t("bazaarReleaseNotes.versionLabel"))}</span>
<select class="b3-select ${CLASS}__select">${options}</select>`;
            head.classList.remove("fn__none");
            const select = head.querySelector<HTMLSelectElement>("select");
            if (!select) {
                return;
            }
            select.addEventListener("change", () => renderNotes(body, releases, select.value));
            renderNotes(body, releases, select.value);
            host.log(`release notes loaded: ${releases.length} releases, showing ${select.value}`);
        });
    };

    apply();

    return {
        destroy: () => {
            if (destroyed) {
                return;
            }
            destroyed = true;
            if (frame) {
                window.cancelAnimationFrame(frame);
                frame = 0;
            }
            guardSilent("bazaar-release-notes.observer", () => observer?.disconnect());
            observer = undefined;
            guardSilent("bazaar-release-notes.dialog", () => dialog?.destroy());
            dialog = undefined;
            // 只把文字还回去，别人的行结构一个都不动
            document.querySelectorAll<HTMLAnchorElement>(`a[${LINK_ATTR}]`).forEach((link) => {
                link.replaceWith(document.createTextNode(link.textContent ?? ""));
            });
            cache.clear();
        },
    };
};
