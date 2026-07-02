import { db } from "../core/firebase.js";
import { deleteBoardContent } from "../shared/post-maintenance.js";
import { ensureAdminPageAccess } from "../core/state.js";
import { showInputModal } from "../shared/ui-modal.js";
import { formatResponsiveWidth } from "../shared/boards-render.js";
import { getBoardSkinOptions, getSkinCatalog, isBoardMenuVisible, isProfileBoard } from "../skins/registry.js";
import { normalizeSkinType } from "../skins/skin-definition.js";
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
const boardPageParams = new URLSearchParams(window.location.search);
const msgEl = document.getElementById("boardMsg");
const listEl = document.getElementById("boardsList");
const migrateMsgEl = document.getElementById("migrateMsg");
const summaryTitleEl = document.getElementById("boardSummaryTitle");
const summaryChipsEl = document.getElementById("boardSummaryChips");
const summaryIdEl = document.getElementById("boardSummaryId");
const summarySkinEl = document.getElementById("boardSummarySkin");
const summaryOrderEl = document.getElementById("boardSummaryOrder");
const summaryPageSizeEl = document.getElementById("boardSummaryPageSize");
const summaryCommentScopeEl = document.getElementById("boardSummaryCommentScope");
const summaryBoardWidthEl = document.getElementById("boardSummaryBoardWidth");
const summaryLogBoardWidthEl = document.getElementById("boardSummaryLogBoardWidth");
const summaryGalleryBoardWidthEl = document.getElementById("boardSummaryGalleryBoardWidth");
const summaryGalleryColumnsEl = document.getElementById("boardSummaryGalleryColumns");
const summaryLogImageWidthEl = document.getElementById("boardSummaryLogImageWidth");
const summaryLogCommentPositionEl = document.getElementById("boardSummaryLogCommentPosition");
const autoBoardIdBtn = document.getElementById("autoBoardIdBtn");
const resetBoardBtn = document.getElementById("resetBoardBtn");
const boardIdHintEl = document.getElementById("boardIdHint");
const addSkinPathBtn = document.getElementById("addSkinPathBtn");
const boardSkinOptionsBlockEl = document.getElementById("boardSkinOptionsBlock");
const gallerySkinOptionsBlockEl = document.getElementById("gallerySkinOptionsBlock");
const logSkinOptionsBlockEl = document.getElementById("logSkinOptionsBlock");
const boardBoardWidthInput = document.getElementById("boardBoardWidthInput");
const galleryBoardWidthInput = document.getElementById("galleryBoardWidthInput");
const galleryColumnsInput = document.getElementById("galleryColumnsInput");
const logBoardWidthInput = document.getElementById("logBoardWidthInput");
const logImageWidthInput = document.getElementById("logImageWidthInput");
const logCommentPositionInput = document.getElementById("logCommentPositionInput");
const skinCatalog = getSkinCatalog();
let loadedBoards = [];
let boardIdAutoMode = true;
let pendingBoardEditId = String(boardPageParams.get("boardId") || boardPageParams.get("edit") || "").trim();

if (boardIdHintEl) {
  boardIdHintEl.hidden = true;
}

function showMsg(text, isError = false) {
  msgEl.classList.remove("hidden");
  msgEl.textContent = text;
  msgEl.style.borderColor = isError ? "rgba(220,38,38,.45)" : "rgba(15,23,42,.18)";
}

function showMigrateMsg(text, isError = false) {
  migrateMsgEl.classList.remove("hidden");
  migrateMsgEl.textContent = text;
  migrateMsgEl.style.borderColor = isError ? "rgba(220,38,38,.45)" : "rgba(15,23,42,.18)";
}

function normalizeKind(value, fallback = "BOARD") {
  return normalizeSkinType(value, fallback);
}

function toMenuOrder(v, fallback = 99999) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseOptionalNumber(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

function parsePositiveNumber(value) {
  const n = parseOptionalNumber(value);
  if (!n || n < 1) return null;
  return n;
}

function normalizeLogCommentPosition(value) {
  return String(value || "default").trim().toLowerCase() === "bottom" ? "bottom" : "default";
}

function formatLogImageWidth(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  if (n === 0) return "제한 없음";
  if (n < 0) return "";
  return `${Math.round(n)}px`;
}

function getLogCommentPositionLabel(value) {
  return normalizeLogCommentPosition(value) === "bottom" ? "하단" : "우측";
}

function slugifyBoardId(value) {
  const base = String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "board";
}

function getUniqueBoardId(base, ignoreId = "") {
  const normalized = slugifyBoardId(base);
  const used = new Set(
    loadedBoards
      .map((board) => String(board.id || "").trim().toLowerCase())
      .filter(Boolean)
  );
  if (ignoreId) used.delete(String(ignoreId).trim().toLowerCase());

  if (!used.has(normalized)) return normalized;

  let index = 2;
  while (used.has(`${normalized}-${index}`)) index += 1;
  return `${normalized}-${index}`;
}

function updateBoardIdHint() {
  if (!boardIdHintEl) return;
  boardIdHintEl.textContent = "";
}

function updateSkinOptionsVisibility() {
  const kind = normalizeKind(document.getElementById("boardKindInput")?.value, "BOARD");
  if (boardSkinOptionsBlockEl) boardSkinOptionsBlockEl.classList.toggle("hidden", kind !== "BOARD");
  if (gallerySkinOptionsBlockEl) gallerySkinOptionsBlockEl.classList.toggle("hidden", kind !== "GALLERY");
  if (logSkinOptionsBlockEl) logSkinOptionsBlockEl.classList.toggle("hidden", kind !== "LOG");
  if (kind === "BOARD" && boardBoardWidthInput && !String(boardBoardWidthInput.value || "").trim()) {
    boardBoardWidthInput.value = "800";
  }
}

function arrangeBoardEditorLayout() {
  const mainEl = document.querySelector("main.container");
  mainEl?.classList.add("board-admin-layout");

  const formEl = document.querySelector(".admin-board-form");
  const summaryPanel = document.querySelector(".summary-panel");
  if (!formEl || !summaryPanel) return;

  const blocks = Array.from(formEl.querySelectorAll(":scope > .settings-block"));
  const skinBlock = blocks[1];
  const optionBlock = blocks[4] || blocks[3] || blocks[2];
  const extraBlocks = [boardSkinOptionsBlockEl, gallerySkinOptionsBlockEl, logSkinOptionsBlockEl].filter(Boolean);

  if (skinBlock && extraBlocks.length) skinBlock.after(...extraBlocks);
  if (optionBlock && extraBlocks.length) extraBlocks[extraBlocks.length - 1].after(optionBlock);

  const summaryList = summaryPanel.querySelector(".summary-list");
  const saveBtn = document.getElementById("saveBoardBtn");
  const boardMsg = document.getElementById("boardMsg");

  if (saveBtn && summaryList && !summaryPanel.contains(saveBtn)) {
    let saveRow = summaryPanel.querySelector(".board-summary-actions");
    if (!saveRow) {
      saveRow = document.createElement("div");
      saveRow.className = "formRow board-summary-actions mt-md";
    }
    saveRow.replaceChildren(saveBtn);
    summaryList.after(saveRow);
  }

  if (boardMsg && summaryPanel && !summaryPanel.contains(boardMsg)) {
    summaryPanel.appendChild(boardMsg);
  }
}

function syncBoardIdFromTitle(force = false) {
  const idInput = document.getElementById("boardIdInput");
  const titleInput = document.getElementById("boardTitleInput");
  if (!idInput || !titleInput) return;

  const title = titleInput.value.trim();
  const currentId = idInput.value.trim();
  if (!title && !force) {
    updateBoardIdHint();
    return;
  }

  const shouldAutoFill = force || boardIdAutoMode || !currentId;
  if (!shouldAutoFill) {
    updateBoardIdHint();
    return;
  }

  const lockId = idInput.dataset.lockedId || "";
  idInput.value = getUniqueBoardId(title || currentId || "board", lockId);
  boardIdAutoMode = true;
  updateBoardIdHint();
  updateFormSummary();
}

function renderSkinCatalogOptions() {
  const datalist = document.getElementById("boardKindOptions");
  const catalogListEl = document.getElementById("skinCatalogList");
  if (datalist) {
    datalist.innerHTML = skinCatalog.map((entry) => `
      <option value="${entry.type}">${entry.folder}</option>
    `).join("");
  }
  if (catalogListEl) {
    catalogListEl.innerHTML = skinCatalog.map((entry) => `
      <button type="button" class="skin-chip" data-skin="${entry.type}" data-folder="${entry.folder}" title="/assets/js/skins/${entry.folder}/index.js">
        <span class="skin-chip-type">${entry.type}</span>
        <span class="skin-chip-folder">${entry.folder}</span>
      </button>
    `).join("");
    catalogListEl.querySelectorAll("[data-skin]").forEach((button) => {
      button.addEventListener("click", () => {
        const input = document.getElementById("boardKindInput");
        if (!input) return;
        input.value = button.dataset.skin || "BOARD";
        updateSkinFolderHint(input.value);
        updateFormSummary();
      });
    });
  }
  updateSkinFolderHint();
  updateFormSummary();
}

function normalizeCustomSkinPath(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const cleaned = raw
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/^assets\/js\/skins\//i, "")
    .replace(/^skins\//i, "")
    .replace(/\/+$/, "");

  const parts = cleaned.split("/").filter(Boolean);
  const folder = parts[parts.length - 1] || "";
  const skinType = slugifyBoardId(folder).toUpperCase();
  if (!folder) return null;

  return {
    folder,
    skinType,
    rawPath: cleaned
  };
}

function updateSkinFolderHint(rawValue = "") {
  const input = document.getElementById("boardKindInput");
  const hintEl = document.getElementById("skinFolderHint");
  if (!hintEl) return;

  const normalized = normalizeKind(rawValue || input?.value, "BOARD");
  const matched = skinCatalog.find((entry) => entry.type === normalized);
  if (matched) {
    hintEl.textContent = `기본: /assets/js/skins/${matched.folder}/index.js`;
    return;
  }

  const customPath = normalizeCustomSkinPath(rawValue || input?.value);
  if (customPath) {
    hintEl.textContent = `커스텀 스킨 경로: /assets/js/skins/${customPath.folder}/index.js`;
    return;
  }

  if (normalized) {
    hintEl.textContent = `커스텀 스킨은 /assets/js/skins/${normalized.toLowerCase()}/index.js 경로를 사용합니다.`;
    return;
  }

  hintEl.textContent = "";
}
function readForm() {
  const boardId = (document.getElementById("boardIdInput")?.value || "").trim();
  const menuOrderRaw = (document.getElementById("menuOrderInput")?.value || "").trim();
  const pageSizeRaw = (document.getElementById("pageSizeInput")?.value || "").trim();
  const commentRestricted = !!document.getElementById("commentRestrictionInput")?.checked;
  const skinType = normalizeKind(document.getElementById("boardKindInput")?.value, "BOARD");
  const skinOptions = {};

  if (skinType === "BOARD") {
    skinOptions.boardWidth = parsePositiveNumber(boardBoardWidthInput?.value) || 800;
  }
  if (skinType === "GALLERY") {
    skinOptions.boardWidth = parseOptionalNumber(galleryBoardWidthInput?.value);
    skinOptions.galleryColumns = parsePositiveNumber(galleryColumnsInput?.value) || 4;
  }
  if (skinType === "LOG") {
    skinOptions.boardWidth = parseOptionalNumber(logBoardWidthInput?.value);
    skinOptions.imageWidth = parseOptionalNumber(logImageWidthInput?.value);
    skinOptions.commentPosition = normalizeLogCommentPosition(logCommentPositionInput?.value);
  }

  return {
    boardId,
    title: (document.getElementById("boardTitleInput")?.value || "").trim(),
    description: (document.getElementById("boardDescInput")?.value || "").trim(),
    skinType,
    pageSize: toMenuOrder(pageSizeRaw, 12),
    menuOrder: toMenuOrder(menuOrderRaw),
    menuVisible: !!document.getElementById("menuVisibleInput")?.checked,
    isPublic: !!document.getElementById("boardPublicInput")?.checked,
    allowGuestPost: !!document.getElementById("boardGuestInput")?.checked,
    commentScope: commentRestricted ? "guest" : "all",
    commentRestricted,
    skinOptions
  };
}

function normalizeCommentScope(value) {
  return String(value || "all").trim().toLowerCase() === "guest" ? "guest" : "all";
}

function getCommentScopeLabel(value) {
  return normalizeCommentScope(value) === "guest" ? "게스트" : "전체";
}

function getBoardStatusLabel(value) {
  return value ? "ON" : "OFF";
}

function updateFormSummary() {
  if (!summaryTitleEl) return;

  const data = readForm();
  const skinOptions = data.skinOptions || {};
  const isBoardSkin = data.skinType === "BOARD";
  const isLogSkin = data.skinType === "LOG";
  const isGallerySkin = data.skinType === "GALLERY";
  const boardWidth = skinOptions.boardWidth ?? "";
  const galleryColumns = skinOptions.galleryColumns ?? skinOptions.columns ?? "";
  const imageWidth = skinOptions.imageWidth ?? "";
  const commentPosition = skinOptions.commentPosition || "default";
  summaryTitleEl.textContent = data.title || data.boardId || "새 게시판";
  if (summaryIdEl) summaryIdEl.textContent = data.boardId || "-";
  if (summarySkinEl) summarySkinEl.textContent = data.skinType || "BOARD";
  if (summaryOrderEl) summaryOrderEl.textContent = Number.isFinite(Number(data.menuOrder)) ? String(data.menuOrder) : "-";
  if (summaryPageSizeEl) summaryPageSizeEl.textContent = String(data.pageSize || 12);
  if (summaryCommentScopeEl) summaryCommentScopeEl.textContent = data.commentRestricted ? "ON" : "OFF";
  if (summaryBoardWidthEl) summaryBoardWidthEl.textContent = isBoardSkin ? (formatResponsiveWidth(boardWidth || 800) || "800px") : "-";
  if (summaryGalleryBoardWidthEl) summaryGalleryBoardWidthEl.textContent = isGallerySkin ? (formatResponsiveWidth(boardWidth) || "-") : "-";
  if (summaryGalleryColumnsEl) summaryGalleryColumnsEl.textContent = isGallerySkin ? (galleryColumns || "-") : "-";
  if (summaryLogBoardWidthEl) summaryLogBoardWidthEl.textContent = isLogSkin ? (formatResponsiveWidth(boardWidth) || "-") : "-";
  if (summaryLogImageWidthEl) summaryLogImageWidthEl.textContent = isLogSkin ? (formatLogImageWidth(imageWidth) || "-") : "-";
  if (summaryLogCommentPositionEl) summaryLogCommentPositionEl.textContent = isLogSkin ? getLogCommentPositionLabel(commentPosition) : "우측";

  if (summaryChipsEl) {
    summaryChipsEl.innerHTML = `
      <span class="summary-chip ${data.menuVisible ? "is-on" : "is-off"}">메뉴 ${getBoardStatusLabel(data.menuVisible)}</span>
      <span class="summary-chip ${data.isPublic ? "is-on" : "is-off"}">공개 ${getBoardStatusLabel(data.isPublic)}</span>
      <span class="summary-chip ${data.allowGuestPost ? "is-on" : "is-off"}">게스트 ${getBoardStatusLabel(data.allowGuestPost)}</span>
      <span class="summary-chip ${data.commentRestricted ? "is-off" : "is-on"}">댓글제한 ${data.commentRestricted ? "ON" : "OFF"}</span>
      ${isBoardSkin ? `<span class="summary-chip is-on">BOARD ${formatResponsiveWidth(boardWidth || 800) || "800px"}</span>` : ""}
      ${isGallerySkin ? `<span class="summary-chip is-on">갤러리 ${galleryColumns || 4}열</span>` : ""}
      ${isLogSkin ? `<span class="summary-chip is-on">배치 ${getLogCommentPositionLabel(commentPosition)}</span>` : ""}
    `;
  }
  updateBoardIdHint();
  updateSkinOptionsVisibility();
}

function fillForm(board) {
  boardIdAutoMode = false;
  const skinType = normalizeKind(board.skinType || board.skin, "BOARD");
  const skinOptions = getBoardSkinOptions(board, skinType);
  const boardIdInput = document.getElementById("boardIdInput");
  if (boardIdInput) {
    boardIdInput.value = board.id;
    boardIdInput.dataset.lockedId = board.id;
    boardIdInput.readOnly = true;
    boardIdInput.classList.add("is-locked");
  }
  if (autoBoardIdBtn) autoBoardIdBtn.disabled = true;
  document.getElementById("boardTitleInput").value = board.title || board.name || "";
  document.getElementById("boardDescInput").value = board.description || "";
  document.getElementById("pageSizeInput").value = toMenuOrder(board.pageSize, 12);
  document.getElementById("boardKindInput").value = skinType;
  updateSkinFolderHint(document.getElementById("boardKindInput").value);
  if (boardBoardWidthInput) boardBoardWidthInput.value = skinType === "BOARD" ? (skinOptions.boardWidth ?? 800) : "";
  if (logBoardWidthInput) logBoardWidthInput.value = skinType === "LOG" ? (skinOptions.boardWidth ?? "") : "";
  if (galleryBoardWidthInput) galleryBoardWidthInput.value = skinType === "GALLERY" ? (skinOptions.boardWidth ?? "") : "";
  if (galleryColumnsInput) galleryColumnsInput.value = skinType === "GALLERY" ? (skinOptions.galleryColumns ?? skinOptions.columns ?? "") : "";
  if (logImageWidthInput) logImageWidthInput.value = skinType === "LOG" ? (skinOptions.imageWidth ?? "") : "";
  if (logCommentPositionInput) logCommentPositionInput.value = skinType === "LOG" ? normalizeLogCommentPosition(skinOptions.commentPosition || board.logCommentPosition || board.logCommentLayout || "default") : "default";

  document.getElementById("menuOrderInput").value = toMenuOrder(board.menuOrder, "");
  document.getElementById("menuVisibleInput").checked = board.menuVisible !== false && board.isVisible !== false;
  document.getElementById("boardPublicInput").checked = board.isPublic !== false;
  document.getElementById("boardGuestInput").checked = !!board.allowGuestPost;
  const commentRestrictionInput = document.getElementById("commentRestrictionInput");
  if (commentRestrictionInput) commentRestrictionInput.checked = normalizeCommentScope(board.commentScope || board.commentPermission || "all") === "guest";
  updateFormSummary();
}

function resetBoardForm() {
  const boardIdInput = document.getElementById("boardIdInput");
  const titleInput = document.getElementById("boardTitleInput");
  const descInput = document.getElementById("boardDescInput");
  const kindInput = document.getElementById("boardKindInput");
  const pageSizeInput = document.getElementById("pageSizeInput");
  const menuOrderInput = document.getElementById("menuOrderInput");
  const menuVisibleInput = document.getElementById("menuVisibleInput");
  const boardPublicInput = document.getElementById("boardPublicInput");
  const boardGuestInput = document.getElementById("boardGuestInput");
  const commentRestrictionInput = document.getElementById("commentRestrictionInput");

  if (boardIdInput) {
    boardIdInput.value = "";
    delete boardIdInput.dataset.lockedId;
    boardIdInput.readOnly = false;
    boardIdInput.classList.remove("is-locked");
  }
  if (titleInput) titleInput.value = "";
  if (descInput) descInput.value = "";
  if (kindInput) kindInput.value = "BOARD";
  if (pageSizeInput) pageSizeInput.value = 12;
  if (menuOrderInput) menuOrderInput.value = "";
  if (boardBoardWidthInput) boardBoardWidthInput.value = 800;
  if (logBoardWidthInput) logBoardWidthInput.value = "";
  if (galleryBoardWidthInput) galleryBoardWidthInput.value = "";
  if (galleryColumnsInput) galleryColumnsInput.value = "";
  if (logImageWidthInput) logImageWidthInput.value = "";
  if (logCommentPositionInput) logCommentPositionInput.value = "default";
  if (menuVisibleInput) menuVisibleInput.checked = true;
  if (boardPublicInput) boardPublicInput.checked = true;
  if (boardGuestInput) boardGuestInput.checked = false;
  if (commentRestrictionInput) commentRestrictionInput.checked = false;

  boardIdAutoMode = true;
  if (autoBoardIdBtn) autoBoardIdBtn.disabled = false;
  updateSkinFolderHint("BOARD");
  updateFormSummary();
  showMsg("초기화되었습니다.");
}

async function saveBoard() {
  const data = readForm();
  if (!data.boardId) data.boardId = getUniqueBoardId(data.title || "board");
  if (!data.title) return showMsg("게시판 제목을 입력하세요.", true);

  const ref = doc(db, "boards", data.boardId);
  const snap = await getDoc(ref);
  const existingData = snap.exists() ? (snap.data() || {}) : {};
  const skinOptionsSource = existingData.skinOptions && typeof existingData.skinOptions === "object" ? existingData.skinOptions : {};
  const skinOptions = { ...skinOptionsSource };

  if (data.skinType === "BOARD") {
    skinOptions.boardWidth = data.skinOptions?.boardWidth || 800;
    delete skinOptions.columns;
    delete skinOptions.galleryColumns;
    delete skinOptions.imageWidth;
    delete skinOptions.commentPosition;
    delete skinOptions.logCommentLayout;
  }

  if (data.skinType === "GALLERY") {
    if (data.skinOptions?.boardWidth != null && data.skinOptions.boardWidth !== "") {
      skinOptions.boardWidth = data.skinOptions.boardWidth;
    }
    if (data.skinOptions?.galleryColumns != null && data.skinOptions.galleryColumns !== "") {
      skinOptions.galleryColumns = data.skinOptions.galleryColumns;
    }
    delete skinOptions.columns;
    delete skinOptions.imageWidth;
    delete skinOptions.commentPosition;
    delete skinOptions.logCommentLayout;
  }

  if (data.skinType === "LOG") {
    if (data.skinOptions?.boardWidth != null && data.skinOptions.boardWidth !== "") {
      skinOptions.boardWidth = data.skinOptions.boardWidth;
    }
    if (data.skinOptions?.imageWidth != null && data.skinOptions.imageWidth !== "") {
      skinOptions.imageWidth = data.skinOptions.imageWidth;
    }
    skinOptions.commentPosition = data.skinOptions?.commentPosition === "bottom" ? "bottom" : "default";
    delete skinOptions.galleryColumns;
    delete skinOptions.columns;
    delete skinOptions.logCommentLayout;
  }

  const payload = {
    title: data.title,
    name: data.title,
    description: data.description,

    skinType: data.skinType,
    skinOptions,
    pageSize: data.pageSize,

    menuOrder: data.menuOrder,
    menuVisible: data.menuVisible,

    isPublic: data.isPublic,
    allowGuestPost: data.allowGuestPost,
    commentScope: data.commentScope,

    updatedAt: serverTimestamp()
  };

  if (!snap.exists()) {
    payload.createdAt = serverTimestamp();
    await setDoc(ref, payload);
  } else {
    await updateDoc(ref, {
      ...payload,
      isVisible: deleteField(),
      boardType: deleteField(),
      sortOrder: deleteField(),
      menuId: deleteField(),
      menuLabel: deleteField(),
      boardBoardWidth: deleteField(),
      galleryBoardWidth: deleteField(),
      galleryColumns: deleteField(),
      logBoardWidth: deleteField(),
      logImageWidth: deleteField(),
      logCommentPosition: deleteField()
    });
  }
  showMsg("저장 완료");
  boardIdAutoMode = false;
  await loadBoards();
  updateFormSummary();
}

async function removeBoard(boardId) {
  try {
    const board = {
      id: boardId,
      skinType: normalizeKind(document.getElementById("boardKindInput")?.value, "BOARD")
    };
    const boardSnap = await getDoc(doc(db, "boards", boardId));
    if (boardSnap.exists()) {
      Object.assign(board, boardSnap.data());
    }

    if (!confirm(`게시판 ${boardId}와 연결된 게시물과 카테고리를 함께 삭제할까요?`)) return;

    showMsg("게시판과 연결 콘텐츠를 삭제하는 중...");
    const result = await deleteBoardContent(board);
    await deleteDoc(doc(db, "boards", boardId));
    showMsg(`삭제 완료 (게시물 ${result.deletedPosts}개, 카테고리 ${result.deletedCategories}개)`);
    await loadBoards();
  } catch (error) {
    console.error("Failed to remove board:", error);
    showMsg(error.message || "게시판 삭제 중 오류가 발생했습니다.", true);
  }
}

async function loadBoards() {
  const snap = await getDocs(collection(db, "boards"));
  loadedBoards = snap.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter((board) => !isProfileBoard(board))
    .sort((a, b) => {
      const ao = toMenuOrder(a.menuOrder);
      const bo = toMenuOrder(b.menuOrder);
      if (ao !== bo) return ao - bo;
      return (a.title || a.id || "").localeCompare((b.title || b.id || ""), "ko");
    });

  if (!loadedBoards.length) {
    listEl.innerHTML = '<div class="notice">게시판이 없습니다.</div>';
    return;
  }

  listEl.innerHTML = loadedBoards.map((board) => {
    const kind = normalizeKind(board.skinType || board.skin, "BOARD");
    const skinOptions = getBoardSkinOptions(board, kind);
    const menuOrder = toMenuOrder(board.menuOrder);
    const isVisible = isBoardMenuVisible(board);
    const isPublic = board.isPublic !== false;
    const allowGuest = !!board.allowGuestPost;
    const commentScope = normalizeCommentScope(board.commentScope || board.commentPermission || "all");
    const commentRestricted = commentScope === "guest";
    const boardWidthLabel = kind === "BOARD" ? (formatResponsiveWidth(skinOptions.boardWidth ?? 800) || "800px") : "-";
    const galleryBoardWidthLabel = kind === "GALLERY" ? (formatResponsiveWidth(skinOptions.boardWidth) || "-") : "-";
    const galleryColumnsLabel = kind === "GALLERY" ? (skinOptions.galleryColumns || "-") : "-";
    const logBoardWidthLabel = kind === "LOG" ? (formatResponsiveWidth(skinOptions.boardWidth) || "-") : "-";
    const imageWidthLabel = kind === "LOG" ? (formatLogImageWidth(skinOptions.imageWidth) || "-") : "-";
    const commentPositionLabel = kind === "LOG" ? getLogCommentPositionLabel(skinOptions.commentPosition) : "우측";

    return `
      <article class="card board-list-item">
        <div class="board-row board-row-compact">
          <div class="board-row-main">
            <div class="board-row-title">
              <strong>${escapeHtml(board.id)}</strong>
              <span>· ${escapeHtml(board.title || board.name || "")}</span>
            </div>
            <div class="board-row-meta">
              <span class="summary-chip ${isVisible ? "is-on" : "is-off"}">노출 ${isVisible ? "ON" : "OFF"}</span>
              <span class="summary-chip ${isPublic ? "is-on" : "is-off"}">공개 ${isPublic ? "ON" : "OFF"}</span>
              <span class="summary-chip ${allowGuest ? "is-on" : "is-off"}">게스트 ${allowGuest ? "ON" : "OFF"}</span>
              <span class="summary-chip ${commentRestricted ? "is-off" : "is-on"}">댓글제한 ${commentRestricted ? "ON" : "OFF"}</span>
              <span class="muted small">skin ${kind} / order ${menuOrder} / size ${toMenuOrder(board.pageSize, 12)}${kind === "BOARD" ? ` / width ${boardWidthLabel}` : ""}${kind === "GALLERY" ? ` / width ${galleryBoardWidthLabel} / cols ${galleryColumnsLabel}` : ""}${kind === "LOG" ? ` / width ${logBoardWidthLabel} / image ${imageWidthLabel} / comments ${commentPositionLabel}` : ""}</span>
            </div>
          </div>
          <div class="formRow board-row-actions">
            <button class="btn" data-edit="${board.id}">수정</button>
            <button class="btn" data-del="${board.id}">삭제</button>
          </div>
        </div>
      </article>
    `;
  }).join("");

  listEl.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = loadedBoards.find((b) => b.id === btn.dataset.edit);
      if (item) fillForm(item);
    });
  });

  listEl.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", () => removeBoard(btn.dataset.del));
  });
}

async function openRequestedBoardEditor() {
  const targetId = String(pendingBoardEditId || "").trim().toLowerCase();
  if (!targetId) return;

  const board = loadedBoards.find((item) => String(item.id || "").trim().toLowerCase() === targetId);
  pendingBoardEditId = "";

  if (!board) {
    showMsg("요청한 게시판을 찾을 수 없습니다.", true);
    return;
  }

  fillForm(board);
  document.querySelector(".admin-board-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function migrateBoardsDocs() {
  const snap = await getDocs(collection(db, "boards"));
  let updated = 0;

  for (const item of snap.docs) {
    const data = item.data() || {};
    const kind = normalizeKind(data.skinType || data.boardType || data.skin, "BOARD");
    const skinOptionsSource = data.skinOptions && typeof data.skinOptions === "object" ? data.skinOptions : {};
    const boardWidthSource =
      skinOptionsSource.boardWidth ??
      data.boardBoardWidth ??
      data.galleryBoardWidth ??
      data.logBoardWidth;
    const galleryColumnsSource = skinOptionsSource.galleryColumns ?? data.galleryColumns ?? data.columns;
    const imageWidthSource = skinOptionsSource.imageWidth ?? data.logImageWidth ?? data.imageWidth;
    const commentPositionSource =
      skinOptionsSource.commentPosition ?? data.logCommentPosition ?? data.logCommentLayout ?? data.commentPosition;
    const skinOptions = { ...skinOptionsSource };

    delete skinOptions.columns;
    delete skinOptions.logCommentLayout;
    delete skinOptions.boardBoardWidth;
    delete skinOptions.galleryBoardWidth;
    delete skinOptions.logBoardWidth;
    delete skinOptions.logImageWidth;
    delete skinOptions.logCommentPosition;

    if (kind === "BOARD") {
      skinOptions.boardWidth = parsePositiveNumber(boardWidthSource) || 800;
      delete skinOptions.galleryColumns;
      delete skinOptions.imageWidth;
      delete skinOptions.commentPosition;
    }

    if (kind === "GALLERY") {
      if (boardWidthSource != null && boardWidthSource !== "") {
        skinOptions.boardWidth = parseOptionalNumber(boardWidthSource);
      } else {
        delete skinOptions.boardWidth;
      }
      skinOptions.galleryColumns = parsePositiveNumber(galleryColumnsSource) || 4;
      delete skinOptions.imageWidth;
      delete skinOptions.commentPosition;
    }

    if (kind === "LOG") {
      if (boardWidthSource != null && boardWidthSource !== "") {
        skinOptions.boardWidth = parseOptionalNumber(boardWidthSource);
      } else {
        delete skinOptions.boardWidth;
      }
      if (imageWidthSource != null && imageWidthSource !== "") {
        skinOptions.imageWidth = parseOptionalNumber(imageWidthSource);
      } else {
        delete skinOptions.imageWidth;
      }
      skinOptions.commentPosition = normalizeLogCommentPosition(commentPositionSource);
      delete skinOptions.galleryColumns;
    }

    const payload = {
      title: data.title || data.name || item.id,
      name: data.title || data.name || item.id,
      description: data.description || "",

      skinType: kind,
      skin: kind.toLowerCase(),
      skinOptions,
      pageSize: toMenuOrder(data.pageSize, 12),

      menuOrder: toMenuOrder(data.menuOrder, toMenuOrder(data.sortOrder)),
      menuVisible: data.menuVisible !== false && data.isVisible !== false,

      isPublic: data.isPublic !== false,
      allowGuestPost: !!data.allowGuestPost,
      commentScope: normalizeCommentScope(data.commentScope || data.commentPermission || "all"),

      boardBoardWidth: deleteField(),
      galleryBoardWidth: deleteField(),
      galleryColumns: deleteField(),
      logBoardWidth: deleteField(),
      logImageWidth: deleteField(),
      logCommentPosition: deleteField(),
      boardType: deleteField(),
      sortOrder: deleteField(),
      menuId: deleteField(),
      menuLabel: deleteField(),
      isVisible: deleteField(),
      updatedAt: serverTimestamp()
    };

    await updateDoc(doc(db, "boards", item.id), payload);
    updated += 1;
  }

  return updated;
}

async function migratePostsDocs() {
  const boardsSnap = await getDocs(collection(db, "boards"));
  const boardKindMap = {};
  boardsSnap.docs.forEach((b) => {
    const d = b.data() || {};
    boardKindMap[b.id] = normalizeKind(d.skinType || d.skin, "BOARD");
  });

  const postsSnap = await getDocs(collection(db, "posts"));
  let updated = 0;

  for (const item of postsSnap.docs) {
    const data = item.data() || {};
    const inferredKind = normalizeKind(
      data.skinType || data.boardType || data.skin || boardKindMap[data.boardId],
      "BOARD"
    );
    const thumbnailUrl = data.thumbnailAttachment && typeof data.thumbnailAttachment === "object" ? data.thumbnailAttachment.url : "";
    const imageUrl = data.imageUrl || data.image || data.origUrl || data.thumbUrl || thumbnailUrl || "";
    const contentHtml = data.contentHtml || data.content_rich || data.content || "";
    const commentHtml = data.commentHtml || data.comment || "";
    const contentText = data.contentText || data.content_text || stripHtml(contentHtml || commentHtml);
    const skinData = data.skinData && typeof data.skinData === "object" ? { ...data.skinData } : {};
    if (skinData.logNo == null && data.logNo != null) skinData.logNo = data.logNo;
    if (skinData.logNo == null && data.logNumber != null) skinData.logNo = data.logNumber;
    if (skinData.source == null && data.source != null) skinData.source = data.source;

    const legacyProfile = data.profile && typeof data.profile === "object" ? data.profile : {};
    const currentProfile = skinData.profile && typeof skinData.profile === "object" ? skinData.profile : {};
    if (inferredKind === "PROFILE" || Object.keys(legacyProfile).length || Object.keys(currentProfile).length) {
      const legacyMeta = legacyProfile.meta && typeof legacyProfile.meta === "object" ? legacyProfile.meta : {};
      const currentMeta = currentProfile.meta && typeof currentProfile.meta === "object" ? currentProfile.meta : {};
      skinData.profile = {
        ...legacyProfile,
        ...currentProfile,
        fullBodyImage: currentProfile.fullBodyImage || legacyProfile.fullBodyImage || imageUrl,
        headImage: currentProfile.headImage || legacyProfile.headImage || "",
        nameKo: currentProfile.nameKo || legacyProfile.nameKo || data.title || "",
        nameEn: currentProfile.nameEn || legacyProfile.nameEn || "",
        oneLine: currentProfile.oneLine || legacyProfile.oneLine || contentText || "",
        meta: {
          age: currentMeta.age || legacyMeta.age || legacyProfile.age || "",
          gender: currentMeta.gender || legacyMeta.gender || legacyProfile.gender || "",
          height: currentMeta.height || legacyMeta.height || legacyProfile.height || ""
        },
        appearance: currentProfile.appearance || legacyProfile.appearance || "",
        personality: currentProfile.personality || legacyProfile.personality || "",
        etc: currentProfile.etc || legacyProfile.etc || ""
      };
    }

    await updateDoc(doc(db, "posts", item.id), {
      skinType: inferredKind,
      skin: inferredKind.toLowerCase(),
      skinData,
      imageUrl,
      contentHtml,
      commentHtml,
      contentText,
      isPublic: data.isPublic !== false,
      boardType: deleteField(),
      image: deleteField(),
      origUrl: deleteField(),
      thumbUrl: deleteField(),
      content_rich: deleteField(),
      content_text: deleteField(),
      comment: deleteField(),
      source: deleteField(),
      logNo: deleteField(),
      logNumber: deleteField(),
      profile: deleteField(),
      updatedAt: serverTimestamp()
    });

    updated += 1;
  }

  return updated;
}

async function migrateRootComments() {
  let rootSnap;
  try {
    rootSnap = await getDocs(collection(db, "comments"));
  } catch (error) {
    const msg = error?.message || "";
    if (msg.includes("Missing or insufficient permissions")) {
      return { moved: 0, skippedByPermission: true };
    }
    throw error;
  }
  let moved = 0;

  for (const item of rootSnap.docs) {
    const data = item.data() || {};
    const postId = data.postId;
    if (!postId) continue;

    const targetRef = doc(db, "posts", postId, "comments", item.id);
    await setDoc(targetRef, {
      ...data,
      postId,
      migratedFromRoot: true,
      updatedAt: serverTimestamp()
    }, { merge: true });

    await deleteDoc(doc(db, "comments", item.id));
    moved += 1;
  }

  return { moved, skippedByPermission: false };
}

async function cleanupMainSettings() {
  const ref = doc(db, "site_settings", "main");
  const snap = await getDoc(ref);
  if (!snap.exists()) return false;

  await updateDoc(ref, {
    navItems: deleteField(),
    navOrder: deleteField(),
    updatedAt: serverTimestamp()
  });
  return true;
}

async function migrateFirestoreDocs() {
  if (!confirm("Firestore 문서 정리를 실행할까요? (boards/posts/comments/main)")) return;

  showMigrateMsg("정리 실행 중...");

  const result = {
    boardsUpdated: 0,
    postsUpdated: 0,
    commentsMoved: 0,
    commentsSkippedByPermission: false,
    mainCleaned: false,
    errors: []
  };

  try {
    result.boardsUpdated = await migrateBoardsDocs();
  } catch (error) {
    console.error("migrateBoardsDocs failed:", error);
    result.errors.push(`boards: ${error.message}`);
  }

  try {
    result.postsUpdated = await migratePostsDocs();
  } catch (error) {
    console.error("migratePostsDocs failed:", error);
    result.errors.push(`posts: ${error.message}`);
  }

  try {
    const commentsResult = await migrateRootComments();
    result.commentsMoved = commentsResult.moved;
    result.commentsSkippedByPermission = commentsResult.skippedByPermission;
  } catch (error) {
    console.error("migrateRootComments failed:", error);
    result.errors.push(`root comments: ${error.message}`);
  }

  try {
    result.mainCleaned = await cleanupMainSettings();
  } catch (error) {
    console.error("cleanupMainSettings failed:", error);
    result.errors.push(`site_settings/main: ${error.message}`);
  }

  const summary =
    `정리 완료: boards ${result.boardsUpdated}건, posts ${result.postsUpdated}건, ` +
    `root comments 이동 ${result.commentsMoved}건, main 정리 ${result.mainCleaned ? "1건" : "0건"}`;

  const warnings = [];
  if (result.commentsSkippedByPermission) {
    warnings.push("root comments는 권한이 없어 건너뜁니다.");
  }

  if (result.errors.length) {
    const suffix = warnings.length ? ` / 경고: ${warnings.join(" | ")}` : "";
    showMigrateMsg(`${summary} / 실패 항목: ${result.errors.join(" | ")}${suffix}`, true);
  } else {
    const suffix = warnings.length ? ` / 경고: ${warnings.join(" | ")}` : "";
    showMigrateMsg(`${summary}${suffix}`);
  }

  await loadBoards();
}

function markBoardIdManualEdit() {
  const idInput = document.getElementById("boardIdInput");
  const titleInput = document.getElementById("boardTitleInput");
  const currentId = idInput?.value || "";
  const suggested = getUniqueBoardId(titleInput?.value || currentId || "board");
  boardIdAutoMode = !currentId || currentId === suggested;
  updateBoardIdHint();
  updateFormSummary();
}

async function addCustomSkinChip() {
  const rawPath = await showInputModal({
    title: "경로 추가",
    placeholder: "skins/custom-board",
    confirmText: "추가",
    cancelText: "취소"
  });

  if (!rawPath) return;

  const custom = normalizeCustomSkinPath(rawPath);
  if (!custom) {
    showMsg("스킨 경로를 입력하세요.", true);
    return;
  }

  const boardKindInput = document.getElementById("boardKindInput");
  if (!boardKindInput) return;

  boardKindInput.value = custom.skinType;
  updateSkinFolderHint(custom.folder);
  updateFormSummary();

  const catalogListEl = document.getElementById("skinCatalogList");
  if (catalogListEl && !catalogListEl.querySelector(`[data-folder="${custom.folder}"]`)) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "skin-chip skin-chip-custom";
    chip.dataset.skin = custom.skinType;
    chip.dataset.folder = custom.folder;
    chip.title = `/assets/js/skins/${custom.folder}/index.js`;
    chip.innerHTML = `
      <span class="skin-chip-type">${escapeHtml(custom.skinType)}</span>
      <span class="skin-chip-folder">${escapeHtml(custom.folder)}</span>
    `;
    chip.addEventListener("click", () => {
      boardKindInput.value = custom.skinType;
      updateSkinFolderHint(custom.folder);
      updateFormSummary();
    });
    catalogListEl.appendChild(chip);
  }
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}

function stripHtml(html) {
  return (html || "").toString().replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

(async () => {
  const access = await ensureAdminPageAccess();
  if (!access.ok) return;

  renderSkinCatalogOptions();
  listEl?.classList.add("board-list-compact");
  arrangeBoardEditorLayout();
  await loadBoards();
  await openRequestedBoardEditor();

  document.getElementById("boardTitleInput")?.addEventListener("input", () => {
    if (boardIdAutoMode) syncBoardIdFromTitle();
    updateFormSummary();
  });
  document.getElementById("boardIdInput")?.addEventListener("input", markBoardIdManualEdit);
  document.getElementById("boardKindInput")?.addEventListener("input", (event) => {
    updateSkinFolderHint(event.target.value);
    updateSkinOptionsVisibility();
    updateFormSummary();
  });
  addSkinPathBtn?.addEventListener("click", addCustomSkinChip);
  autoBoardIdBtn?.addEventListener("click", () => {
    boardIdAutoMode = true;
    syncBoardIdFromTitle(true);
  });
  resetBoardBtn?.addEventListener("click", resetBoardForm);
  document.getElementById("saveBoardBtn")?.addEventListener("click", saveBoard);
  document.getElementById("migrateDocsBtn")?.addEventListener("click", migrateFirestoreDocs);
  [
    "boardDescInput",
      "boardKindInput",
      "boardBoardWidthInput",
      "pageSizeInput",
    "menuOrderInput",
    "menuVisibleInput",
    "boardPublicInput",
    "boardGuestInput",
    "commentRestrictionInput",
    "galleryBoardWidthInput",
    "galleryColumnsInput",
    "logBoardWidthInput",
    "logImageWidthInput",
    "logCommentPositionInput"
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", updateFormSummary);
    document.getElementById(id)?.addEventListener("change", updateFormSummary);
  });
  syncBoardIdFromTitle();
  updateFormSummary();
})();




