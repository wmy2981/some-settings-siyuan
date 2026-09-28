/**
 * 功能：用一个小的悬浮窗口取代思源的录音提示。
 *
 * 录音链路本身完全交给内核（权限、编码、上传、插入音频块都是思源自己的），
 * 这里只把那段「录音中…」的 toast 换成带计时与停止按钮的浮窗。
 * 原生录音器没有暂停语义，所以不提供暂停/继续。
 */
import {defineFeature} from "../../core/types";
import {mountRecordingWindow} from "./window";

export default defineFeature({
    id: "recording-window",
    category: "function",
    name: "feature.recordingWindow.name",
    description: "feature.recordingWindow.desc",
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            default: false,
        },
    ],
    mount: mountRecordingWindow,
});
