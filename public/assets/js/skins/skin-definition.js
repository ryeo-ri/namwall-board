export const DEFAULT_SKIN_TYPE = "BOARD";

const DEFAULT_CAPABILITIES = {
  board: {
    supportsSearchSort: false,
    useCursorPagination: false,
    deleteModeVariant: "none",
    initLightbox: true
  },
  detail: {
    supportsComments: true,
    showThumbnail: false,
    renderBodyImmediately: true
  },
  write: {
    supportsTitle: true,
    requiresTitle: false,
    supportsLogFields: false,
    autoLogNumber: false,
    supportsGalleryFields: false,
    requiresThumbnail: false,
    supportsSource: false,
    contentPlaceholder: "본문",
    contentField: "contentHtml"
  }
};

const DEFAULT_SKIN_OPTIONS_SCHEMA = Object.freeze({});
const DEFAULT_POST_FIELDS = Object.freeze([]);

export function normalizeSkinType(value, fallback = DEFAULT_SKIN_TYPE) {
  const normalized = String(value || fallback).trim().toUpperCase();
  return normalized || fallback;
}

export function createSkinDefinition(definition = {}) {
  const type = normalizeSkinType(definition.type, DEFAULT_SKIN_TYPE);
  const renderList = definition.renderList || definition.renderBoardList || ((posts) => `<div class="notice">${type} 스킨 렌더러가 없습니다. (${posts.length})</div>`);
  return {
    type,
    aliases: Array.isArray(definition.aliases) ? definition.aliases.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean) : [],
    stylesheets: Array.isArray(definition.stylesheets) ? definition.stylesheets.filter(Boolean) : [],
    cssNamespace: String(definition.cssNamespace || `skin-${type.toLowerCase()}`).trim(),
    boardOptionsSchema: definition.boardOptionsSchema || DEFAULT_SKIN_OPTIONS_SCHEMA,
    postFields: Array.isArray(definition.postFields) ? definition.postFields.slice() : DEFAULT_POST_FIELDS,
    renderList,
    renderDetail: definition.renderDetail || null,
    renderWriteFields: Array.isArray(definition.renderWriteFields) ? definition.renderWriteFields.slice() : [],
    capabilities: mergeCapabilities(DEFAULT_CAPABILITIES, definition.capabilities || {}),
    renderBoardList: definition.renderBoardList || renderList
  };
}

function mergeCapabilities(base, incoming) {
  return {
    board: {
      ...base.board,
      ...(incoming.board || {})
    },
    detail: {
      ...base.detail,
      ...(incoming.detail || {})
    },
    write: {
      ...base.write,
      ...(incoming.write || {})
    }
  };
}

