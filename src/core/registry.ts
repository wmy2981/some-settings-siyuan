/**
 * 功能注册表。
 *
 * 这是**唯一**一个静态导入所有功能的文件：新增一个功能只需要在这里加一行导入
 * 并放进数组（顺序即设置面板里的显示顺序），其他地方都不用动。
 *
 * 功能之间不得互相 import；跨功能协作只能经由 src/core/。
 */
import codeBlockLangEmpty from "../features/code-block-lang-empty";
import dailyNoteDirect from "../features/daily-note-direct";
import docTreeOpenedAccent from "../features/doc-tree-opened-accent";
import externalLinkConfirm from "../features/external-link-confirm";
import firstDocIcon from "../features/first-doc-icon";
import hideMobileExit from "../features/hide-mobile-exit";
import hideMobileSidebarItems from "../features/hide-mobile-sidebar-items";
import kernelAutoReconnect from "../features/kernel-auto-reconnect";
import kernelReconnectButton from "../features/kernel-reconnect-button";
import mobileBarAnimation from "../features/mobile-bar-animation";
import mobileDockBlur from "../features/mobile-dock-blur";
import mobileRefPanelHeight from "../features/mobile-ref-panel-height";
import mobileSelectNative from "../features/mobile-select-native";
import mobileSidebarBlur from "../features/mobile-sidebar-blur";
import mobileSlashInsertPanel from "../features/mobile-slash-insert-panel";
import mobileSyncButton from "../features/mobile-sync-button";
import mobileTabDocIcon from "../features/mobile-tab-doc-icon";
import modalBlur from "../features/modal-blur";
import type {
    FeatureCategory,
    FeatureDefinition,
} from "./types";
import {FEATURE_CATEGORIES} from "./types";

export const FEATURES: FeatureDefinition[] = [
    codeBlockLangEmpty,
    modalBlur,
    docTreeOpenedAccent,
    mobileSidebarBlur,
    mobileDockBlur,
    mobileBarAnimation,
    mobileSyncButton,
    hideMobileExit,
    dailyNoteDirect,
    firstDocIcon,
    externalLinkConfirm,
    kernelReconnectButton,
    kernelAutoReconnect,
    mobileSlashInsertPanel,
    hideMobileSidebarItems,
    mobileRefPanelHeight,
    mobileTabDocIcon,
    mobileSelectNative,
];

export const ALL_FEATURE_IDS: string[] = FEATURES.map((feature) => feature.id);

export const featureById = (id: string): FeatureDefinition | undefined => FEATURES.find((feature) => feature.id === id);

/** 按分类取功能，顺序与 FEATURES 一致。 */
export const featuresOf = (category: FeatureCategory): FeatureDefinition[] =>
    FEATURES.filter((feature) => feature.category === category);

export const categoryOrder: FeatureCategory[] = FEATURE_CATEGORIES;
