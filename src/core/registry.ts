/**
 * 功能注册表。
 *
 * 这是**唯一**一个静态导入所有功能的文件：新增一个功能只需要在这里加一行导入
 * 并放进数组（顺序即设置面板里的显示顺序），其他地方都不用动。
 *
 * 功能之间不得互相 import；跨功能协作只能经由 src/core/。
 */
import modalBlur from "../features/modal-blur";
import type {
    FeatureCategory,
    FeatureDefinition,
} from "./types";
import {FEATURE_CATEGORIES} from "./types";

export const FEATURES: FeatureDefinition[] = [
    modalBlur,
];

export const ALL_FEATURE_IDS: string[] = FEATURES.map((feature) => feature.id);

export const featureById = (id: string): FeatureDefinition | undefined => FEATURES.find((feature) => feature.id === id);

/** 按分类取功能，顺序与 FEATURES 一致。 */
export const featuresOf = (category: FeatureCategory): FeatureDefinition[] =>
    FEATURES.filter((feature) => feature.category === category);

export const categoryOrder: FeatureCategory[] = FEATURE_CATEGORIES;
