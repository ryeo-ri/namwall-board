import { db } from "../core/firebase.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { formatResponsiveWidth, getSiteTitle, loadSiteMainSettings } from "../shared/boards-render.js";
import { isAdminOnlyBoard, renderAdminOnlyBoardNotice, renderHiddenBoardNotice } from "../shared/board-access.js";
import { findSkinTypeByAlias, getBoardAliasCandidates, getBoardSkinOption, getPostSkinData, getSkin, isProfileBoard, resolveBoardSkinType } from "../skins/registry.js";
import { initLightbox } from "../shared/lightbox.js";
import { deletePostsByIds } from "../shared/post-maintenance.js";
import { canWriteToBoard, getAuthSnapshot, sha256Hex, verifyGuestCode } from "../core/state.js";
import { showInputModal } from "../shared/ui-modal.js";

const params = new URLSearchParams(window.location.search);
const boardId = params.get("bo") || "log";
const targetLogNo = params.get("log") || "";
const singleMode = params.get("single") === "Y";

let currentBoard = null;
let currentCategory = null;
let currentPage = 1;
let totalPages = 1;
let currentSkin = null;
let currentBoardPosts = [];
let currentGalleryPosts = [];
let currentLogPosts = [];
let readAuthCache = null;
let boardDeleteMode = false;
let boardDeleteStatus = { text: "", isError: false };
const selectedBoardPostIds = new Set();
let galleryDeleteMode = false;
let galleryDeleteStatus = { text: "", isError: false };
const selectedGalleryPostIds = new Set();
const unlockedGallerySecretPostIds = new Set();
let logDeleteMode = false;
let logDeleteStatus = { text: "", isError: false };
const selectedLogPostIds = new Set();
const unlockedLogSecretPostIds = new Set();
let galleryPageState = {
  pageSize: 12,
  pages: new Map(),
  totalCount: 0
};
const boardAdminToolsEl = document.getElementById("boardAdminTools");
let currentSiteTitle = getSiteTitle();

async function loadCurrentSiteTitle() {
  try {
    currentSiteTitle = getSiteTitle(await loadSiteMainSettings());
  } catch (error) {
    console.warn("Failed to load site title:", error);
    currentSiteTitle = getSiteTitle();
  }
  return currentSiteTitle;
}

function setDocumentTitle(title) {
  document.title = `${title} - ${currentSiteTitle}`;
}

function getBoardPageSize(board) {
  const raw = Number(board?.pageSize);
  return Number.isFinite(raw) && raw > 0 ? raw : 12;
}

function applyBoardWidth(board) {
  const mainEl = document.querySelector("body.site-page main.container");
  const skinType = resolveBoardSkinType(board);
  const width = formatResponsiveWidth(getBoardSkinOption(board, "boardWidth", skinType === "BOARD" ? 800 : ""));
  const galleryColumns = skinType === "GALLERY" ? Number(getBoardSkinOption(board, "galleryColumns", NaN)) : NaN;
  const extraWidth = skinType === "LOG" ? "40px" : "0px";
  if (width) {
    if (mainEl) {
      mainEl.style.setProperty("--board-page-w", width);
    }
  } else {
    if (mainEl) {
      mainEl.style.removeProperty("--board-page-w");
    }
  }
  if (mainEl) {
    mainEl.style.setProperty("--board-page-extra-w", extraWidth);
    if (Number.isFinite(galleryColumns) && galleryColumns > 0) {
      mainEl.style.setProperty("--gallery-columns", String(Math.round(galleryColumns)));
    } else {
      mainEl.style.removeProperty("--gallery-columns");
    }
  }
}

function getBoardIdCandidates(board) {
  return getBoardAliasCandidates(board?.id || boardId || "", resolveBoardSkinType(board)).slice(0, 10);
}

async function shouldQueryPublicOnly() {
  if (!readAuthCache) readAuthCache = await getAuthSnapshot();
  return !readAuthCache?.isAdmin;
}

function getPostDateValue(post) {
  const createdAt = post?.createdAt?.toDate ? post.createdAt.toDate() : new Date(post?.createdAt || 0);
  return Number.isNaN(createdAt.getTime()) ? new Date(0) : createdAt;
}

function sortPostsByNewest(posts) {
  return [...posts].sort((a, b) => getPostDateValue(b) - getPostDateValue(a));
}

function matchesBoardCandidates(post, boardCandidates) {
  const candidates = [
    post.boardId,
    post.board,
    post.bo,
    post.board_id,
    post.boardRef,
    post.boardPath
  ]
    .flatMap(extractBoardCandidates)
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);

  return candidates.some((value) => boardCandidates.has(value));
}

function matchesCategory(post, category) {
  if (!category) return true;
  return String(post.category || "") === String(category);
}

function isPublicPost(post) {
  return !Object.prototype.hasOwnProperty.call(post || {}, "isPublic") || post.isPublic === true;
}

function filterPostsForBoard(posts, category = null, publicOnly = false) {
  const boardCandidates = new Set(getBoardIdCandidates(currentBoard));
  return sortPostsByNewest(
    posts.filter((post) => {
      if (publicOnly && !isPublicPost(post)) return false;
      if (!matchesBoardCandidates(post, boardCandidates)) return false;
      return matchesCategory(post, category);
    })
  );
}

function clearGalleryDeleteState() {
  galleryDeleteMode = false;
  galleryDeleteStatus = { text: "", isError: false };
  selectedGalleryPostIds.clear();
}

function clearBoardDeleteState() {
  boardDeleteMode = false;
  boardDeleteStatus = { text: "", isError: false };
  selectedBoardPostIds.clear();
}

function clearLogDeleteState() {
  logDeleteMode = false;
  logDeleteStatus = { text: "", isError: false };
  selectedLogPostIds.clear();
}

function pruneGallerySelection() {
  const visibleIds = new Set(currentGalleryPosts.map((post) => post.id));
  Array.from(selectedGalleryPostIds).forEach((postId) => {
    if (!visibleIds.has(postId)) selectedGalleryPostIds.delete(postId);
  });
}

function pruneBoardSelection() {
  const visibleIds = new Set(currentBoardPosts.map((post) => post.id));
  Array.from(selectedBoardPostIds).forEach((postId) => {
    if (!visibleIds.has(postId)) selectedBoardPostIds.delete(postId);
  });
}

function pruneLogSelection() {
  const visibleIds = new Set(currentLogPosts.map((post) => post.id));
  Array.from(selectedLogPostIds).forEach((postId) => {
    if (!visibleIds.has(postId)) selectedLogPostIds.delete(postId);
  });
}

function setGalleryDeleteStatus(text = "", isError = false) {
  galleryDeleteStatus = { text, isError };
}

function setBoardDeleteStatus(text = "", isError = false) {
  boardDeleteStatus = { text, isError };
}

function setLogDeleteStatus(text = "", isError = false) {
  logDeleteStatus = { text, isError };
}

function renderDeleteStatus(status = {}) {
  if (!status.text) return "";
  return `<div class="board-admin-status${status.isError ? " is-error" : ""}" role="status">${escapeHtml(status.text)}</div>`;
}

function renderBoardAccessDeniedPage(board = {}) {
  const mainEl = document.querySelector("main.container");
  if (!mainEl) return;

  mainEl.classList.add("access-denied-shell");
  mainEl.innerHTML = renderAdminOnlyBoardNotice(board?.title || board?.name || boardId);
  setDocumentTitle("관리자 전용 게시판입니다.");
}

function renderHiddenBoardPage(board = {}) {
  const mainEl = document.querySelector("main.container");
  if (!mainEl) return;

  mainEl.classList.add("access-denied-shell");
  mainEl.innerHTML = renderHiddenBoardNotice(board?.title || board?.name || boardId);
  setDocumentTitle("준비 중인 게시판입니다.");
}

async function loadBoard() {
  try {
    clearGalleryDeleteState();
    clearBoardDeleteState();
    clearLogDeleteState();
    await loadCurrentSiteTitle();
    const boardRef = doc(db, "boards", boardId);
    const boardSnap = await getDoc(boardRef);

    if (boardSnap.exists()) {
      currentBoard = { id: boardSnap.id, ...boardSnap.data() };
    } else {
      const inferred = findSkinTypeByAlias(boardId);
      currentBoard = { id: boardId, title: boardId, skinType: inferred };
    }

    const auth = await getAuthSnapshot();
    readAuthCache = auth;
    if (isProfileBoard(currentBoard, boardId)) {
      renderHiddenBoardPage(currentBoard);
      return;
    }
    if (isAdminOnlyBoard(currentBoard) && !auth?.isAdmin) {
      renderBoardAccessDeniedPage(currentBoard);
      return;
    }

    try {
      currentSkin = await getSkin(currentBoard);
    } catch (skinError) {
      console.warn("Primary skin load failed, falling back to BOARD:", skinError);
      currentSkin = await getSkin("BOARD");
    }
    applyBoardWidth(currentBoard);

    document.getElementById("boardTitle").textContent = currentBoard.title || currentBoard.name || boardId;
    document.getElementById("boardDescription").textContent = currentBoard.description || "";
    setDocumentTitle(currentBoard.title || boardId);

    const writeBtn = document.getElementById("writeBtn");
    if (writeBtn) {
      writeBtn.href = `/write.html?bo=${encodeURIComponent(boardId)}`;
      await bindWriteButton(writeBtn);
    }

    resetGalleryPagination();
    try {
      await loadCategories();
    } catch (categoryError) {
      console.warn("Failed to load categories:", categoryError);
      renderCategoryFilter([]);
    }

    try {
      await renderBoardBySkin();
    } catch (renderError) {
      console.error("Failed to render board skin:", renderError);
      currentSkin = await getSkin("BOARD");
      await renderBoardBySkin();
    }
  } catch (error) {
    console.error("Failed to load board:", error);
    if (error?.code === "permission-denied" || /permission/i.test(error?.message || "")) {
      renderBoardAccessDeniedPage(currentBoard || { title: boardId });
      return;
    }
    const message = error?.message ? `: ${escapeHtml(error.message)}` : "";
    document.getElementById("boardContent").innerHTML =
      `<div class="notice">
        <div>게시판을 불러오지 못했습니다.${message}</div>
        <div class="actionRow" style="margin-top:8px;">
          <a class="btn" href="/admin/login.html">로그인</a>
          <button class="btn" type="button" onclick="location.reload()">다시 시도</button>
        </div>
      </div>`;
  }
}

async function refreshWriteButtonState(writeBtn) {
  const auth = await getAuthSnapshot();
  if (auth.isAdmin) {
    writeBtn.classList.remove("is-locked");
    writeBtn.textContent = "WRITE";
    return { canWrite: true, reason: "admin" };
  }

  const access = await canWriteToBoard(currentBoard);
  const canWrite = Boolean(access?.ok);
  writeBtn.classList.toggle("is-locked", !canWrite);
  writeBtn.textContent = canWrite ? "WRITE" : "WRITE(잠금)";
  return { canWrite, reason: access?.reason || "" };
}

async function bindWriteButton(writeBtn) {
  await refreshWriteButtonState(writeBtn);

  writeBtn.addEventListener("click", async (event) => {
    event.preventDefault();

    const auth = await getAuthSnapshot();
    if (auth.isAdmin) {
      location.href = writeBtn.href;
      return;
    }

    const access = await canWriteToBoard(currentBoard);
    if (access.ok) {
      location.href = writeBtn.href;
      return;
    }

    if (access.reason === "guest-disabled") {
      window.alert("이 게시판은 게스트 글쓰기를 허용하지 않습니다.");
      return;
    }

    if (access.reason === "admin-only") {
      window.alert("이 게시판은 관리자만 글을 쓸 수 있습니다.");
      return;
    }

    if (access.reason === "guest-locked" || access.reason === "guest-version-expired") {
      const code = await showInputModal({
        title: "게스트 코드 입력",
        description: "게스트 코드를 입력하면 글쓰기와 파일 업로드를 사용할 수 있습니다.",
        placeholder: "게스트 코드",
        inputType: "password",
        confirmText: "확인"
      });
      if (!code) return;

      const verified = await verifyGuestCode(code.trim());
      if (!verified.ok) {
        window.alert(verified.reason || "게스트 코드 확인 실패");
        return;
      }

      const state = await refreshWriteButtonState(writeBtn);
      if (state.canWrite) location.href = writeBtn.href;
      return;
    }

    window.alert("이 게시판은 작성 권한이 없습니다.");
  });
}

function finalizePosts(docs, category, publicOnly) {
  let posts = filterPostsForBoard(docs.map((item) => ({ id: item.id, ...item.data() })), category, publicOnly);

  if (targetLogNo) {
    posts = posts.filter((post) => {
      const skinData = getPostSkinData(post);
      return String(skinData.logNo || post.logNo || post.logNumber || "") === String(targetLogNo);
    });
  }

  return posts;
}

// Full-collection scan retained as a safety net for legacy posts whose board is
// stored in a non-`boardId` field, or when the board-scoped composite index is
// unavailable. The client-side filterPostsForBoard still enforces correctness.
async function loadAllPostsFallback(category, publicOnly) {
  const source = publicOnly
    ? query(collection(db, "posts"), where("isPublic", "in", [true, null]))
    : collection(db, "posts");
  const snapshot = await getDocs(source);
  return finalizePosts(snapshot.docs, category, publicOnly);
}

async function queryBoardScopedDocs(boardCandidates, publicOnly) {
  const postsCol = collection(db, "posts");

  if (!publicOnly) {
    // Admin: a single-field `in` (or `==`) needs only the automatic index.
    const source = boardCandidates.length === 1
      ? query(postsCol, where("boardId", "==", boardCandidates[0]))
      : query(postsCol, where("boardId", "in", boardCandidates));
    return (await getDocs(source)).docs;
  }

  // Guest: rules require a public constraint, and Firestore allows only one `in`
  // per query, so fan out per board candidate (boardId == X AND isPublic in ...).
  // Requires the composite index (boardId, isPublic); falls back on error.
  const snapshots = await Promise.all(
    boardCandidates.map((candidate) =>
      getDocs(query(postsCol, where("boardId", "==", candidate), where("isPublic", "in", [true, null])))
    )
  );

  const seen = new Set();
  const docs = [];
  snapshots.forEach((snapshot) => {
    snapshot.docs.forEach((docSnap) => {
      if (seen.has(docSnap.id)) return;
      seen.add(docSnap.id);
      docs.push(docSnap);
    });
  });
  return docs;
}

async function loadPosts(category = null) {
  const publicOnly = await shouldQueryPublicOnly();
  const boardCandidates = getBoardIdCandidates(currentBoard).filter(Boolean).slice(0, 10);

  if (boardCandidates.length === 0) {
    try {
      return await loadAllPostsFallback(category, publicOnly);
    } catch (error) {
      console.error("Failed to load posts:", error);
      return [];
    }
  }

  try {
    const docs = await queryBoardScopedDocs(boardCandidates, publicOnly);
    return finalizePosts(docs, category, publicOnly);
  } catch (error) {
    console.warn("Board-scoped post query failed; falling back to full scan.", error);
    try {
      return await loadAllPostsFallback(category, publicOnly);
    } catch (fallbackError) {
      console.error("Failed to load posts:", fallbackError);
      return [];
    }
  }
}

function extractBoardCandidates(value) {
  if (!value) return [];

  if (typeof value === "string") {
    const normalized = value.trim();
    const parts = normalized.split("/").filter(Boolean);
    const tail = parts.length ? parts[parts.length - 1] : normalized;
    return [normalized, tail];
  }

  if (typeof value === "object") {
    const values = [];
    if (typeof value.id === "string") values.push(value.id);
    if (typeof value.path === "string") values.push(value.path);
    if (typeof value._key?.path?.canonicalString === "function") {
      values.push(value._key.path.canonicalString());
    }
    return values.flatMap(extractBoardCandidates);
  }

  return [String(value)];
}

function resetGalleryPagination() {
  galleryPageState = {
    pageSize: getBoardPageSize(currentBoard),
    pages: new Map(),
    totalCount: 0
  };
}

async function loadGalleryPage(page, category = null) {
  const pageSize = getBoardPageSize(currentBoard);
  if (galleryPageState.pageSize !== pageSize) resetGalleryPagination();

  const cacheKey = `${category || "__all__"}:${page}`;
  const cached = galleryPageState.pages.get(cacheKey);
  if (cached) return cached;

  const posts = await loadPosts(category);
  galleryPageState.totalCount = posts.length;
  totalPages = Math.max(1, Math.ceil(galleryPageState.totalCount / pageSize));
  const start = (page - 1) * pageSize;
  const payload = {
    posts: posts.slice(start, start + pageSize),
    lastDoc: null
  };

  galleryPageState.pages.set(cacheKey, payload);
  return payload;
}

async function loadGalleryPageWithFallback(page, category = null) {
  return loadGalleryPage(page, category);
}

async function renderBoardBySkin() {
  currentSkin = currentSkin || await getSkin(currentBoard);
  const capabilities = currentSkin.capabilities;
  const contentEl = document.getElementById("boardContent");
  const searchSortEl = document.getElementById("boardSearchSort");
  const auth = readAuthCache || await getAuthSnapshot();
  readAuthCache = auth;

  if (capabilities.board.supportsSearchSort) {
    searchSortEl?.classList.remove("hidden");
    if (searchSortEl && !searchSortEl.querySelector("input")) renderBoardSearchSort();
  } else {
    searchSortEl?.classList.add("hidden");
  }

  let pagedPosts = [];

  if (capabilities.board.useCursorPagination && !singleMode) {
    const pageResult = await loadGalleryPageWithFallback(currentPage, currentCategory);
    pagedPosts = pageResult.posts;
  } else {
    const posts = await loadPosts(currentCategory);
    const pageSize = singleMode ? 1 : getBoardPageSize(currentBoard);
    totalPages = Math.max(1, Math.ceil(posts.length / pageSize));
    if (currentPage > totalPages) currentPage = totalPages;
    const start = (currentPage - 1) * pageSize;
    pagedPosts = posts.slice(start, start + pageSize);
  }

  currentBoardPosts = capabilities.board.deleteModeVariant === "board" ? pagedPosts : [];
  currentGalleryPosts = capabilities.board.deleteModeVariant === "gallery" ? pagedPosts : [];
  currentLogPosts = capabilities.board.deleteModeVariant === "log" ? pagedPosts : [];
  pruneBoardSelection();
  pruneGallerySelection();
  pruneLogSelection();

  const renderOptions = {
    deleteMode: capabilities.board.deleteModeVariant === "board"
      ? boardDeleteMode
      : capabilities.board.deleteModeVariant === "gallery"
        ? galleryDeleteMode
        : logDeleteMode,
    selectedPostIds: Array.from(
      capabilities.board.deleteModeVariant === "board"
        ? selectedBoardPostIds
        : capabilities.board.deleteModeVariant === "gallery"
          ? selectedGalleryPostIds
          : selectedLogPostIds
    ),
    isAdmin: Boolean(auth?.isAdmin),
    unlockedSecretPostIds: Array.from(
      capabilities.board.deleteModeVariant === "gallery"
        ? unlockedGallerySecretPostIds
        : capabilities.board.deleteModeVariant === "log"
          ? unlockedLogSecretPostIds
          : []
    )
  };

  contentEl.innerHTML = await currentSkin.renderBoardList(pagedPosts, currentBoard, renderOptions);

  if (capabilities.board.initLightbox) {
    initLightbox(pagedPosts.map((post) => post.id));
  }

  if (capabilities.board.deleteModeVariant === "board") {
    bindBoardDeleteActions(contentEl);
  } else if (capabilities.board.deleteModeVariant === "gallery") {
    bindGalleryLightbox(contentEl);
    bindGallerySecretUnlockActions(contentEl);
    bindGalleryDeleteActions(contentEl);
  } else if (capabilities.board.deleteModeVariant === "log") {
    bindLogSecretUnlockActions(contentEl);
    bindLogDeleteActions(contentEl);
  }

  await renderBoardAdminToolsCompact(currentSkin);
  renderPagination();
}

function bindBoardDeleteActions(container) {
  if (!boardDeleteMode) return;

  container.querySelectorAll("[data-board-select]").forEach((input) => {
    input.addEventListener("change", async () => {
      const postId = input.dataset.boardSelect || "";
      if (!postId) return;
      if (input.checked) selectedBoardPostIds.add(postId);
      else selectedBoardPostIds.delete(postId);

      const item = input.closest(".board-line-item");
      item?.classList.toggle("is-delete-selected", input.checked);
      await renderBoardAdminToolsCompact(currentSkin);
    });
  });
}

function bindGalleryLightbox(container) {
  container.querySelectorAll("[data-lightbox-image]").forEach((button) => {
    button.addEventListener("click", (event) => {
      if (galleryDeleteMode && button.dataset.deleteMode === "Y") {
        event.preventDefault();
        return;
      }
      const imageUrl = button.dataset.lightboxImage || "";
      if (!imageUrl || typeof window.openLightbox !== "function") return;
      window.openLightbox(imageUrl);
    });
  });
}

function bindGalleryDeleteActions(container) {
  if (!galleryDeleteMode) return;

  container.querySelectorAll("[data-gallery-select]").forEach((input) => {
    input.addEventListener("change", async () => {
      const postId = input.dataset.gallerySelect || "";
      if (!postId) return;
      if (input.checked) selectedGalleryPostIds.add(postId);
      else selectedGalleryPostIds.delete(postId);

      const card = input.closest(".gallery-card");
      card?.classList.toggle("is-delete-selected", input.checked);
      await renderBoardAdminToolsCompact(currentSkin);
    });
  });

  container.querySelectorAll("[data-gallery-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      const postId = button.dataset.galleryDelete || "";
      if (!postId) return;
      const post = currentGalleryPosts.find((item) => item.id === postId);
      const title = post?.title || postId;
      if (!window.confirm(`게시물 "${title}"을 삭제하시겠습니까?`)) return;
      await deletePosts([postId], "개별 삭제", "GALLERY");
    });
  });
}

function bindGallerySecretUnlockActions(container) {
  container.querySelectorAll(".gallery-secret-lock").forEach((secretBox) => {
    const card = secretBox.closest(".gallery-card");
    const postId = card?.dataset.postId || "";
    const input = secretBox.querySelector(".gallery-secret-input");
    const button = secretBox.querySelector(".gallery-secret-submit");
    const errorEl = secretBox.querySelector(".gallery-secret-error");
    if (!postId || !input || !button) return;

    const submit = async () => {
      if (button.disabled) return;
      const post = currentGalleryPosts.find((item) => item.id === postId);
      const password = input.value.trim();
      if (!post || !password) {
        showGallerySecretError(errorEl, "비밀번호를 입력해 주세요.");
        return;
      }

      button.disabled = true;
      hideGallerySecretError(errorEl);
      try {
        const ok = await verifySecretPassword(post, password);
        if (!ok) {
          showGallerySecretError(errorEl, "비밀번호가 일치하지 않습니다.");
          return;
        }

        unlockedGallerySecretPostIds.add(postId);
        await renderBoardBySkin();
      } finally {
        button.disabled = false;
      }
    };

    button.addEventListener("click", submit);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") submit();
    });
  });
}

function bindLogDeleteActions(container) {
  if (!logDeleteMode) return;

  container.querySelectorAll("[data-log-select]").forEach((input) => {
    input.addEventListener("change", async () => {
      const postId = input.dataset.logSelect || "";
      if (!postId) return;
      if (input.checked) selectedLogPostIds.add(postId);
      else selectedLogPostIds.delete(postId);

      const card = input.closest(".log-post");
      card?.classList.toggle("is-delete-selected", input.checked);
      await renderBoardAdminToolsCompact(currentSkin);
    });
  });

  container.querySelectorAll("[data-log-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      const postId = button.dataset.logDelete || "";
      if (!postId) return;
      const post = currentLogPosts.find((item) => item.id === postId);
      const title = post?.title || postId;
      if (!window.confirm(`게시물 "${title}"을 삭제하시겠습니까?`)) return;
      await deletePosts([postId], "개별 삭제", "LOG");
    });
  });
}

function bindLogSecretUnlockActions(container) {
  container.querySelectorAll(".log-hero-secret").forEach((secretBox) => {
    const card = secretBox.closest(".log-post");
    const postId = card?.dataset.postId || "";
    const input = secretBox.querySelector(".log-secret-input");
    const button = secretBox.querySelector(".log-secret-submit");
    const errorEl = secretBox.querySelector(".log-secret-error");
    if (!postId || !input || !button) return;

    const submit = async () => {
      if (button.disabled) return;
      const post = currentLogPosts.find((item) => item.id === postId);
      const password = input.value.trim();
      if (!post || !password) {
        showLogSecretError(errorEl, "비밀번호를 입력해 주세요.");
        return;
      }

      button.disabled = true;
      hideLogSecretError(errorEl);
      try {
        const ok = await verifySecretPassword(post, password);
        if (!ok) {
          showLogSecretError(errorEl, "비밀번호가 일치하지 않습니다.");
          return;
        }

        unlockedLogSecretPostIds.add(postId);
        await renderBoardBySkin();
      } finally {
        button.disabled = false;
      }
    };

    button.addEventListener("click", submit);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") submit();
    });
  });
}

async function verifySecretPassword(post, password) {
  if (!post?.isSecret) return true;
  if (!post.secretHash) return true;
  const hashed = await sha256Hex(`${post.secretSalt || ""}:${password}`);
  return hashed === post.secretHash;
}

function showGallerySecretError(errorEl, message) {
  if (!errorEl) return;
  errorEl.textContent = message;
  errorEl.classList.remove("hidden");
}

function hideGallerySecretError(errorEl) {
  if (!errorEl) return;
  errorEl.textContent = "";
  errorEl.classList.add("hidden");
}

function showLogSecretError(errorEl, message) {
  if (!errorEl) return;
  errorEl.textContent = message;
  errorEl.classList.remove("hidden");
}

function hideLogSecretError(errorEl) {
  if (!errorEl) return;
  errorEl.textContent = "";
  errorEl.classList.add("hidden");
}

async function renderBoardAdminToolsCompact(skin) {
  return renderBoardAdminToolsUnified(skin);
  if (!boardAdminToolsEl) return;

  const variant = skin?.capabilities?.board?.deleteModeVariant || "none";
  const isBoard = variant === "board";
  const isGallery = variant === "gallery";
  const isLog = variant === "log";
  if (variant === "none") {
    boardAdminToolsEl.classList.add("hidden");
    boardAdminToolsEl.innerHTML = "";
    return;
  }

  const auth = await getAuthSnapshot();
  const isAdmin = Boolean(auth?.isAdmin);
  boardAdminToolsEl.classList.toggle("hidden", !isAdmin);
  if (!isAdmin) {
    boardAdminToolsEl.innerHTML = "";
    return;
  }

  const deleteMode = isBoard ? boardDeleteMode : isGallery ? galleryDeleteMode : logDeleteMode;
  const currentPosts = isBoard ? currentBoardPosts : isGallery ? currentGalleryPosts : currentLogPosts;
  const selectedIds = isBoard ? selectedBoardPostIds : isGallery ? selectedGalleryPostIds : selectedLogPostIds;
  const status = isBoard ? boardDeleteStatus : isGallery ? galleryDeleteStatus : logDeleteStatus;
  const currentCount = currentPosts.length;
  const selectedCount = Array.from(selectedIds).filter((postId) => currentPosts.some((post) => post.id === postId)).length;
  const prefix = isBoard ? "board" : isGallery ? "gallery" : "log";
  const boardEditUrl = `/admin/boards.html?boardId=${encodeURIComponent(currentBoard?.id || boardId)}`;

  boardAdminToolsEl.innerHTML = `
    <div class="board-admin-tools">
      <button class="btn board-admin-toggle-btn ${deleteMode ? "primary" : ""}" type="button" id="toggle${prefix}DeleteModeBtn">
        ADMIN
      </button>
      ${deleteMode ? `
        ${isBoard ? "" : `<a class="btn board-admin-edit-btn" href="${boardEditUrl}">게시판수정</a>`}
        <span class="muted small board-admin-counts">현재 ${currentCount}개 / 선택 ${selectedCount}개</span>
        <button class="btn board-admin-action-btn" type="button" id="deleteSelected${prefix}Btn" ${selectedCount ? "" : "disabled"}>체크 삭제</button>
        <button class="btn board-admin-action-btn" type="button" id="deleteAll${prefix}Btn" ${currentCount ? "" : "disabled"}>전체 삭제</button>
        <button class="btn board-admin-action-btn" type="button" id="clear${prefix}SelectionBtn" ${selectedCount ? "" : "disabled"}>선택 해제</button>
      ` : ""}
    </div>
    ${renderDeleteStatus(status)}
  `;

  document.getElementById(`toggle${prefix}DeleteModeBtn`)?.addEventListener("click", async () => {
    if (isBoard) {
      boardDeleteMode = !boardDeleteMode;
      setBoardDeleteStatus("");
      if (!boardDeleteMode) selectedBoardPostIds.clear();
    } else if (isGallery) {
      galleryDeleteMode = !galleryDeleteMode;
      setGalleryDeleteStatus("");
      if (!galleryDeleteMode) selectedGalleryPostIds.clear();
    } else {
      logDeleteMode = !logDeleteMode;
      setLogDeleteStatus("");
      if (!logDeleteMode) selectedLogPostIds.clear();
    }
    await renderBoardBySkin();
  });

  document.getElementById(`clear${prefix}SelectionBtn`)?.addEventListener("click", async () => {
    selectedIds.clear();
    if (isBoard) setBoardDeleteStatus("");
    else if (isGallery) setGalleryDeleteStatus("");
    else setLogDeleteStatus("");
    await renderBoardAdminToolsCompact(currentSkin);
    const selector = isBoard ? "[data-board-select]" : isGallery ? "[data-gallery-select]" : "[data-log-select]";
    const cardSelector = isBoard ? ".board-line-item" : isGallery ? ".gallery-card" : ".log-post";
    document.querySelectorAll(selector).forEach((input) => {
      input.checked = false;
      input.closest(cardSelector)?.classList.remove("is-delete-selected");
    });
  });

  document.getElementById(`deleteSelected${prefix}Btn`)?.addEventListener("click", async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    if (!window.confirm(`선택한 게시물 ${ids.length}개를 삭제하시겠습니까?`)) return;
    await deletePosts(ids, "체크 삭제", skin?.type || resolveBoardSkinType(currentBoard));
  });

  document.getElementById(`deleteAll${prefix}Btn`)?.addEventListener("click", async () => {
    const allPosts = await loadPosts(currentCategory);
    if (!allPosts.length) return;
    const label = currentCategory ? "현재 카테고리 전체" : "현재 게시판 전체";
    if (!window.confirm(`${label} 게시물 ${allPosts.length}개를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) return;
    await deletePosts(allPosts.map((post) => post.id), "전체 삭제", skin?.type || resolveBoardSkinType(currentBoard));
  });
}

async function renderBoardAdminToolsUnified(skin) {
  if (!boardAdminToolsEl) return;

  const variant = skin?.capabilities?.board?.deleteModeVariant || "none";
  const isBoard = variant === "board";
  const isGallery = variant === "gallery";
  const isLog = variant === "log";
  if (variant === "none") {
    boardAdminToolsEl.classList.add("hidden");
    boardAdminToolsEl.innerHTML = "";
    return;
  }

  const auth = await getAuthSnapshot();
  const isAdmin = Boolean(auth?.isAdmin);
  boardAdminToolsEl.classList.toggle("hidden", !isAdmin);
  if (!isAdmin) {
    boardAdminToolsEl.innerHTML = "";
    return;
  }

  const deleteMode = isBoard ? boardDeleteMode : isGallery ? galleryDeleteMode : logDeleteMode;
  const currentPosts = isBoard ? currentBoardPosts : isGallery ? currentGalleryPosts : currentLogPosts;
  const selectedIds = isBoard ? selectedBoardPostIds : isGallery ? selectedGalleryPostIds : selectedLogPostIds;
  const status = isBoard ? boardDeleteStatus : isGallery ? galleryDeleteStatus : logDeleteStatus;
  const currentCount = currentPosts.length;
  const selectedCount = Array.from(selectedIds).filter((postId) => currentPosts.some((post) => post.id === postId)).length;
  const prefix = isBoard ? "board" : isGallery ? "gallery" : "log";
  const boardEditUrl = `/admin/boards.html?boardId=${encodeURIComponent(currentBoard?.id || boardId)}`;

  boardAdminToolsEl.innerHTML = `
    <div class="board-admin-tools">
      <button class="btn board-admin-toggle-btn ${deleteMode ? "primary" : ""}" type="button" id="toggle${prefix}DeleteModeBtn">
        ADMIN
      </button>
      ${deleteMode ? `
        ${isBoard ? "" : `<a class="btn board-admin-edit-btn" href="${boardEditUrl}">게시판수정</a>`}
        <span class="muted small board-admin-counts">현재 ${currentCount}개 / 선택 ${selectedCount}개</span>
        <button class="btn board-admin-action-btn" type="button" id="deleteSelected${prefix}Btn" ${selectedCount ? "" : "disabled"}>체크 삭제</button>
        <button class="btn board-admin-action-btn" type="button" id="deleteAll${prefix}Btn" ${currentCount ? "" : "disabled"}>전체 삭제</button>
        <button class="btn board-admin-action-btn" type="button" id="clear${prefix}SelectionBtn" ${selectedCount ? "" : "disabled"}>선택 해제</button>
      ` : ""}
    </div>
    ${renderDeleteStatus(status)}
  `;

  document.getElementById(`toggle${prefix}DeleteModeBtn`)?.addEventListener("click", async () => {
    if (isBoard) {
      boardDeleteMode = !boardDeleteMode;
      setBoardDeleteStatus("");
      if (!boardDeleteMode) selectedBoardPostIds.clear();
    } else if (isGallery) {
      galleryDeleteMode = !galleryDeleteMode;
      setGalleryDeleteStatus("");
      if (!galleryDeleteMode) selectedGalleryPostIds.clear();
    } else {
      logDeleteMode = !logDeleteMode;
      setLogDeleteStatus("");
      if (!logDeleteMode) selectedLogPostIds.clear();
    }
    await renderBoardBySkin();
  });

  document.getElementById(`clear${prefix}SelectionBtn`)?.addEventListener("click", async () => {
    selectedIds.clear();
    if (isBoard) setBoardDeleteStatus("");
    else if (isGallery) setGalleryDeleteStatus("");
    else setLogDeleteStatus("");
    await renderBoardAdminToolsUnified(currentSkin);
    const selector = isBoard ? "[data-board-select]" : isGallery ? "[data-gallery-select]" : "[data-log-select]";
    const cardSelector = isBoard ? ".board-line-item" : isGallery ? ".gallery-card" : ".log-post";
    document.querySelectorAll(selector).forEach((input) => {
      input.checked = false;
      input.closest(cardSelector)?.classList.remove("is-delete-selected");
    });
  });

  document.getElementById(`deleteSelected${prefix}Btn`)?.addEventListener("click", async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    if (!window.confirm(`선택한 게시물 ${ids.length}개를 삭제하시겠습니까?`)) return;
    await deletePosts(ids, "체크 삭제", skin?.type || resolveBoardSkinType(currentBoard));
  });

  document.getElementById(`deleteAll${prefix}Btn`)?.addEventListener("click", async () => {
    const allPosts = await loadPosts(currentCategory);
    if (!allPosts.length) return;
    const label = currentCategory ? "현재 카테고리 전체" : "현재 게시판 전체";
    if (!window.confirm(`${label} 게시물 ${allPosts.length}개를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) return;
    await deletePosts(allPosts.map((post) => post.id), "전체 삭제", skin?.type || resolveBoardSkinType(currentBoard));
  });
}

async function renderBoardAdminTools(skin) {
  if (!boardAdminToolsEl) return;

  const variant = skin?.capabilities?.board?.deleteModeVariant || "none";
  const isGallery = variant === "gallery";
  const isLog = variant === "log";
  if (variant === "none") {
    boardAdminToolsEl.classList.add("hidden");
    boardAdminToolsEl.innerHTML = "";
    return;
  }

  const auth = await getAuthSnapshot();
  const isAdmin = Boolean(auth?.isAdmin);
  boardAdminToolsEl.classList.toggle("hidden", !isAdmin);
  if (!isAdmin) {
    boardAdminToolsEl.innerHTML = "";
    return;
  }

  const deleteMode = isGallery ? galleryDeleteMode : logDeleteMode;
  const currentPosts = isGallery ? currentGalleryPosts : currentLogPosts;
  const selectedIds = isGallery ? selectedGalleryPostIds : selectedLogPostIds;
  const status = isGallery ? galleryDeleteStatus : logDeleteStatus;
  const currentCount = currentPosts.length;
  const selectedCount = Array.from(selectedIds).filter((postId) => currentPosts.some((post) => post.id === postId)).length;
  const prefix = isGallery ? "gallery" : "log";
  const label = isGallery ? "카드별 수정과 삭제, 체크 삭제" : "로그 번호 주변에 수정과 삭제 버튼";

  boardAdminToolsEl.innerHTML = `
    <div class="gallery-admin-tools card-lite">
      <div class="formRow gallery-admin-tools-row">
        <button class="btn ${deleteMode ? "primary" : ""}" type="button" id="toggle${prefix}DeleteModeBtn">
          ADMIN
        </button>
        ${deleteMode ? `
          <span class="muted small">현재 페이지 ${currentCount}개 / 선택 ${selectedCount}개</span>
          <button class="btn" type="button" id="deleteSelected${prefix}Btn" ${selectedCount ? "" : "disabled"}>체크 삭제</button>
          <button class="btn" type="button" id="deleteAll${prefix}Btn" ${currentCount ? "" : "disabled"}>전체 삭제</button>
          <button class="btn" type="button" id="clear${prefix}SelectionBtn" ${selectedCount ? "" : "disabled"}>선택 해제</button>
        ` : ""}
      </div>
      ${renderDeleteStatus(status)}
    </div>
  `;

  document.getElementById(`toggle${prefix}DeleteModeBtn`)?.addEventListener("click", async () => {
    if (isGallery) {
      galleryDeleteMode = !galleryDeleteMode;
      setGalleryDeleteStatus("");
      if (!galleryDeleteMode) selectedGalleryPostIds.clear();
    } else {
      logDeleteMode = !logDeleteMode;
      setLogDeleteStatus("");
      if (!logDeleteMode) selectedLogPostIds.clear();
    }
    await renderBoardBySkin();
  });

  document.getElementById(`clear${prefix}SelectionBtn`)?.addEventListener("click", async () => {
    selectedIds.clear();
    if (isGallery) setGalleryDeleteStatus("");
    else setLogDeleteStatus("");
    await renderBoardAdminToolsCompact(currentSkin);
    const selector = isGallery ? "[data-gallery-select]" : "[data-log-select]";
    const cardSelector = isGallery ? ".gallery-card" : ".log-post";
    document.querySelectorAll(selector).forEach((input) => {
      input.checked = false;
      input.closest(cardSelector)?.classList.remove("is-delete-selected");
    });
  });

  document.getElementById(`deleteSelected${prefix}Btn`)?.addEventListener("click", async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    if (!window.confirm(`선택한 게시물 ${ids.length}개를 삭제하시겠습니까?`)) return;
    await deletePosts(ids, "체크 삭제", skin?.type || resolveBoardSkinType(currentBoard));
  });

  document.getElementById(`deleteAll${prefix}Btn`)?.addEventListener("click", async () => {
    const allPosts = await loadPosts(currentCategory);
    if (!allPosts.length) return;
    const label = currentCategory ? "현재 카테고리 전체" : "현재 게시판 전체";
    if (!window.confirm(`${label} 게시물 ${allPosts.length}개를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) return;
    await deletePosts(allPosts.map((post) => post.id), "전체 삭제", skin?.type || resolveBoardSkinType(currentBoard));
  });
}

async function deletePosts(postIds, modeLabel, skinType) {
  const auth = await getAuthSnapshot();
  if (!auth.isAdmin) {
    if (skinType === "BOARD") setBoardDeleteStatus("관리자만 삭제할 수 있습니다.", true);
    if (skinType === "GALLERY") setGalleryDeleteStatus("관리자만 삭제할 수 있습니다.", true);
    if (skinType === "LOG") setLogDeleteStatus("관리자만 삭제할 수 있습니다.", true);
    await renderBoardAdminToolsCompact(currentSkin);
    return;
  }

  const uniqueIds = Array.from(new Set(postIds.filter(Boolean)));
  if (!uniqueIds.length) return;

  if (skinType === "BOARD") setBoardDeleteStatus(`${modeLabel} 진행 중...`);
  if (skinType === "GALLERY") setGalleryDeleteStatus(`${modeLabel} 진행 중...`);
  if (skinType === "LOG") setLogDeleteStatus(`${modeLabel} 진행 중...`);
  await renderBoardAdminToolsCompact(currentSkin);

  let deletedCount = 0;
  try {
    const result = await deletePostsByIds(uniqueIds);
    uniqueIds.forEach((postId) => {
      selectedBoardPostIds.delete(postId);
      selectedGalleryPostIds.delete(postId);
      selectedLogPostIds.delete(postId);
    });
    deletedCount = result.deletedPosts;
    resetGalleryPagination();
    const doneMessage = `${modeLabel} 완료 · ${deletedCount}개 삭제했습니다.`;
    if (skinType === "BOARD") setBoardDeleteStatus(doneMessage);
    if (skinType === "GALLERY") setGalleryDeleteStatus(doneMessage);
    if (skinType === "LOG") setLogDeleteStatus(doneMessage);
    await renderBoardBySkin();
  } catch (error) {
    console.error("Failed to delete posts:", error);
    if (skinType === "BOARD") setBoardDeleteStatus(error.message || `${modeLabel} 중 오류가 발생했습니다.`, true);
    if (skinType === "GALLERY") setGalleryDeleteStatus(error.message || `${modeLabel} 중 오류가 발생했습니다.`, true);
    if (skinType === "LOG") setLogDeleteStatus(error.message || `${modeLabel} 중 오류가 발생했습니다.`, true);
    await renderBoardAdminToolsCompact(currentSkin);
  }
}

async function loadCategories() {
  try {
    const q = query(collection(db, "categories"), where("boardId", "==", boardId));
    const snapshot = await getDocs(q);
    const categories = snapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .sort((a, b) => {
        const orderA = Number.isFinite(Number(a.order)) ? Number(a.order) : Number.MAX_SAFE_INTEGER;
        const orderB = Number.isFinite(Number(b.order)) ? Number(b.order) : Number.MAX_SAFE_INTEGER;
        if (orderA !== orderB) return orderA - orderB;
        return String(a.name || "").localeCompare(String(b.name || ""));
      });
    renderCategoryFilter(categories);
  } catch (_error) {
    renderCategoryFilter([]);
  }
}

function renderCategoryFilter(categories) {
  const filterEl = document.getElementById("categoryFilter");
  if (!filterEl) return;
  if (!categories.length || targetLogNo || singleMode) {
    filterEl.innerHTML = "";
    return;
  }

  const buttons = [
    `<button class="btn ${!currentCategory ? "primary" : ""}" data-category="">전체</button>`,
    ...categories.map((cat) => `<button class="btn ${currentCategory === cat.id ? "primary" : ""}" data-category="${cat.id}">${cat.name}</button>`)
  ];

  filterEl.innerHTML = `<div class="formRow">${buttons.join("")}</div>`;
  filterEl.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", async () => {
      currentCategory = button.dataset.category || null;
      currentPage = 1;
      resetGalleryPagination();
      selectedGalleryPostIds.clear();
      await renderBoardBySkin();
    });
  });
}

function renderBoardSearchSort() {
  const searchSortEl = document.getElementById("boardSearchSort");
  if (!searchSortEl) return;

  searchSortEl.innerHTML = `
    <div class="formRow">
      <input type="text" id="boardSearchInput" placeholder="제목/본문 검색" style="flex:1;">
      <select id="boardSortSelect">
        <option value="date-desc">최신순</option>
        <option value="date-asc">오래된순</option>
        <option value="title-asc">제목순</option>
      </select>
      <button class="btn" id="boardSearchBtn">적용</button>
    </div>
  `;

  document.getElementById("boardSearchBtn")?.addEventListener("click", applyBoardSearchSort);
  document.getElementById("boardSearchInput")?.addEventListener("keypress", (event) => {
    if (event.key === "Enter") applyBoardSearchSort();
  });
  document.getElementById("boardSortSelect")?.addEventListener("change", applyBoardSearchSort);
}

async function applyBoardSearchSort() {
  const searchTerm = document.getElementById("boardSearchInput")?.value?.trim() || "";
  const sort = document.getElementById("boardSortSelect")?.value || "date-desc";
  window.setBoardSearch(searchTerm);
  window.setBoardSort(sort);
  await renderBoardBySkin();
}

function renderPagination() {
  const paginationEls = ["paginationTop", "pagination"]
    .map((id) => document.getElementById(id))
    .filter(Boolean);
  if (!paginationEls.length) return;

  const isDisabled = singleMode || totalPages <= 1;
  const pages = isDisabled ? [] : getPaginationPages(currentPage, totalPages);
  const paginationHtml = isDisabled ? "" : `
    <div class="pagination-list" aria-label="pagination">
      <button type="button" class="pagination-btn pagination-arrow" data-page="1" ${currentPage <= 1 ? "disabled" : ""} aria-label="泥??섏씠吏">&laquo;</button>
      <button type="button" class="pagination-btn pagination-arrow" data-page="${currentPage - 1}" ${currentPage <= 1 ? "disabled" : ""} aria-label="?댁쟾 ?섏씠吏">&lsaquo;</button>
      ${pages.map((page) => `
        <button
          type="button"
          class="pagination-btn${page === currentPage ? " is-active" : ""}"
          data-page="${page}"
          ${page === currentPage ? `aria-current="page"` : ""}
        >${page}</button>
      `).join("")}
      <button type="button" class="pagination-btn pagination-arrow" data-page="${currentPage + 1}" ${currentPage >= totalPages ? "disabled" : ""} aria-label="?ㅼ쓬 ?섏씠吏">&rsaquo;</button>
      <button type="button" class="pagination-btn pagination-arrow" data-page="${totalPages}" ${currentPage >= totalPages ? "disabled" : ""} aria-label="留덉?留??섏씠吏">&raquo;</button>
    </div>
  `;

  paginationEls.forEach((paginationEl) => {
    paginationEl.classList.toggle("hidden", isDisabled);
    paginationEl.innerHTML = paginationHtml;

    if (isDisabled) return;

    paginationEl.querySelectorAll("[data-page]").forEach((button) => {
      button.addEventListener("click", async () => {
        const nextPage = Number(button.dataset.page);
        if (!Number.isFinite(nextPage) || nextPage === currentPage) return;
        if (nextPage < 1 || nextPage > totalPages) return;

        currentPage = nextPage;
        selectedGalleryPostIds.clear();
        selectedLogPostIds.clear();
        await renderBoardBySkin();
      });
    });
  });
}

function getPaginationPages(page, total) {
  const maxVisible = 10;
  if (total <= maxVisible) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }

  const half = Math.floor(maxVisible / 2);
  let start = page - half + 1;
  let end = start + maxVisible - 1;

  if (start < 1) {
    start = 1;
    end = maxVisible;
  }

  if (end > total) {
    end = total;
    start = total - maxVisible + 1;
  }

  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}

document.getElementById("year").textContent = new Date().getFullYear();
loadBoard();
