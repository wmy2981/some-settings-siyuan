/**
 * 宿主版本判别。
 *
 * 功能里有一类是「上游补丁」：思源自己还没做，插件先补上；等上游做了，这份补丁就该退场，
 * 否则会和原生实现重复甚至打架，用户还多一个没有意义的开关。要判断它该不该退场，
 * 就得先知道「服务这份前端的思源是什么版本」。
 *
 * 版本号取 `window.siyuan.config.system.kernelVersion`：它由内核在启动时写进配置，
 * 桌面端是最准的；移动端与浏览器访问远程内核时拿到的是**服务这份前端的那一端**的版本，
 * 而这正是需要的答案——前端来自哪个版本，决定它有没有这份原生实现。
 *
 * 判定失败（读不到或认不出）时一律按「还没废弃」处理，并只告警一次：
 * 在需要这份补丁的旧版本上把它藏起来，比让它多显示一项糟糕得多。
 */
import type {FeatureDefinition} from "./types";

const PREFIX = "[some-settings-siyuan]";

export interface HostVersion {
    major: number;
    minor: number;
    patch: number;
    /** 预发布标识：`3.8.7-alpha.2` 解析成 `["alpha", "2"]`，正式版为空数组。 */
    prerelease: string[];
}

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** 解析版本号；不认识的写法返回 undefined。 */
export const parseVersion = (raw: string): HostVersion | undefined => {
    const match = VERSION_PATTERN.exec(raw.trim());
    if (!match) {
        return undefined;
    }
    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
        prerelease: match[4] ? match[4].split(".") : [],
    };
};

/** 预发布标识比较：纯数字按数值比、非数字按字典序，数字永远小于非数字。 */
const comparePrerelease = (a: string[], b: string[]): number => {
    const shared = Math.min(a.length, b.length);
    for (let index = 0; index < shared; index += 1) {
        const left = a[index];
        const right = b[index];
        if (left === right) {
            continue;
        }
        const leftNumber = /^\d+$/.test(left) ? Number(left) : undefined;
        const rightNumber = /^\d+$/.test(right) ? Number(right) : undefined;
        if (leftNumber !== undefined && rightNumber !== undefined) {
            return leftNumber - rightNumber;
        }
        if (leftNumber !== undefined || rightNumber !== undefined) {
            return leftNumber !== undefined ? -1 : 1;
        }
        return left < right ? -1 : 1;
    }
    return a.length - b.length;
};

/** semver 比较：a 小于 b 返回负数、相等返回 0、大于返回正数。 */
export const compareVersion = (a: HostVersion, b: HostVersion): number => {
    if (a.major !== b.major) {
        return a.major - b.major;
    }
    if (a.minor !== b.minor) {
        return a.minor - b.minor;
    }
    if (a.patch !== b.patch) {
        return a.patch - b.patch;
    }
    // 带预发布标识的版本小于同号正式版：3.8.7-alpha.2 < 3.8.7
    if (a.prerelease.length === 0 || b.prerelease.length === 0) {
        return b.prerelease.length - a.prerelease.length;
    }
    return comparePrerelease(a.prerelease, b.prerelease);
};

/** 当前宿主的版本号；读不到或认不出时返回 undefined。 */
export const hostVersion = (): HostVersion | undefined => {
    const raw = window.siyuan?.config?.system?.kernelVersion;
    return typeof raw === "string" && raw ? parseVersion(raw) : undefined;
};

/** 判定失败的告警去重表：同一个功能只提示一次。 */
const warned = new Set<string>();

/**
 * 该功能在当前宿主上是否仍然需要。
 *
 * 没声明 `deprecatedSince` 的功能恒为真；声明了则要求宿主版本低于它 ——
 * 到那个版本（含）为止，上游已经自己实现了。
 */
export const supportsCurrentHost = (definition: FeatureDefinition): boolean => {
    const since = definition.deprecatedSince;
    if (!since) {
        return true;
    }
    const declared = parseVersion(since);
    const current = hostVersion();
    if (!declared || !current) {
        if (!warned.has(definition.id)) {
            warned.add(definition.id);
            console.warn(
                `${PREFIX} cannot tell whether "${definition.id}" is obsolete: the host reports kernelVersion ${
                    JSON.stringify(window.siyuan?.config?.system?.kernelVersion)
                } and it would be obsolete since ${JSON.stringify(since)}, keeping the feature available`,
            );
        }
        return true;
    }
    return compareVersion(current, declared) < 0;
};
