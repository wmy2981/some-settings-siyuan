/**
 * feature-control.json 的读取、校验与四态归一化。
 *
 * 这个文件是「可独立启停」的唯一权威入口：任何功能是否加载配置、是否显示设置界面、
 * 是否真正运行，都只由这里读到的状态决定。
 *
 * 容错原则：缺失、非法、未知一律按 0（不加载不显示）处理，并只告警一次，
 * 保证清单写错时插件本身仍能正常工作。
 */
import rawControl from "../../feature-control.json";
import {ControlState} from "./types";

const PREFIX = "[some-settings-siyuan]";

/** 归一化后的四态。 */
export interface ResolvedControl {
    /** 是否读取磁盘上已有的配置；为假时只使用 schema 默认值，且不回写。 */
    loadEnabled: boolean;
    /** 是否在设置面板里显示并允许修改。 */
    showUi: boolean;
    /** 是否真正运行该功能。 */
    mountEnabled: boolean;
}

/** 归一化后的四态加上原始 state，供设置面板展示与片段导出。 */
export interface ControlSnapshot extends ResolvedControl {
    state: ControlState;
}

const resolveState = (state: ControlState): ResolvedControl => ({
    loadEnabled: state === ControlState.Enabled || state === ControlState.Hidden,
    showUi: state === ControlState.Enabled || state === ControlState.ConfigurationOnly,
    mountEnabled: state === ControlState.Enabled || state === ControlState.Hidden,
});

const isControlState = (value: unknown): value is ControlState =>
    value === ControlState.Disabled || value === ControlState.Enabled ||
    value === ControlState.Hidden || value === ControlState.ConfigurationOnly;

interface RawControlFile {
    version?: number;
    features?: Record<string, {state?: unknown;}>;
}

const rawFile = rawControl as RawControlFile;
const rawFeatures: Record<string, {state?: unknown;}> =
    rawFile && typeof rawFile.features === "object" && rawFile.features !== null ? rawFile.features : {};

/** 告警去重表：同一个问题只提示一次，避免每次读取配置都刷屏。 */
const warnings = new Map<string, string>();
const warned = new Set<string>();

const warnOnce = (key: string, message: string): void => {
    if (warned.has(key)) {
        return;
    }
    warned.add(key);
    warnings.set(key, message);
};

/** 读原始的、未经任何容错的 state 值；只在校验脚本和告警里使用。 */
export const rawStates = (): Record<string, unknown> => {
    const states: Record<string, unknown> = {};
    Object.keys(rawFeatures).forEach((id) => {
        states[id] = rawFeatures[id]?.state;
    });
    return states;
};

/**
 * 取某个功能的归一化状态。
 * @param id 功能 id（等于文件夹名）
 */
export const controlOf = (id: string): ResolvedControl => {
    const entry = rawFeatures[id];
    if (!entry) {
        warnOnce(`missing:${id}`, `feature-control.json 缺少 "${id}"，按 0 处理（不加载配置、前端不显示）`);
        return resolveState(ControlState.Disabled);
    }
    if (!isControlState(entry.state)) {
        warnOnce(
            `invalid:${id}`,
            `feature-control.json 中 "${id}" 的 state=${JSON.stringify(entry.state)} 非法，按 0 处理；合法值为 0/1/2/3`,
        );
        return resolveState(ControlState.Disabled);
    }
    return resolveState(entry.state);
};

/** 取带原始 state 的快照，供设置面板展示与片段导出。 */
export const controlSnapshot = (id: string): ControlSnapshot => {
    const resolved = controlOf(id);
    const entry = rawFeatures[id];
    return {...resolved, state: isControlState(entry?.state) ? entry.state : ControlState.Disabled};
};

/**
 * 在注册表就绪后调用：把所有功能都过一遍，收集告警并一次性打印。
 * @param ids 注册表里的全部功能 id
 */
export const validateControl = (ids: string[]): void => {
    ids.forEach((id) => controlOf(id));
    Object.keys(rawFeatures).forEach((id) => {
        if (!ids.includes(id)) {
            warnOnce(`unknown:${id}`, `feature-control.json 中的 "${id}" 没有对应的功能注册，该条被忽略`);
        }
    });
    const messages = [...warnings.values()];
    warnings.clear();
    if (messages.length > 0) {
        console.warn(`${PREFIX} feature-control.json 存在 ${messages.length} 个问题：`);
        messages.forEach((warning) => console.warn(`${PREFIX} - ${warning}`));
    }
};
