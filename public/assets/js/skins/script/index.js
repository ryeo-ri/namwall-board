import { createSkinDefinition } from "../skin-definition.js";
import { renderScriptDetail, renderScriptList } from "./renderer.js";
import { bindScriptViewer } from "./viewer.js";
import {
  bindScriptWriter,
  cleanupReplacedScriptArchive,
  prepareScriptWrite,
  renderArchiveField
} from "./writer.js";

const HIDDEN_ARCHIVE_FIELDS = [
  "archivePath", "archiveEncoding", "archiveVersion", "archiveId", "messageCount", "assetCount",
  "archivedAssetCount", "originalBytes", "normalizedBytes", "archiveBytes", "sourceFileName",
  "sourceType", "assetPathsJson"
].map((key) => ({ key: `script.${key}`, type: "hidden" }));

export const skin = createSkinDefinition({
  type: "SCRIPT",
  aliases: ["script", "trpg"],
  cssNamespace: "skin-script",
  boardOptionsSchema: {
    boardWidth: {
      type: "number",
      label: "게시판 가로",
      defaultValue: 1100,
      min: 1,
      step: 1,
      placeholder: "기본 1100 / 100 이하는 %",
      help: "목록과 플레이 로그 열람 화면의 최대 가로 폭입니다."
    },
    galleryColumns: {
      type: "number",
      label: "1줄 세션 수",
      defaultValue: 3,
      min: 1,
      max: 6,
      step: 1,
      placeholder: "기본 3",
      help: "한 줄에 표시할 세션 카드 수입니다."
    }
  },
  postFields: [
    { key: "script.system", label: "룰 시스템", type: "text", placeholder: "예: Call of Cthulhu 7th" },
    { key: "script.scenario", label: "시나리오", type: "text", placeholder: "시나리오 이름" },
    { key: "script.gm", label: "GM / KP", type: "text", placeholder: "진행자" },
    { key: "script.players", label: "PL / PC", type: "textarea", rows: 2, placeholder: "참가자와 캐릭터" },
    { key: "script.playedAt", label: "플레이 날짜", type: "date" },
    { key: "script.summary", label: "세션 요약", type: "textarea", rows: 3, placeholder: "목록과 상세 상단에 표시할 짧은 메모" },
    { key: "script.archiveUrl", label: "플레이 로그 HTML", type: "roll20Archive" },
    ...HIDDEN_ARCHIVE_FIELDS
  ],
  capabilities: {
    board: {
      deleteModeVariant: "board"
    },
    detail: {
      supportsComments: false,
      showThumbnail: true
    },
    write: {
      adminOnly: true,
      requiresTitle: true,
      requiresThumbnail: true,
      supportsContent: false,
      contentField: "contentHtml"
    }
  },
  renderPostField(context) {
    if (context.field.type !== "roll20Archive") return null;
    return renderArchiveField(context);
  },
  bindWriteFields(context) {
    bindScriptWriter(context);
  },
  prepareWrite(context) {
    return prepareScriptWrite(context);
  },
  afterWrite(context) {
    return cleanupReplacedScriptArchive(context);
  },
  renderBoardList(posts, board, options) {
    return renderScriptList(posts, board, options);
  },
  renderDetail(post) {
    return renderScriptDetail(post);
  },
  bindDetail(context) {
    return bindScriptViewer(context);
  },
  buildSkinData({ fieldData = {}, editingPost = null } = {}) {
    const script = fieldData.script && typeof fieldData.script === "object" ? { ...fieldData.script } : {};
    const previousScript = editingPost?.skinData?.script || {};
    const archiveWasReplaced = Boolean(
      previousScript.archivePath
      && script.archivePath
      && previousScript.archivePath !== script.archivePath
    );
    const assetPaths = parseJsonArray(script.assetPathsJson);
    delete script.assetPathsJson;
    return {
      script: {
        ...script,
        messageCount: toNumber(script.messageCount),
        assetCount: toNumber(script.assetCount),
        archivedAssetCount: toNumber(script.archivedAssetCount),
        originalBytes: toNumber(script.originalBytes),
        normalizedBytes: toNumber(script.normalizedBytes),
        archiveBytes: toNumber(script.archiveBytes),
        archiveVersion: toNumber(script.archiveVersion) || 1,
        assetPaths,
        archiveHistory: archiveWasReplaced ? [] : normalizeArchiveHistory(previousScript.archiveHistory)
      }
    };
  }
});

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch (_error) {
    return [];
  }
}

function normalizeArchiveHistory(value) {
  return Array.isArray(value)
    ? value.filter((entry) => entry && typeof entry === "object").map((entry) => ({ ...entry }))
    : [];
}

export default skin;
