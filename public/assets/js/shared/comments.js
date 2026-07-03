import { db } from "../core/firebase.js";
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
import { sanitizeHTML } from "./html-sanitizer-v2.js";
import { getAuthSnapshot, getGuestProofHash, isGuestUnlocked, sha256Hex, verifyGuestCode } from "../core/state.js";
import { showInputModal } from "./ui-modal.js";

const unlockedSecretCommentIds = new Set();
const expandedCommentIds = new Set();
const expandedCommentFormPosts = new Set();
const editingCommentIds = new Set();
const commentEditDrafts = new Map();
const postCache = new Map();
const boardCache = new Map();
const COMMENT_UNLOCK_STORAGE_KEY = "archive_unlocked_secret_comment_ids";

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

function sanitizeCommentHtml(value) {
  return sanitizeHTML(preserveLineBreaks(value), { allowIframes: false });
}

function normalizeLink(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw, window.location.origin);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.href;
  } catch (_error) {
    return "";
  }
}

function formatDateTime(value) {
  const date = value?.toDate ? value.toDate() : new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return "";
  return `${date.toLocaleDateString("ko-KR")} ${date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`;
}

function estimateCommentFold(comment) {
  const raw = String(comment?.content || comment?.contentHtml || "");
  const text = raw.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const lineCount = String(comment?.content || "").split(/\r?\n/).length;
  return Boolean(comment?.more) || text.length > 160 || lineCount > 4;
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
    manageComments: Boolean(options.manageComments)
  };
}

async function resolveWriteState(context) {
  const auth = await getAuthSnapshot();
  if (auth.isAdmin) {
    return { auth, canWrite: true, mode: "ADMIN", needsGuestUnlock: false };
  }

  if (context.commentScope === "guest" && !isGuestUnlocked()) {
    return { auth, canWrite: false, mode: "GUEST", needsGuestUnlock: true };
  }

  return {
    auth,
    canWrite: true,
    mode: isGuestUnlocked() ? "GUEST" : "PUBLIC",
    needsGuestUnlock: false
  };
}

function renderCommentForm(postId, context, writeState) {
  if (!writeState.canWrite && writeState.needsGuestUnlock) {
    return `
      <div class="comment-gate notice">
        <div class="comment-gate-copy">
          <strong>댓글은 게스트만 작성할 수 있습니다.</strong>
          <div class="muted small">게스트 코드를 입력하면 댓글을 작성할 수 있어요.</div>
        </div>
        <button type="button" class="btn small" data-comment-guest-unlock="${escapeHtml(postId)}">게스트 코드 입력</button>
      </div>
    `;
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
        <div class="comment-form-row comment-form-row-name">
          <input
            type="text"
            id="comment-author-${escapeHtml(postId)}"
            class="comment-name-input"
            placeholder="닉네임"
          >
        </div>

        <div class="comment-form-row">
          <textarea
            id="comment-content-${escapeHtml(postId)}"
            class="comment-memo-input"
            rows="3"
            placeholder="내용"
          ></textarea>
        </div>

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
function renderCommentBody(comment, context, auth) {
  const raw = String(comment.contentHtml || comment.content || "");
  const html = enhanceCommentLinks(sanitizeHTML(raw, { allowIframes: false }), context.boardId);
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
  const manageButtons = canManage ? `
    <div class="comment-admin-actions">
      <button type="button" class="btn small" data-edit-comment="${escapeHtml(comment.id)}" data-post="${escapeHtml(context.post.id)}">수정</button>
      <button type="button" class="btn small" data-del-comment="${escapeHtml(comment.id)}" data-post="${escapeHtml(context.post.id)}">삭제</button>
    </div>
  ` : "";

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

  return `
    <div class="comment-header">
      <div class="comment-meta-left">
        <span class="comment-author">${author}</span>
      </div>
      <div class="comment-meta-right">
        <span class="muted small">${escapeHtml(dateStr)}</span>
        ${manageButtons}
      </div>
    </div>
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
  `;
}
function renderCommentBodyV2(comment, context, auth) {
  const raw = String(comment.contentHtml || comment.content || "");
  const html = enhanceCommentLinks(sanitizeHTML(raw, { allowIframes: false }), context.boardId);
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

  return `
    <div class="comment-header">
      <div class="comment-meta-left">
        <span class="comment-author">${author}</span>
      </div>
      <div class="comment-meta-right">
        <span class="muted small">${escapeHtml(dateStr)}</span>
        ${manageButtons}
      </div>
    </div>
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
  `;
}

function renderCommentItem(comment, context, auth) {
  const isSecret = Boolean(comment.isSecret);
  const unlocked = isCommentSecretUnlocked(comment.id, auth);
  return `
    <article class="comment-item${isSecret && !unlocked ? " is-secret" : ""}" data-comment-id="${escapeHtml(comment.id)}">
      ${renderCommentBodyV2(comment, context, auth)}
    </article>
  `;
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
        window.alert("??? ??? ???.");
        return;
      }

      await updateDoc(doc(db, "posts", postId, "comments", commentId), {
        content,
        contentHtml: sanitizeCommentHtml(content),
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

    const nickname = (authorInput?.value || "").trim();
    const content = (memoInput?.value || "").trim();
    const more = Boolean(moreInput?.checked);
    const isSecret = Boolean(secretInput?.checked);
    const secretPw = (passInput?.value || "").trim();

    if (!nickname || !content) {
      window.alert("닉네임과 내용을 입력해 주세요.");
      return;
    }

    if (isSecret && !secretPw) {
      window.alert("비밀글 비밀번호를 입력하세요.");
      return;
    }

    try {
      const auth = await getAuthSnapshot();
      const authorType = auth.isAdmin ? "ADMIN" : (isGuestUnlocked() ? "GUEST" : "PUBLIC");
      const contentHtml = sanitizeCommentHtml(content);
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

  window.submitComment = async function submitComment() {
    await submit();
  };
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
  const raw = String(comment?.content || comment?.contentHtml || "");
  return raw
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
  link.href = `/board.html?bo=${encodeURIComponent(boardId)}&log=${encodeURIComponent(logNo)}`;
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
    const auth = writeState.auth;

    const snapshot = await getDocs(query(commentsCol(postId), orderBy("createdAt", "asc")));
    const comments = snapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .filter((comment) => !comment.isDeleted);

    currentComments = new Map(comments.map((item) => [item.id, item]));
    currentCommentsByPost.set(postId, currentComments);

    const commentsHTML = comments.length
      ? comments.map((comment) => renderCommentItem(comment, context, auth)).join("")
      : "";

    container.innerHTML = `
      <div class="comments-list">${commentsHTML}</div>
      ${renderCommentForm(postId, context, writeState)}
    `;

    bindCommentEditButtons(container, postId, context);
    bindCommentEditDraftInputs(container);
    bindCommentEditCancelButtons(container, postId, context);
    bindCommentEditSaveButtons(container, postId, context);
    bindCommentDeleteButtons(container, postId, context);
    bindCommentMoreButtons(container);
    bindCommentFormToggle(container);
    bindCommentSecretUnlocks(container, context);
    bindGuestUnlock(container, context);
    bindCommentSecretToggle(postId);
    bindCommentSubmit(postId, container, context, writeState);
  } catch (error) {
    console.error("Failed to load comments:", error);
    container.innerHTML = '<div class="notice small">댓글을 불러오지 못했습니다.</div>';
  }
}
