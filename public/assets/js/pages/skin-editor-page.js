import { db } from "../core/firebase.js";
import { ensureAdminPageAccess } from "../core/state.js";
import { getSkin, getSkinEditor } from "../skins/registry.js";
import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const params = new URLSearchParams(window.location.search);
const postId = String(params.get("id") || "").trim();
let boardId = String(params.get("bo") || "").trim();

const kickerEl = document.getElementById("skinEditorKicker");
const titleEl = document.getElementById("skinEditorTitle");
const metaEl = document.getElementById("skinEditorMeta");
const backLink = document.getElementById("skinEditorBack");
const actionsEl = document.getElementById("skinEditorActions");
const noticeEl = document.getElementById("skinEditorNotice");
const loadingEl = document.getElementById("skinEditorLoading");
const rootEl = document.getElementById("skinEditorRoot");

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

async function init() {
  const access = await ensureAdminPageAccess();
  if (!access.ok) return;
  if (!postId) {
    showFatal("편집할 게시물 ID가 없습니다.");
    return;
  }

  try {
    const post = await loadDocument("posts", postId, "편집할 게시물을 찾을 수 없습니다.");
    boardId = boardId || String(post.boardId || "").trim();
    if (!boardId) throw new Error("게시판 정보를 찾을 수 없습니다.");

    const board = await loadDocument("boards", boardId, "게시판을 찾을 수 없습니다.");
    const skin = await getSkin(board);
    const editor = await getSkinEditor(skin?.type || board);
    if (!editor) throw new Error("이 스킨에는 별도 편집기가 없습니다.");

    const context = { post, board, skin, postId, boardId };
    if (typeof editor.canEdit === "function" && !(await editor.canEdit(context))) {
      throw new Error(editor.unavailableMessage || "이 게시물은 스킨 편집기를 사용할 수 없습니다.");
    }

    const postTitle = post.title || board.title || board.name || "게시물";
    document.body.classList.add(`skin-${String(skin.type || "board").toLowerCase()}-editor-page`);
    document.title = `${postTitle} 편집`;
    if (kickerEl) kickerEl.textContent = editor.kicker || `${skin.type || "SKIN"} EDITOR`;
    if (titleEl) titleEl.textContent = postTitle;
    if (metaEl) metaEl.textContent = board.title || board.name || boardId;
    if (backLink) backLink.href = `view.html?id=${encodeURIComponent(postId)}&bo=${encodeURIComponent(boardId)}`;

    await editor.mount({
      ...context,
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

    loadingEl?.classList.add("hidden");
    rootEl?.classList.remove("hidden");
  } catch (error) {
    console.error("Skin editor init failed:", error);
    showFatal(error.message || "스킨 편집기를 열지 못했습니다.");
  }
}

init();
