/**
 * 功能注册表。
 *
 * 这是**唯一**一个静态导入所有功能的文件：新增一个功能只需要在这里加一行导入
 * 并放进数组（顺序即设置面板里的显示顺序），其他地方都不用动。
 *
 * 功能之间不得互相 import；跨功能协作只能经由 src/core/。
 */
import agentEnterToSend from "../features/agent-enter-to-send";
import agentThinkingStickyHeader from "../features/agent-thinking-sticky-header";
import agentToolCallDetail from "../features/agent-tool-call-detail";
import assetInfoMenu from "../features/asset-info-menu";
import assetsNewFile from "../features/assets-new-file";
import bazaarAuthorBlocklist from "../features/bazaar-author-blocklist";
import bazaarCustomIcon from "../features/bazaar-custom-icon";
import bookmarkLastPosition from "../features/bookmark-last-position";
import clearConfig from "../features/clear-config";
import codeBlockLangEmpty from "../features/code-block-lang-empty";
import codeSnippetHighlight from "../features/code-snippet-highlight";
import configTransfer from "../features/config-transfer";
import dailyNoteDirect from "../features/daily-note-direct";
import deepseekBalance from "../features/deepseek-balance";
import desktopCommandPanelSlim from "../features/desktop-command-panel-slim";
import devtoolsHotkey from "../features/devtools-hotkey";
import docTreeOpenedAccent from "../features/doc-tree-opened-accent";
import docTreeTitleMarkdown from "../features/doc-tree-title-markdown";
import exitConfirm from "../features/exit-confirm";
import externalLinkConfirm from "../features/external-link-confirm";
import firstDocIcon from "../features/first-doc-icon";
import headingLevelIcon from "../features/heading-level-icon";
import hideAgentWelcomeExamples from "../features/hide-agent-welcome-examples";
import hideBazaarDownloadedDonate from "../features/hide-bazaar-downloaded-donate";
import hideMobileExit from "../features/hide-mobile-exit";
import hideSelectionToolbar from "../features/hide-selection-toolbar";
import inlineCodeCopy from "../features/inline-code-copy";
import kernelAutoReconnect from "../features/kernel-auto-reconnect";
import kernelReconnectButton from "../features/kernel-reconnect-button";
import logOutput from "../features/log-output";
import mobileBarAnimation from "../features/mobile-bar-animation";
import mobileBlockIconAlways from "../features/mobile-block-icon-always";
import mobileConsoleLog from "../features/mobile-console-log";
import mobileDocTreeTitleSize from "../features/mobile-doc-tree-title-size";
import mobileDockBlur from "../features/mobile-dock-blur";
import mobileLongpressMenuLabel from "../features/mobile-longpress-menu-label";
import mobileRefPanelHeight from "../features/mobile-ref-panel-height";
import mobileSelectNative from "../features/mobile-select-native";
import mobileSyncButton from "../features/mobile-sync-button";
import modalBlur from "../features/modal-blur";
import newDocFixedTarget from "../features/new-doc-fixed-target";
import ossUsage from "../features/oss-usage";
import pluginReminder from "../features/plugin-reminder";
import recordingWindow from "../features/recording-window";
import refCrumbsGuide from "../features/ref-crumbs-guide";
import tabTitleMarkdown from "../features/tab-title-markdown";
import {supportsCurrentFrontend} from "./frontend";
import type {
    FeatureCategory,
    FeatureDefinition,
} from "./types";
import {FEATURE_CATEGORIES} from "./types";
import {supportsCurrentHost} from "./version";

export const FEATURES: FeatureDefinition[] = [
    // 第一个必须是「日志输出」：功能装载器按这个顺序挂载，它挂载时才打开详细日志，
    // 排在后面的话，它前面那些功能的装载日志会被开关吞掉。
    logOutput,
    codeBlockLangEmpty,
    assetInfoMenu,
    assetsNewFile,
    bookmarkLastPosition,
    recordingWindow,
    exitConfirm,
    modalBlur,
    docTreeOpenedAccent,
    docTreeTitleMarkdown,
    tabTitleMarkdown,
    headingLevelIcon,
    bazaarCustomIcon,
    hideBazaarDownloadedDonate,
    bazaarAuthorBlocklist,
    mobileDockBlur,
    mobileDocTreeTitleSize,
    mobileBarAnimation,
    mobileSyncButton,
    hideMobileExit,
    hideAgentWelcomeExamples,
    agentEnterToSend,
    agentThinkingStickyHeader,
    agentToolCallDetail,
    refCrumbsGuide,
    dailyNoteDirect,
    newDocFixedTarget,
    firstDocIcon,
    externalLinkConfirm,
    kernelReconnectButton,
    kernelAutoReconnect,
    deepseekBalance,
    ossUsage,
    mobileRefPanelHeight,
    mobileSelectNative,
    mobileLongpressMenuLabel,
    mobileBlockIconAlways,
    inlineCodeCopy,
    hideSelectionToolbar,
    desktopCommandPanelSlim,
    codeSnippetHighlight,
    devtoolsHotkey,
    mobileConsoleLog,
    configTransfer,
    clearConfig,
    pluginReminder,
];

export const ALL_FEATURE_IDS: string[] = FEATURES.map((feature) => feature.id);

/**
 * 本宿主上仍然生效的功能：声明里 enabled 为真、适用于当前前端，且宿主版本落在
 * 它声明的支持区间里。
 *
 * 配置装载与设置面板都只认这份清单 —— 判定必须只有一处，
 * 否则会出现「面板里显示了、但功能没挂载」这种两边不一致的状态。
 */
export const activeFeatures = (): FeatureDefinition[] =>
    FEATURES.filter((feature) => feature.enabled && supportsCurrentFrontend(feature) && supportsCurrentHost(feature));

export const featureById = (id: string): FeatureDefinition | undefined => FEATURES.find((feature) => feature.id === id);

/** 按分类取功能，顺序与 FEATURES 一致。 */
export const featuresOf = (category: FeatureCategory): FeatureDefinition[] =>
    FEATURES.filter((feature) => feature.category === category);

export const categoryOrder: FeatureCategory[] = FEATURE_CATEGORIES;
