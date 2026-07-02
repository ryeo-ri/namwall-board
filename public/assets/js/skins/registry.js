import { DEFAULT_SKIN_TYPE, normalizeSkinType } from "./skin-definition.js";

const SKIN_CATALOG = [
  { type: "BOARD", folder: "board", aliases: ["board"], description: "Default board" },
  { type: "LOG", folder: "log", aliases: ["log"], description: "Log feed" },
  { type: "GALLERY", folder: "gallery", aliases: ["gal", "gallery"], description: "Gallery board" },
  { type: "PROFILE", folder: "profile", aliases: ["profile"], description: "Profile board" }
];

const HIDDEN_SKIN_TYPES = new Set(["PROFILE"]);

const SKIN_META_BY_TYPE = new Map(
  SKIN_CATALOG.map((entry) => [entry.type, Object.freeze({ ...entry })])
);

const skinCache = new Map();
const stylesheetCache = new Set();

function isPlainObject(value) {
  return Boolean(value) && Object.prototype.toString.call(value) === "[object Object]";
}

function clonePlainObject(value) {
  return isPlainObject(value) ? { ...value } : {};
}

function getLegacyBoardWidth(board, skinType) {
  if (!board) return undefined;
  if (skinType === "BOARD") return board.boardBoardWidth;
  if (skinType === "GALLERY") return board.galleryBoardWidth;
  if (skinType === "LOG") return board.logBoardWidth;
  return board.boardBoardWidth ?? board.galleryBoardWidth ?? board.logBoardWidth;
}

function getLegacyGalleryColumns(board) {
  return board?.galleryColumns ?? board?.columns;
}

function getLegacyLogImageWidth(board) {
  return board?.logImageWidth ?? board?.imageWidth;
}

function getLegacyLogCommentPosition(board) {
  return board?.logCommentPosition ?? board?.commentPosition ?? board?.logCommentLayout;
}

function normalizeProfileSkinData(value = {}, post = {}) {
  const source = clonePlainObject(value);
  const legacyProfile = clonePlainObject(post?.profile);
  const sourceMeta = clonePlainObject(source.meta);
  const legacyMeta = clonePlainObject(legacyProfile.meta);
  return {
    fullBodyImage: String(source.fullBodyImage || legacyProfile.fullBodyImage || post?.imageUrl || post?.thumbnailAttachment?.url || "").trim(),
    headImage: String(source.headImage || legacyProfile.headImage || "").trim(),
    nameKo: String(source.nameKo || legacyProfile.nameKo || post?.title || "").trim(),
    nameEn: String(source.nameEn || legacyProfile.nameEn || "").trim(),
    oneLine: String(source.oneLine || legacyProfile.oneLine || post?.contentText || post?.contentHtml || post?.commentHtml || "").trim(),
    meta: {
      age: String(sourceMeta.age || legacyMeta.age || source.age || legacyProfile.age || "").trim(),
      gender: String(sourceMeta.gender || legacyMeta.gender || source.gender || legacyProfile.gender || "").trim(),
      height: String(sourceMeta.height || legacyMeta.height || source.height || legacyProfile.height || "").trim()
    },
    appearance: String(source.appearance || legacyProfile.appearance || "").trim(),
    personality: String(source.personality || legacyProfile.personality || "").trim(),
    etc: String(source.etc || legacyProfile.etc || "").trim()
  };
}

export function resolveBoardSkinType(board, fallback = DEFAULT_SKIN_TYPE) {
  return normalizeSkinType(board?.skinType || board?.skin || fallback, fallback);
}

export function isProfileSkinType(type) {
  return normalizeSkinType(type, DEFAULT_SKIN_TYPE) === "PROFILE";
}

export function isProfileBoard(board = {}, fallback = DEFAULT_SKIN_TYPE) {
  const boardSkinType = resolveBoardSkinType(board, fallback);
  const aliasSkinType = findSkinTypeByAlias(board?.id || "");
  return isProfileSkinType(boardSkinType) || isProfileSkinType(aliasSkinType);
}

export function isProfilePost(post = {}) {
  const skinData = clonePlainObject(post?.skinData);
  const boardAlias = findSkinTypeByAlias(post?.boardId || post?.board || post?.bo || post?.board_id || post?.boardRef || post?.boardPath || "");
  return isProfileBoard(post, post?.skinType || post?.skin || DEFAULT_SKIN_TYPE)
    || isProfileSkinType(boardAlias)
    || Boolean(skinData.profile || post?.profile);
}

export function isBoardMenuVisible(board) {
  return board?.menuVisible !== false && board?.isVisible !== false && !isProfileBoard(board);
}

export function getSkinAliases(type) {
  const normalizedType = normalizeSkinType(type, DEFAULT_SKIN_TYPE);
  return [...(SKIN_META_BY_TYPE.get(normalizedType)?.aliases || [])];
}

export function getSkinCatalog() {
  return SKIN_CATALOG
    .filter((entry) => !HIDDEN_SKIN_TYPES.has(entry.type))
    .map((entry) => ({ ...entry }));
}

export function getSkinFolderName(type, fallback = DEFAULT_SKIN_TYPE) {
  const normalizedType = normalizeSkinType(type, fallback);
  return SKIN_META_BY_TYPE.get(normalizedType)?.folder || normalizedType.toLowerCase();
}

export function getBoardSkinOptions(board = {}, fallbackSkinType = DEFAULT_SKIN_TYPE) {
  const skinType = resolveBoardSkinType(board, fallbackSkinType);
  const options = clonePlainObject(board?.skinOptions);

  if (options.boardWidth == null) {
    const legacyBoardWidth = getLegacyBoardWidth(board, skinType);
    if (legacyBoardWidth != null) options.boardWidth = legacyBoardWidth;
  }
  if (options.galleryColumns == null && options.columns == null) {
    const legacyColumns = getLegacyGalleryColumns(board);
    if (legacyColumns != null) options.galleryColumns = legacyColumns;
  }
  if (options.imageWidth == null) {
    const legacyImageWidth = getLegacyLogImageWidth(board);
    if (legacyImageWidth != null) options.imageWidth = legacyImageWidth;
  }
  if (options.commentPosition == null) {
    const legacyPosition = getLegacyLogCommentPosition(board);
    if (legacyPosition != null) options.commentPosition = legacyPosition;
  }

  return options;
}

export function getBoardSkinOption(board, key, fallback = undefined) {
  const options = getBoardSkinOptions(board);
  if (Object.prototype.hasOwnProperty.call(options, key) && options[key] != null && options[key] !== "") {
    return options[key];
  }

  if (key === "galleryColumns" && options.columns != null && options.columns !== "") {
    return options.columns;
  }
  if (key === "boardWidth") {
    return getLegacyBoardWidth(board, resolveBoardSkinType(board)) ?? fallback;
  }
  if (key === "imageWidth") {
    return getLegacyLogImageWidth(board) ?? fallback;
  }
  if (key === "commentPosition") {
    return getLegacyLogCommentPosition(board) ?? fallback;
  }
  if (key === "galleryColumns") {
    return getLegacyGalleryColumns(board) ?? fallback;
  }

  return fallback;
}

export function getPostSkinData(post = {}) {
  const skinData = clonePlainObject(post?.skinData);
  if (skinData.profile || post?.profile) {
    skinData.profile = normalizeProfileSkinData(skinData.profile, post);
  }
  if (skinData.logNo == null && post?.logNo != null) {
    skinData.logNo = post.logNo;
  }
  if (skinData.logNo == null && post?.logNumber != null) {
    skinData.logNo = post.logNumber;
  }
  if (skinData.source == null && post?.source != null) {
    skinData.source = post.source;
  }
  return skinData;
}

export function getPostSkinField(post, key, fallback = undefined) {
  const skinData = getPostSkinData(post);
  if (Object.prototype.hasOwnProperty.call(skinData, key) && skinData[key] != null && skinData[key] !== "") {
    return skinData[key];
  }
  return fallback;
}

export function getBoardAliasCandidates(rawBoardId, skinType = "") {
  const normalizedBoardId = String(rawBoardId || "").trim().toLowerCase();
  if (!normalizedBoardId) return [];

  const candidates = new Set([normalizedBoardId]);
  const aliasMatchedType = hasKnownAlias(normalizedBoardId) ? findSkinTypeByAlias(normalizedBoardId) : "";
  const normalizedType = skinType ? normalizeSkinType(skinType, DEFAULT_SKIN_TYPE) : aliasMatchedType;
  if (normalizedType) {
    getSkinAliases(normalizedType).forEach((alias) => candidates.add(alias));
  }
  return Array.from(candidates).filter(Boolean);
}

export function findSkinTypeByAlias(rawBoardId) {
  const normalizedBoardId = String(rawBoardId || "").trim().toLowerCase();
  const matched = SKIN_CATALOG.find((entry) => entry.aliases.includes(normalizedBoardId));
  return matched?.type || DEFAULT_SKIN_TYPE;
}

function hasKnownAlias(rawBoardId) {
  return SKIN_CATALOG.some((entry) => entry.aliases.includes(rawBoardId));
}

export async function getSkin(boardOrType) {
  const skinType = typeof boardOrType === "string"
    ? normalizeSkinType(boardOrType, DEFAULT_SKIN_TYPE)
    : resolveBoardSkinType(boardOrType, DEFAULT_SKIN_TYPE);

  if (skinCache.has(skinType)) {
    return skinCache.get(skinType);
  }

  const folder = getSkinFolderName(skinType, DEFAULT_SKIN_TYPE);
  let module;
  try {
    module = await import(`./${folder}/index.js`);
  } catch (error) {
    if (skinType !== DEFAULT_SKIN_TYPE) {
      console.warn(`Skin ${skinType} load failed. Falling back to ${DEFAULT_SKIN_TYPE}.`, error);
      return getSkin(DEFAULT_SKIN_TYPE);
    }
    throw error;
  }

  const skin = module.skin || module.default;
  if (!skin) {
    throw new Error(`Skin module (${skinType}) does not export a valid skin definition.`);
  }

  ensureSkinStylesheets(skin);
  skinCache.set(skinType, skin);
  return skin;
}

function ensureSkinStylesheets(skin) {
  const paths = Array.isArray(skin?.stylesheets) ? skin.stylesheets : [];
  paths.forEach((href) => {
    if (stylesheetCache.has(href)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
    stylesheetCache.add(href);
  });
}
