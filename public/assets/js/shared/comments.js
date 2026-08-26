import { db, storage } from "../core/firebase.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  orderBy,
  addDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  deleteDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getDownloadURL,
  ref as storageRef,
  uploadBytes
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import { sanitizeHTML } from "./html-sanitizer-v2.js";
import { findSkinTypeByAlias, resolveBoardSkinType } from "../skins/registry.js";
import { getAuthSnapshot, getGuestProofHash, isGuestUnlocked, sha256Hex, verifyGuestCode } from "../core/state.js";
import { showInputModal } from "./ui-modal.js";

const unlockedSecretCommentIds = new Set();
const expandedCommentIds = new Set();
const expandedCommentFormPosts = new Set();
const editingCommentIds = new Set();
const commentEditDrafts = new Map();
const replyingToCommentByPost = new Map();
const postCache = new Map();
const boardCache = new Map();
const COMMENT_UNLOCK_STORAGE_KEY = "archive_unlocked_secret_comment_ids";

/* 댓글 이미지 첨부 (allowImages 컨텍스트에서만 활성) */
const MAX_COMMENT_IMAGES = 8;
const COMMENT_IMAGE_MAX_EDGE = 1400;
const pendingCommentImagesByPost = new Map();

function getPendingCommentImages(postId) {
  return pendingCommentImagesByPost.get(postId) || [];
}

function clearPendingCommentImages(postId) {
  getPendingCommentImages(postId).forEach((item) => {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  });
  pendingCommentImagesByPost.delete(postId);
}

// 비율 유지 리사이즈 → WebP (움짤 GIF는 원본 유지)
async function resizeCommentImage(file) {
  if (!/^image\//i.test(file.type || "")) throw new Error("이미지 파일만 첨부할 수 있습니다.");
  if (/^image\/gif$/i.test(file.type)) {
    if (file.size > 8 * 1024 * 1024) throw new Error("GIF는 8MB 이하만 첨부할 수 있습니다.");
    return file;
  }

  const bitmap = await createImageBitmap(file);
  try {
    if (!bitmap.width || !bitmap.height) throw new Error("이미지 크기를 확인할 수 없습니다.");
    const scale = Math.min(1, COMMENT_IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const canvasContext = canvas.getContext("2d", { alpha: true });
    if (!canvasContext) throw new Error("이미지를 변환할 수 없습니다.");
    canvasContext.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
    if (!(blob instanceof Blob)) throw new Error("이미지 변환에 실패했습니다.");
    return blob;
  } finally {
    bitmap.close?.();
  }
}

function renderPendingCommentImages(postId) {
  return getPendingCommentImages(postId).map((item, index) => `
    <span class="comment-image-preview">
      <img src="${escapeHtml(item.previewUrl)}" alt="첨부 예정 이미지">
      <button type="button" class="comment-image-remove" data-comment-image-remove="${index}" aria-label="첨부 취소">&times;</button>
    </span>
  `).join("");
}

function refreshPendingCommentImages(container, postId) {
  const previews = container.querySelector(`[data-comment-image-previews="${CSS.escape(postId)}"]`);
  if (!previews) return;
  previews.innerHTML = renderPendingCommentImages(postId);
  previews.classList.toggle("hidden", !getPendingCommentImages(postId).length);
}

async function addCommentImages(container, postId, files) {
  const incoming = Array.from(files || []).filter((file) => /^image\//i.test(file?.type || ""));
  if (!incoming.length) return false;

  const pending = getPendingCommentImages(postId);
  if (pending.length + incoming.length > MAX_COMMENT_IMAGES) {
    window.alert(`이미지는 댓글당 최대 ${MAX_COMMENT_IMAGES}장까지 첨부할 수 있습니다.`);
    return true;
  }

  try {
    for (const file of incoming) {
      const blob = await resizeCommentImage(file);
      pending.push({ blob, previewUrl: URL.createObjectURL(blob) });
    }
    pendingCommentImagesByPost.set(postId, pending);
    refreshPendingCommentImages(container, postId);
  } catch (error) {
    window.alert(error?.message || "이미지를 처리하지 못했습니다.");
  }
  return true;
}

function bindCommentImageControls(container, postId, context) {
  if (!context.allowImages) return;
  const attachBtn = container.querySelector(`[data-comment-image-attach="${CSS.escape(postId)}"]`);
  const fileInput = container.querySelector(`[data-comment-image-input="${CSS.escape(postId)}"]`);
  const previews = container.querySelector(`[data-comment-image-previews="${CSS.escape(postId)}"]`);
  const memoInput = document.getElementById(`comment-content-${postId}`);

  attachBtn?.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("change", async () => {
    await addCommentImages(container, postId, fileInput.files);
    fileInput.value = "";
  });
  memoInput?.addEventListener("paste", async (event) => {
    const files = Array.from(event.clipboardData?.files || []).filter((file) => /^image\//i.test(file.type || ""));
    if (!files.length) return;
    event.preventDefault();
    await addCommentImages(container, postId, files);
  });
  previews?.addEventListener("click", (event) => {
    const removeBtn = event.target instanceof Element ? event.target.closest("[data-comment-image-remove]") : null;
    if (!removeBtn) return;
    const index = Number(removeBtn.dataset.commentImageRemove);
    const pending = getPendingCommentImages(postId);
    if (!Number.isInteger(index) || index < 0 || index >= pending.length) return;
    if (pending[index].previewUrl) URL.revokeObjectURL(pending[index].previewUrl);
    pending.splice(index, 1);
    refreshPendingCommentImages(container, postId);
  });
}

function bindCommentImageViews(container) {
  container.querySelectorAll("[data-comment-image-view]").forEach((button) => {
    button.addEventListener("click", () => {
      const url = String(button.dataset.commentImageView || "");
      if (!url) return;
      if (typeof window.openLightbox === "function") window.openLightbox(url);
      else window.open(url, "_blank", "noopener");
    });
  });
}

function renderCommentImages(comment) {
  const images = Array.isArray(comment?.images) ? comment.images.filter((item) => item?.url) : [];
  if (!images.length) return "";
  return `
    <div class="comment-images">
      ${images.map((item) => `
        <button type="button" class="comment-image-view" data-comment-image-view="${escapeHtml(item.url)}" aria-label="댓글 이미지 원본 보기">
          <img src="${escapeHtml(item.url)}" alt="댓글 이미지" loading="lazy">
        </button>
      `).join("")}
    </div>
  `;
}

function commentRandomId(length = 8) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => byte.toString(36)).join("").slice(0, length);
}

async function createCommentUploadToken(boardId) {
  const proofHash = getGuestProofHash();
  if (!proofHash) throw new Error("게스트 코드를 먼저 입력하세요.");
  const tokenRef = doc(collection(db, "guest_upload_tokens"));
  await setDoc(tokenRef, { boardId, proofHash, createdAt: serverTimestamp() });
  return tokenRef.id;
}

async function uploadCommentImages(postId, context, auth) {
  const pending = getPendingCommentImages(postId);
  if (!pending.length) return [];
  const boardId = context.boardId || context.board?.id || "";
  if (!boardId) throw new Error("게시판 정보를 찾을 수 없어 이미지를 올릴 수 없습니다.");

  // 게스트 코드 제한 댓글은 업로드 토큰 경유, 그 외(관리자/누구나)는 직접 업로드
  const useToken = !auth.isAdmin && context.commentScope === "guest";
  const output = [];
  for (const item of pending) {
    const extension = /^image\/gif$/i.test(item.blob.type || "") ? "gif" : "webp";
    const path = `comment_images/${boardId}/${Date.now()}_${commentRandomId(8)}.${extension}`;
    const tokenId = useToken ? await createCommentUploadToken(boardId) : "";
    try {
      const snapshot = await uploadBytes(storageRef(storage, path), item.blob, {
        contentType: item.blob.type || "image/webp",
        cacheControl: "public,max-age=3600",
        customMetadata: { boardId, ...(tokenId ? { uploadToken: tokenId } : {}) }
      });
      output.push({ url: await getDownloadURL(snapshot.ref), path: snapshot.ref.fullPath });
    } finally {
      if (tokenId) deleteDoc(doc(db, "guest_upload_tokens", tokenId)).catch(() => {});
    }
  }
  return output;
}

function loadUnlockedSecretCommentIds() {
  try {
    const raw = sessionStorage.getItem(COMMENT_UNLOCK_STORAGE_KEY);
    const values = raw ? JSON.parse(raw) : [];
    if (Array.isArray(values)) {
      values.forEach((value) => {
        if (value) unlockedSecretCommentIds.add(String(value));
      });
    }
  } catch (_error) {
    // ignore storage parse errors
  }
}

function persistUnlockedSecretCommentIds() {
  try {
    sessionStorage.setItem(COMMENT_UNLOCK_STORAGE_KEY, JSON.stringify(Array.from(unlockedSecretCommentIds)));
  } catch (_error) {
    // ignore storage write errors
  }
}

loadUnlockedSecretCommentIds();

function isCommentSecretUnlocked(commentId, auth) {
  return Boolean(auth?.isAdmin || unlockedSecretCommentIds.has(String(commentId || "")));
}

function commentsCol(postId) {
  return collection(db, "posts", postId, "comments");
}

function normalizeScope(value) {
  return String(value || "all").trim().toLowerCase() === "guest" ? "guest" : "all";
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}

function preserveLineBreaks(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\n/g, "<br>\n");
}

function isLogCommentContext(context) {
  const board = context?.board || {};
  const boardId = board.id || context?.boardId || "";
  return resolveBoardSkinType(board) === "LOG" || findSkinTypeByAlias(boardId) === "LOG";
}

// LOG 스킨 게시판 댓글에서만 유튜브 embed iframe을 허용한다.
function commentIframePolicy(context) {
  return isLogCommentContext(context) ? "youtube" : false;
}

function sanitizeCommentHtml(value, context) {
  return sanitizeHTML(preserveLineBreaks(value), { allowIframes: commentIframePolicy(context) });
}

function formatDateTime(value) {
  const date = value?.toDate ? value.toDate() : new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return "";
  return `${date.toLocaleDateString("ko-KR")} ${date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`;
}

// 길이 기준 자동 접기는 사용하지 않음 — 작성 시 "접기"를 체크한 댓글만 접는다.
function estimateCommentFold(comment) {
  return Boolean(comment?.more);
}

async function resolveCommentContext(postId, options = {}) {
  let post = options.post || postCache.get(postId) || null;
  if (!post) {
    const postSnap = await getDoc(doc(db, "posts", postId));
    post = postSnap.exists() ? { id: postSnap.id, ...postSnap.data() } : { id: postId };
    postCache.set(postId, post);
  }

  const boardId = options.boardId || post.boardId || options.board?.id || "";
  let board = options.board || (boardId ? boardCache.get(boardId) || null : null);

  if (!board && boardId) {
    const boardSnap = await getDoc(doc(db, "boards", boardId));
    board = boardSnap.exists() ? { id: boardSnap.id, ...boardSnap.data() } : { id: boardId };
    boardCache.set(boardId, board);
  }

  return {
    post,
    board: board || { id: boardId || "" },
    boardId: boardId || board?.id || "",
    commentScope: normalizeScope(options.commentScope || board?.commentScope || board?.commentPermission || "all"),
    manageComments: Boolean(options.manageComments),
    allowImages: Boolean(options.allowImages),
    dateFirstHeader: Boolean(options.dateFirstHeader)
  };
}

async function resolveWriteState(context) {
  const auth = await getAuthSnapshot();
  if (auth.isAdmin) {
    return { auth, canWrite: true, needsGuestUnlock: false };
  }

  if (context.commentScope === "guest" && !isGuestUnlocked()) {
    return { auth, canWrite: false, needsGuestUnlock: true };
  }

  return {
    auth,
    canWrite: true,
    needsGuestUnlock: false
  };
}

async function resolveAdminNickname(auth) {
  if (!auth?.isAdmin || !auth?.user?.uid) return "";

  const profileSnap = await getDoc(doc(db, "admin_users", auth.user.uid));
  return String(
    (profileSnap.exists() ? profileSnap.data()?.nickname : "")
      || auth.user.email
      || "ADMIN"
  ).trim();
}

function renderCommentForm(postId, writeState, context = {}) {
  if (!writeState.canWrite && writeState.needsGuestUnlock) {
    return "";
  }

  const formExpanded = expandedCommentFormPosts.has(postId);
  return `
    <div class="comment-form" data-comment-form="${escapeHtml(postId)}">
      <div class="comment-form-head">
        <button type="button" class="comment-form-toggle" data-comment-form-toggle="${escapeHtml(postId)}" aria-label="댓글 작성 폼 열기">
          ▼
        </button>
      </div>

      <div class="comment-form-body${formExpanded ? "" : " hidden"}" data-comment-form-body="${escapeHtml(postId)}">
        ${writeState.auth?.isAdmin ? "" : `
          <div class="comment-form-row comment-form-row-name">
            <input
              type="text"
              id="comment-author-${escapeHtml(postId)}"
              class="comment-name-input"
              placeholder="닉네임"
            >
          </div>
        `}

        <div class="comment-form-row">
          <textarea
            id="comment-content-${escapeHtml(postId)}"
            class="comment-memo-input"
            rows="3"
            placeholder="내용"
          ></textarea>
        </div>

        ${context.allowImages ? `
          <div class="comment-form-row comment-form-row-inline comment-image-row">
            <button type="button" class="btn small" data-comment-image-attach="${escapeHtml(postId)}">이미지 첨부</button>
            <input type="file" class="hidden" accept="image/*" multiple data-comment-image-input="${escapeHtml(postId)}">
          </div>
          <div class="comment-image-previews${getPendingCommentImages(postId).length ? "" : " hidden"}" data-comment-image-previews="${escapeHtml(postId)}">
            ${renderPendingCommentImages(postId)}
          </div>
        ` : ""}

        <div class="comment-form-row comment-form-row-inline comment-form-row-options">
          <label class="comment-toggle" for="comment-more-${escapeHtml(postId)}">
            <input type="checkbox" id="comment-more-${escapeHtml(postId)}">
            <span>접기</span>
          </label>

          <label class="comment-toggle" for="comment-secret-${escapeHtml(postId)}">
            <input type="checkbox" id="comment-secret-${escapeHtml(postId)}">
            <span>비밀</span>
          </label>

          <span class="comment-secret-pass-wrap hidden" id="comment-secret-pass-wrap-${escapeHtml(postId)}">
            <span class="comment-pass-label">비밀번호</span>
            <input
              type="password"
              id="comment-secret-pass-${escapeHtml(postId)}"
              class="comment-pass-input"
              placeholder="비밀번호"
            >
          </span>

          <button type="button" class="btn primary comment-submit-btn" data-comment-submit="${escapeHtml(postId)}">등록</button>
        </div>
      </div>
    </div>
  `;
}
function renderReplyForm(comment, context, writeState) {
  if (!writeState.canWrite) return "";
  if (replyingToCommentByPost.get(context.post.id) !== comment.id) return "";

  return `
    <div class="comment-reply-form" data-comment-reply-form="${escapeHtml(comment.id)}">
      ${writeState.auth?.isAdmin ? "" : `
        <input
          type="text"
          class="comment-name-input"
          data-comment-reply-author="${escapeHtml(comment.id)}"
          placeholder="닉네임"
        >
      `}
      <textarea
        class="comment-memo-input"
        data-comment-reply-content="${escapeHtml(comment.id)}"
        rows="3"
        placeholder="답글 내용"
      ></textarea>
      <div class="comment-form-row-inline comment-form-row-options">
        <label class="comment-toggle">
          <input type="checkbox" data-comment-reply-more="${escapeHtml(comment.id)}">
          <span>접기</span>
        </label>
        <label class="comment-toggle">
          <input type="checkbox" data-comment-reply-secret="${escapeHtml(comment.id)}">
          <span>비밀</span>
        </label>
        <span class="comment-secret-pass-wrap hidden" data-comment-reply-secret-wrap="${escapeHtml(comment.id)}">
          <span class="comment-pass-label">비밀번호</span>
          <input
            type="password"
            class="comment-pass-input"
            data-comment-reply-secret-pass="${escapeHtml(comment.id)}"
            placeholder="비밀번호"
          >
        </span>
        <button
          type="button"
          class="btn primary comment-submit-btn"
          data-comment-reply-submit="${escapeHtml(comment.id)}"
        >등록</button>
      </div>
    </div>
  `;
}

function renderCommentBodyV2(comment, context, writeState) {
  const auth = writeState.auth;
  const raw = String(comment.contentHtml || comment.content || "");
  const html = enhanceCommentLinks(sanitizeHTML(raw, { allowIframes: commentIframePolicy(context) }), context.boardId);
  const author = escapeHtml(comment.nickname || "익명");
  const dateStr = formatDateTime(comment.createdAt);
  const manuallyFolded = Boolean(comment.more);
  const foldable = manuallyFolded || estimateCommentFold(comment);
  const bodyId = `comment-body-${comment.id}`;
  const expanded = expandedCommentIds.has(comment.id);
  const bodyClass = [
    "comment-content",
    manuallyFolded ? "is-manual-fold" : "is-auto-fold",
    foldable && !expanded ? "is-folded" : ""
  ].filter(Boolean).join(" ");
  const canManage = auth?.isAdmin && context.manageComments;
  const isSecret = Boolean(comment.isSecret);
  const unlocked = isCommentSecretUnlocked(comment.id, auth);
  const isEditing = canManage && editingCommentIds.has(comment.id);
  const replyExpanded = replyingToCommentByPost.get(context.post.id) === comment.id;
  const replyButton = writeState.canWrite ? `
    <button
      type="button"
      class="comment-reply-btn muted small"
      data-comment-reply="${escapeHtml(comment.id)}"
      aria-label="${escapeHtml(comment.nickname || "익명")}님 댓글에 답글 달기"
      aria-expanded="${replyExpanded ? "true" : "false"}"
    >R</button>
  ` : "";
  const manageButtons = canManage ? `
    <div class="comment-admin-actions">
      <button type="button" class="btn small" data-edit-comment="${escapeHtml(comment.id)}" data-post="${escapeHtml(context.post.id)}">수정</button>
      <button type="button" class="btn small" data-del-comment="${escapeHtml(comment.id)}" data-post="${escapeHtml(context.post.id)}">삭제</button>
    </div>
  ` : "";

  if (isEditing) {
    const draft = commentEditDrafts.get(comment.id) ?? normalizeCommentContent(comment);
    return `
      <div class="comment-header">
        <div class="comment-meta-left">
          <span class="comment-author">${author}</span>
        </div>
        <div class="comment-meta-right">
          <span class="muted small">${escapeHtml(dateStr)}</span>
          ${replyButton}
          ${manageButtons}
        </div>
      </div>
      <div class="comment-edit-panel" data-comment-edit-panel="${escapeHtml(comment.id)}">
        <textarea class="comment-edit-textarea" data-comment-edit-input="${escapeHtml(comment.id)}" rows="3">${escapeHtml(draft)}</textarea>
        <div class="comment-edit-actions">
          <button type="button" class="btn small" data-comment-edit-cancel="${escapeHtml(comment.id)}" data-post="${escapeHtml(context.post.id)}">취소</button>
          <button type="button" class="btn primary small" data-comment-edit-save="${escapeHtml(comment.id)}" data-post="${escapeHtml(context.post.id)}">저장</button>
        </div>
      </div>
    `;
  }

  if (isSecret && !unlocked) {
    return `
      <div class="comment-secret-lock">
        <div class="comment-secret-unlock">
          <input type="password" class="comment-secret-input" placeholder="비밀번호">
          <button type="button" class="btn comment-secret-submit" data-comment-secret-submit="${escapeHtml(comment.id)}">확인</button>
        </div>
        <div class="comment-secret-error hidden" data-comment-secret-error="${escapeHtml(comment.id)}"></div>
      </div>
      ${manageButtons}
    `;
  }

  // 날짜 우선 헤더(타래 등): 이름 없이 날짜가 맨 앞에 오는 형태
  const headerHtml = context.dateFirstHeader
    ? `
      <div class="comment-header">
        <div class="comment-meta-left">
          <span class="muted small comment-date-first">${escapeHtml(dateStr)}</span>
        </div>
        <div class="comment-meta-right">
          ${replyButton}
          ${manageButtons}
        </div>
      </div>
    `
    : `
      <div class="comment-header">
        <div class="comment-meta-left">
          <span class="comment-author">${author}</span>
        </div>
        <div class="comment-meta-right">
          <span class="muted small">${escapeHtml(dateStr)}</span>
          ${replyButton}
          ${manageButtons}
        </div>
      </div>
    `;

  return `
    ${headerHtml}
    ${foldable ? `
      <button
        type="button"
        class="comment-more-btn"
        data-comment-more="${escapeHtml(comment.id)}"
        aria-controls="${bodyId}"
        aria-expanded="${expanded ? "true" : "false"}"
      >
        ${expanded ? "접기" : "펼치기"}
      </button>
    ` : ""}
    <div
      class="${bodyClass}"
      id="${bodyId}"
      data-comment-body="${escapeHtml(comment.id)}"
      data-collapsed="${foldable && !expanded ? "Y" : "N"}"
    >${html}</div>
    ${renderCommentImages(comment)}
  `;
}

function renderCommentItem(comment, context, writeState, childrenByParent, depth = 0, visited = new Set()) {
  if (visited.has(comment.id)) return "";
  const nextVisited = new Set(visited);
  nextVisited.add(comment.id);
  const isSecret = Boolean(comment.isSecret);
  const unlocked = isCommentSecretUnlocked(comment.id, writeState.auth);
  const canShowReplies = !isSecret || unlocked;
  const children = childrenByParent.get(comment.id) || [];
  const repliesHtml = canShowReplies
    ? children
      .map((child) => renderCommentItem(child, context, writeState, childrenByParent, depth + 1, nextVisited))
      .join("")
    : "";
  return `
    <article class="comment-item${depth > 0 ? " is-reply" : ""}${isSecret && !unlocked ? " is-secret" : ""}" data-comment-id="${escapeHtml(comment.id)}" data-comment-depth="${depth}">
      ${depth > 0 ? '<span class="comment-reply-arrow" aria-hidden="true">→</span>' : ""}
      ${renderCommentBodyV2(comment, context, writeState)}
      ${renderReplyForm(comment, context, writeState)}
      ${repliesHtml ? `<div class="comment-replies">${repliesHtml}</div>` : ""}
    </article>
  `;
}

function renderCommentsTree(comments, context, writeState) {
  const commentIds = new Set(comments.map((comment) => comment.id));
  const childrenByParent = new Map();
  const roots = [];

  comments.forEach((comment) => {
    const legacyReplyMatch = String(comment.link || "").trim().match(/^reply:(.+)$/);
    const parentId = String(comment.parentCommentId || legacyReplyMatch?.[1] || "").trim();
    if (!parentId || parentId === comment.id || !commentIds.has(parentId)) {
      roots.push(comment);
      return;
    }
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(comment);
  });

  return roots
    .map((comment) => renderCommentItem(comment, context, writeState, childrenByParent))
    .join("");
}

function bindCommentSecretUnlocks(container, context) {
  container.querySelectorAll("[data-comment-secret-submit]").forEach((button) => {
    button.addEventListener("click", async () => {
      const commentId = button.dataset.commentSecretSubmit || button.closest(".comment-item")?.dataset.commentId || "";
      const lock = button.closest(".comment-secret-lock");
      const input = lock?.querySelector(".comment-secret-input");
      const errorEl = lock?.querySelector(".comment-secret-error");
      const comment = currentCommentsByPost.get(context.post.id)?.get(commentId) || currentComments.get(commentId);
      const password = String(input?.value || "").trim();

      if (!commentId || !comment || !password) {
        showCommentError(errorEl, "비밀번호가 일치하지 않습니다.");
        return;
      }

      button.disabled = true;
      hideCommentError(errorEl);
      try {
        const ok = await verifyCommentSecret(comment, password);
        if (!ok) {
          showCommentError(errorEl, "비밀번호가 일치하지 않습니다.");
          return;
        }
        unlockedSecretCommentIds.add(commentId);
        persistUnlockedSecretCommentIds();
        await loadComments(context.post.id, container, context);
      } finally {
        button.disabled = false;
      }
    });
  });
}
function bindCommentMoreButtons(container) {
  container.querySelectorAll("[data-comment-more]").forEach((button) => {
    button.addEventListener("click", () => {
      const commentId = button.dataset.commentMore || "";
      const body = button.closest(".comment-item")?.querySelector(`[data-comment-body="${CSS.escape(commentId)}"]`);
      if (!body) return;
      const currentlyCollapsed = body.dataset.collapsed !== "N";
      const nextCollapsed = !currentlyCollapsed;
      body.dataset.collapsed = nextCollapsed ? "Y" : "N";
      body.classList.toggle("is-folded", nextCollapsed);
      if (nextCollapsed) expandedCommentIds.delete(commentId);
      else expandedCommentIds.add(commentId);
      button.textContent = nextCollapsed ? "펼치기" : "접기";
      button.setAttribute("aria-expanded", nextCollapsed ? "false" : "true");
    });
  });
}
function bindCommentFormToggle(container) {
  container.querySelectorAll("[data-comment-form-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const postId = button.dataset.commentFormToggle || "";
      const body = container.querySelector(`[data-comment-form-body="${CSS.escape(postId)}"]`);
      if (!body) return;

      const hidden = body.classList.toggle("hidden");
      if (hidden) expandedCommentFormPosts.delete(postId);
      else expandedCommentFormPosts.add(postId);
    });
  });
}

function bindCommentReplyButtons(container, postId, context) {
  container.querySelectorAll("[data-comment-reply]").forEach((button) => {
    button.addEventListener("click", async () => {
      const commentId = button.dataset.commentReply || "";
      if (!commentId) return;

      if (replyingToCommentByPost.get(postId) === commentId) {
        replyingToCommentByPost.delete(postId);
      } else {
        replyingToCommentByPost.set(postId, commentId);
      }

      await loadComments(postId, container, context);
      const textarea = container.querySelector(`[data-comment-reply-content="${CSS.escape(commentId)}"]`);
      textarea?.focus();
    });
  });
}

function bindCommentReplySecretToggles(container) {
  container.querySelectorAll("[data-comment-reply-secret]").forEach((toggle) => {
    const commentId = toggle.dataset.commentReplySecret || "";
    const form = toggle.closest("[data-comment-reply-form]");
    const wrap = form?.querySelector(`[data-comment-reply-secret-wrap="${CSS.escape(commentId)}"]`);
    const passInput = form?.querySelector(`[data-comment-reply-secret-pass="${CSS.escape(commentId)}"]`);
    if (!wrap) return;

    const sync = () => {
      wrap.classList.toggle("hidden", !toggle.checked);
      if (!toggle.checked && passInput) passInput.value = "";
    };
    toggle.addEventListener("change", sync);
    sync();
  });
}

async function saveReplyComment({ postId, context, auth, nickname, content, more, isSecret, secretPw, parentCommentId }) {
  const contentHtml = sanitizeCommentHtml(content, context);
  const commentPayload = {
    postId,
    boardId: context.boardId || context.board?.id || "",
    link: `reply:${parentCommentId}`,
    nickname,
    content,
    contentHtml,
    more,
    isSecret,
    authorType: auth.isAdmin ? "ADMIN" : (isGuestUnlocked() ? "GUEST" : "PUBLIC"),
    createdAt: serverTimestamp(),
    isDeleted: false
  };

  if (isSecret) {
    const saltBytes = crypto.getRandomValues(new Uint8Array(8));
    const secretSalt = Array.from(saltBytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
    commentPayload.secretSalt = secretSalt;
    commentPayload.secretHash = await sha256Hex(`${secretSalt}:${secretPw}`);
  } else {
    commentPayload.secretSalt = "";
    commentPayload.secretHash = "";
  }

  if (context.commentScope === "guest" && !auth.isAdmin) {
    const commentRef = doc(collection(db, "posts", postId, "comments"));
    const proofRef = doc(db, "comment_write_proofs", commentRef.id);
    const proofHash = getGuestProofHash();
    const batch = writeBatch(db);

    batch.set(proofRef, {
      postId,
      boardId: context.boardId || context.board?.id || "",
      proofHash,
      createdAt: serverTimestamp()
    });
    batch.set(commentRef, {
      ...commentPayload,
      authorType: "GUEST"
    });
    await batch.commit();
    return;
  }

  await addDoc(commentsCol(postId), commentPayload);
}

function bindCommentReplyForms(container, postId, context, writeState) {
  container.querySelectorAll("[data-comment-reply-form]").forEach((form) => {
    const parentCommentId = form.dataset.commentReplyForm || "";
    const submitButton = form.querySelector(`[data-comment-reply-submit="${CSS.escape(parentCommentId)}"]`);
    const authorInput = form.querySelector(`[data-comment-reply-author="${CSS.escape(parentCommentId)}"]`);
    const contentInput = form.querySelector(`[data-comment-reply-content="${CSS.escape(parentCommentId)}"]`);
    const moreInput = form.querySelector(`[data-comment-reply-more="${CSS.escape(parentCommentId)}"]`);
    const secretInput = form.querySelector(`[data-comment-reply-secret="${CSS.escape(parentCommentId)}"]`);
    const passInput = form.querySelector(`[data-comment-reply-secret-pass="${CSS.escape(parentCommentId)}"]`);

    async function submitReply() {
      if (!writeState.canWrite || !parentCommentId) return;

      const content = String(contentInput?.value || "").trim();
      const more = Boolean(moreInput?.checked);
      const isSecret = Boolean(secretInput?.checked);
      const secretPw = String(passInput?.value || "").trim();
      if (isSecret && !secretPw) {
        window.alert("비밀글 비밀번호를 입력하세요.");
        return;
      }

      submitButton.disabled = true;
      try {
        const auth = await getAuthSnapshot();
        const nickname = auth.isAdmin
          ? await resolveAdminNickname(auth)
          : String(authorInput?.value || "").trim();
        if (!nickname || !content) {
          window.alert("닉네임과 내용을 입력해 주세요.");
          return;
        }

        await saveReplyComment({
          postId,
          context,
          auth,
          nickname,
          content,
          more,
          isSecret,
          secretPw,
          parentCommentId
        });
        replyingToCommentByPost.delete(postId);
        await loadComments(postId, container, context);
      } catch (error) {
        console.error("Failed to submit comment reply:", error);
        window.alert(error?.message || "답글 등록에 실패했습니다.");
      } finally {
        submitButton.disabled = false;
      }
    }

    submitButton?.addEventListener("click", submitReply);
    contentInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        submitReply();
      }
    });
  });
}

function bindCommentDeleteButtons(container, postId, context) {
  container.querySelectorAll("[data-del-comment]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const commentId = btn.dataset.delComment || "";
      if (!commentId) return;
      if (!confirm("댓글을 삭제할까요?")) return;
      await deleteDoc(doc(db, "posts", postId, "comments", commentId));
      await loadComments(postId, container, context);
    });
  });
}

function bindCommentEditButtons(container, postId, context) {
  container.querySelectorAll("[data-edit-comment]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const commentId = btn.dataset.editComment || "";
      if (!commentId) return;

      const comment = currentCommentsByPost.get(postId)?.get(commentId) || currentComments.get(commentId);
      if (!comment) return;

      editingCommentIds.clear();
      editingCommentIds.add(commentId);
      commentEditDrafts.set(commentId, normalizeCommentContent(comment));
      await loadComments(postId, container, context);

      const textarea = container.querySelector(`[data-comment-edit-input="${CSS.escape(commentId)}"]`);
      textarea?.focus();
      textarea?.setSelectionRange?.(textarea.value.length, textarea.value.length);
    });
  });
}

function bindCommentEditDraftInputs(container) {
  container.querySelectorAll("[data-comment-edit-input]").forEach((textarea) => {
    textarea.addEventListener("input", () => {
      const commentId = textarea.dataset.commentEditInput || "";
      if (!commentId) return;
      commentEditDrafts.set(commentId, textarea.value);
    });
  });
}

function bindCommentEditCancelButtons(container, postId, context) {
  container.querySelectorAll("[data-comment-edit-cancel]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const commentId = btn.dataset.commentEditCancel || "";
      if (!commentId) return;
      editingCommentIds.delete(commentId);
      commentEditDrafts.delete(commentId);
      await loadComments(postId, container, context);
    });
  });
}

function bindCommentEditSaveButtons(container, postId, context) {
  container.querySelectorAll("[data-comment-edit-save]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const commentId = btn.dataset.commentEditSave || "";
      if (!commentId) return;

      const textarea = container.querySelector(`[data-comment-edit-input="${CSS.escape(commentId)}"]`);
      const content = String(textarea?.value || commentEditDrafts.get(commentId) || "").trim();
      if (!content) {
        window.alert("내용을 입력해 주세요.");
        return;
      }

      await updateDoc(doc(db, "posts", postId, "comments", commentId), {
        content,
        contentHtml: sanitizeCommentHtml(content, context),
        updatedAt: serverTimestamp()
      });

      editingCommentIds.delete(commentId);
      commentEditDrafts.delete(commentId);
      await loadComments(postId, container, context);
    });
  });
}
function bindGuestUnlock(container, context) {
  container.querySelectorAll("[data-comment-guest-unlock]").forEach((button) => {
    button.addEventListener("click", async () => {
      const code = await showInputModal({
        title: "게스트 코드 입력",
        description: "게스트 코드를 입력하면 댓글을 작성할 수 있습니다.",
        placeholder: "게스트 코드",
        inputType: "password",
        confirmText: "확인"
      });
      if (!code) return;

      const verified = await verifyGuestCode(code.trim());
      if (!verified.ok) {
        window.alert(verified.reason || "게스트 코드 인증에 실패했습니다.");
        return;
      }

      await loadComments(context.post.id, container, context);
    });
  });
}
function bindCommentSecretToggle(postId) {
  const toggle = document.getElementById(`comment-secret-${postId}`);
  const wrap = document.getElementById(`comment-secret-pass-wrap-${postId}`);
  const passInput = document.getElementById(`comment-secret-pass-${postId}`);
  if (!toggle || !wrap) return;

  const sync = () => {
    const show = toggle.checked;
    wrap.classList.toggle("hidden", !show);
    if (!show && passInput) passInput.value = "";
  };

  toggle.addEventListener("change", sync);
  sync();
}

function bindCommentSubmit(postId, container, context, writeState) {
  const submitBtn = container.querySelector(`[data-comment-submit="${CSS.escape(postId)}"]`);
  const memoInput = document.getElementById(`comment-content-${postId}`);
  const authorInput = document.getElementById(`comment-author-${postId}`);
  const moreInput = document.getElementById(`comment-more-${postId}`);
  const secretInput = document.getElementById(`comment-secret-${postId}`);
  const passInput = document.getElementById(`comment-secret-pass-${postId}`);

  async function submit() {
    if (!writeState.canWrite) return;

    const content = (memoInput?.value || "").trim();
    const more = Boolean(moreInput?.checked);
    const isSecret = Boolean(secretInput?.checked);
    const secretPw = (passInput?.value || "").trim();

    if (isSecret && !secretPw) {
      window.alert("비밀글 비밀번호를 입력하세요.");
      return;
    }

    try {
      const auth = await getAuthSnapshot();
      const nickname = auth.isAdmin
        ? await resolveAdminNickname(auth)
        : (authorInput?.value || "").trim();
      if (!nickname || !content) {
        window.alert("닉네임과 내용을 입력해 주세요.");
        return;
      }

      const authorType = auth.isAdmin ? "ADMIN" : (isGuestUnlocked() ? "GUEST" : "PUBLIC");
      const contentHtml = sanitizeCommentHtml(content, context);

      let uploadedImages = [];
      if (context.allowImages && getPendingCommentImages(postId).length) {
        if (submitBtn) submitBtn.disabled = true;
        try {
          uploadedImages = await uploadCommentImages(postId, context, auth);
        } finally {
          if (submitBtn) submitBtn.disabled = false;
        }
      }

      const commentPayload = {
        postId,
        boardId: context.boardId || context.board?.id || "",
        nickname,
        content,
        contentHtml,
        more,
        isSecret,
        authorType,
        createdAt: serverTimestamp(),
        isDeleted: false
      };
      if (uploadedImages.length) commentPayload.images = uploadedImages;

      if (isSecret) {
        const saltBytes = crypto.getRandomValues(new Uint8Array(8));
        const secretSalt = Array.from(saltBytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
        commentPayload.secretSalt = secretSalt;
        commentPayload.secretHash = await sha256Hex(`${secretSalt}:${secretPw}`);
      } else {
        commentPayload.secretSalt = "";
        commentPayload.secretHash = "";
      }

      if (context.commentScope === "guest" && !auth.isAdmin) {
        const commentRef = doc(collection(db, "posts", postId, "comments"));
        const proofRef = doc(db, "comment_write_proofs", commentRef.id);
        const proofHash = getGuestProofHash();
        const batch = writeBatch(db);

        batch.set(proofRef, {
          postId,
          boardId: context.boardId || context.board?.id || "",
          proofHash,
          createdAt: serverTimestamp()
        });
        batch.set(commentRef, {
          ...commentPayload,
          authorType: "GUEST"
        });
        await batch.commit();
      } else {
        await addDoc(commentsCol(postId), commentPayload);
      }

      if (authorInput) authorInput.value = "";
      if (memoInput) memoInput.value = "";
      if (moreInput) moreInput.checked = false;
      if (secretInput) secretInput.checked = false;
      if (passInput) passInput.value = "";
      clearPendingCommentImages(postId);
      bindCommentSecretToggle(postId);

      await loadComments(postId, container, context);
    } catch (error) {
      console.error("Failed to submit comment:", error);
      window.alert(error?.message || "댓글 등록에 실패했습니다.");
    }
  }

  submitBtn?.addEventListener("click", submit);
  memoInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit();
    }
  });
}
async function verifyCommentSecret(comment, password) {
  if (!comment?.isSecret) return true;
  if (!comment.secretHash) return true;
  const salt = String(comment.secretSalt || "");
  const candidates = [
    await sha256Hex(`${salt}:${password}`),
    await sha256Hex(`${salt}${password}`),
    await sha256Hex(password)
  ];
  return candidates.includes(String(comment.secretHash || ""));
}

function normalizeCommentContent(comment) {
  // content는 사용자가 입력한 원문 그대로 보존 (iframe 등 마크업 유지)
  const rawContent = String(comment?.content || "").trim();
  if (rawContent) return rawContent;

  return String(comment?.contentHtml || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .trim();
}

function enhanceCommentLinks(html = "", boardId = "") {
  if (typeof document === "undefined" || !html) return html;

  const root = document.createElement("div");
  root.innerHTML = html;
  const textNodes = [];
  collectCommentTextNodes(root, textNodes);
  textNodes.forEach((node) => replaceCommentTextNode(node, boardId));
  return root.innerHTML;
}

function collectCommentTextNodes(node, result = []) {
  Array.from(node.childNodes || []).forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      if (shouldEnhanceCommentTextNode(child)) result.push(child);
      return;
    }
    if (child.nodeType === Node.ELEMENT_NODE) {
      collectCommentTextNodes(child, result);
    }
  });
  return result;
}

function shouldEnhanceCommentTextNode(node) {
  let parent = node.parentElement;
  while (parent) {
    const tagName = parent.tagName?.toLowerCase();
    if (["a", "code", "pre"].includes(tagName)) return false;
    parent = parent.parentElement;
  }
  return true;
}

function replaceCommentTextNode(node, boardId = "") {
  const text = node.nodeValue || "";
  const tokenPattern = /\[([^\]\r\n]{1,80})\](https?:\/\/[^\s<>"']+)|#(\d+)/g;
  if (!tokenPattern.test(text)) return;

  tokenPattern.lastIndex = 0;
  const fragment = document.createDocumentFragment();
  let lastIndex = 0;
  let match;

  while ((match = tokenPattern.exec(text))) {
    const [matchedText, label, rawUrl, logNo] = match;
    if (match.index > lastIndex) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }

    if (rawUrl) {
      fragment.appendChild(createCommentNamedLink(label, rawUrl, matchedText));
    } else if (logNo) {
      fragment.appendChild(createCommentLogLink(logNo, boardId));
    }
    lastIndex = match.index + matchedText.length;
  }

  if (lastIndex < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
  }

  node.replaceWith(fragment);
}

function createCommentNamedLink(label = "", rawUrl = "", fallbackText = "") {
  const safeUrl = normalizeHttpUrl(rawUrl);
  if (!safeUrl) return document.createTextNode(fallbackText);

  const link = document.createElement("a");
  link.href = safeUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.className = "comment-named-link";

  const strong = document.createElement("strong");
  strong.textContent = label;
  link.appendChild(strong);
  return link;
}

function createCommentLogLink(logNo = "", boardId = "") {
  const link = document.createElement("a");
  link.href = `board.html?bo=${encodeURIComponent(boardId)}&log=${encodeURIComponent(logNo)}`;
  link.className = "log-tag comment-log-tag";
  link.textContent = String(logNo);
  return link;
}

function normalizeHttpUrl(value = "") {
  try {
    const url = new URL(String(value || "").trim());
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch (_error) {
    return "";
  }
}

function showCommentError(errorEl, message) {
  if (!errorEl) return;
  errorEl.textContent = message;
  errorEl.classList.remove("hidden");
}

function hideCommentError(errorEl) {
  if (!errorEl) return;
  errorEl.textContent = "";
  errorEl.classList.add("hidden");
}

let currentComments = new Map();
const currentCommentsByPost = new Map();

export async function loadComments(postId, container, options = {}) {
  if (!container) return;

  try {
    const context = await resolveCommentContext(postId, options);
    const writeState = await resolveWriteState(context);
    const snapshot = await getDocs(query(commentsCol(postId), orderBy("createdAt", "asc")));
    const comments = snapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .filter((comment) => !comment.isDeleted);

    currentComments = new Map(comments.map((item) => [item.id, item]));
    currentCommentsByPost.set(postId, currentComments);

    const commentsHTML = comments.length
      ? renderCommentsTree(comments, context, writeState)
      : "";

    container.innerHTML = `
      <div class="comments-list">${commentsHTML}</div>
      ${renderCommentForm(postId, writeState, context)}
    `;

    bindCommentEditButtons(container, postId, context);
    bindCommentEditDraftInputs(container);
    bindCommentEditCancelButtons(container, postId, context);
    bindCommentEditSaveButtons(container, postId, context);
    bindCommentDeleteButtons(container, postId, context);
    bindCommentMoreButtons(container);
    bindCommentFormToggle(container);
    bindCommentReplyButtons(container, postId, context);
    bindCommentReplySecretToggles(container);
    bindCommentReplyForms(container, postId, context, writeState);
    bindCommentSecretUnlocks(container, context);
    bindGuestUnlock(container, context);
    bindCommentSecretToggle(postId);
    bindCommentImageControls(container, postId, context);
    bindCommentImageViews(container);
    bindCommentSubmit(postId, container, context, writeState);
  } catch (error) {
    console.error("Failed to load comments:", error);
    container.innerHTML = '<div class="notice small">댓글을 불러오지 못했습니다.</div>';
  }
}
