import { db } from "../core/firebase.js";
import { ensureAdminPageAccess } from "../core/state.js";
import { getSkin, getSkinEditor } from "../skins/registry.js";
import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

let postId = "";
let boardId = "";
let kickerEl = null;
let titleEl = null;
let metaEl = null;
let backLink = null;
let actionsEl = null;
let noticeEl = null;
let loadingEl = null;
let rootEl = null;
let activeEditor = null;

function showNotice(message, isError = false) {
  if (!noticeEl) return;
  noticeEl.textContent = String(message || "");
  noticeEl.classList.toggle("hidden", !message);
  noticeEl.classList.toggle("notice-error", Boolean(isError));
}

function showFatal(message) {
  loadingEl?.classList.add("hidden");
  rootEl?.classList.add("hidden");
  actionsEl?.replaceChildren();
  showNotice(message, true);
}

async function loadDocument(collectionName, id, missingMessage) {
  const snapshot = await getDoc(doc(db, collectionName, id));
  if (!snapshot.exists()) throw new Error(missingMessage);
  return { id: snapshot.id, ...snapshot.data() };
}

async function init(context = {}) {
  const access = await ensureAdminPageAccess();
  if (!access.ok || isInactive(context)) return;
  if (!postId) {
    showFatal("편집할 게시물 ID가 없습니다.");
    return;
  }

  try {
    const post = await loadDocument("posts", postId, "편집할 게시물을 찾을 수 없습니다.");
    if (isInactive(context)) return;
    boardId = boardId || String(post.boardId || "").trim();
    if (!boardId) throw new Error("게시판 정보를 찾을 수 없습니다.");

    const board = await loadDocument("boards", boardId, "게시판을 찾을 수 없습니다.");
    if (isInactive(context)) return;
    const skin = await getSkin(board);
    if (isInactive(context)) return;
    const editor = await getSkinEditor(skin?.type || board);
    if (isInactive(context)) return;
    if (!editor) throw new Error("이 스킨에는 별도 편집기가 없습니다.");

    const editorContext = { post, board, skin, postId, boardId };
    if (typeof editor.canEdit === "function" && !(await editor.canEdit(editorContext))) {
      throw new Error(editor.unavailableMessage || "이 게시물은 스킨 편집기를 사용할 수 없습니다.");
    }

    const postTitle = post.title || board.title || board.name || "게시물";
    document.body.classList.add(`skin-${String(skin.type || "board").toLowerCase()}-editor-page`);
    document.title = `${postTitle} 편집`;
    if (kickerEl) kickerEl.textContent = editor.kicker || `${skin.type || "SKIN"} EDITOR`;
    if (titleEl) titleEl.textContent = postTitle;
    if (metaEl) metaEl.textContent = board.title || board.name || boardId;
    if (backLink) backLink.href = `view.html?id=${encodeURIComponent(postId)}&bo=${encodeURIComponent(boardId)}`;

    activeEditor = editor;
    await editor.mount({
      ...editorContext,
      root: rootEl,
      ui: {
        titleEl,
        metaEl,
        backLink,
        actionsEl,
        noticeEl,
        loadingEl,
        showNotice
      }
    });
    if (isInactive(context)) return;

    loadingEl?.classList.add("hidden");
    rootEl?.classList.remove("hidden");
  } catch (error) {
    if (isInactive(context)) return;
    console.error("Skin editor init failed:", error);
    showFatal(error.message || "스킨 편집기를 열지 못했습니다.");
  }
}

export async function initializeSkinEditorPage(context = {}) {
  cleanupSkinEditorPage();
  const params = new URLSearchParams(window.location.search);
  postId = String(params.get("id") || "").trim();
  boardId = String(params.get("bo") || "").trim();
  kickerEl = document.getElementById("skinEditorKicker");
  titleEl = document.getElementById("skinEditorTitle");
  metaEl = document.getElementById("skinEditorMeta");
  backLink = document.getElementById("skinEditorBack");
  actionsEl = document.getElementById("skinEditorActions");
  noticeEl = document.getElementById("skinEditorNotice");
  loadingEl = document.getElementById("skinEditorLoading");
  rootEl = document.getElementById("skinEditorRoot");
  await init(context);
}

export function canLeaveSkinEditorPage() {
  return typeof activeEditor?.canLeave === "function" ? activeEditor.canLeave() !== false : true;
}

export function cleanupSkinEditorPage() {
  try {
    activeEditor?.unmount?.();
  } finally {
    activeEditor = null;
    postId = "";
    boardId = "";
    kickerEl = null;
    titleEl = null;
    metaEl = null;
    backLink = null;
    actionsEl = null;
    noticeEl = null;
    loadingEl = null;
    rootEl = null;
  }
}

function isInactive(context = {}) {
  return Boolean(context.signal?.aborted || (context.isActive && !context.isActive()));
}
