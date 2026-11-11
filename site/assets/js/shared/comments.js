// NAMWALL Edition Copyright (c) 2026 NAMWALL — MPL-2.0 (https://mozilla.org/MPL/2.0/)
// 댓글 — 목록·작성(회원·게스트)·비밀 댓글·접기·답글·삭제
// options: allowImages(회원·관리자 이미지 첨부, 최대 8장, 1400px WebP) · memberOnly(비로그인 작성 차단)
//          allowReplies(답글 R) · guestbook(postId 자리에 방명록 항목 번호) · compact · dateFirstHeader · onRendered
// 권한 판정은 서버가 하고, 여기서는 받은 플래그대로 그린다.
import { runQuery, runMutate, getAdminSession, getMemberSession, naruErrorMessage } from "../core/naru-client.js";
import { loadBoot, promptNickname, escapeHtml, formatDateTime, ownerDisplayName } from "../core/site.js";
import { renderPlainHtml, renderRichText } from "./rich-text.js";
import { bindPasswordPrompt } from "./ui.js";

const MAX_COMMENT_IMAGES = 8;
const COMMENT_IMAGE_MAX_EDGE = 1400;
const COMMENT_PAGE_SIZE = 50;

// ▼로 연 댓글 폼과 '펼치기'로 연 접기 댓글 — 다시 그려도 상태 유지
const expandedCommentForms = new Set();
const expandedComments = new Set();

export async function loadComments(postId, container, options = {}) {
  if (!container) return;
  const [boot, admin, member] = await Promise.all([loadBoot(), getAdminSession(), getMemberSession()]);
  const uploader = admin || member;
  const canAttach = options.allowImages === true && Boolean(uploader);
  const target = options.guestbook ? { guestbook: postId } : { post: postId };
  const formKey = `${options.guestbook ? "g" : "p"}${postId}`;

  let page;
  try {
    page = await queryCommentPage(target);
  } catch (error) {
    container.innerHTML = `<div class="notice small">${escapeHtml(naruErrorMessage(error, "댓글을 불러오지 못했습니다."))}</div>`;
    return;
  }

  const asMember = Boolean(boot.owner || boot.me);
  const canReply = options.allowReplies === true && !(options.memberOnly && !asMember);
  const view = { options, canReply };
  let loaded = page.comments; // 오래된 것 → 새것

  container.innerHTML = `
    <div class="comments-list">
      <div class="comment-pagination${page.more ? "" : " hidden"}">
        <button type="button" class="btn small" data-older-comments>이전 댓글 더 보기</button>
        <div class="comment-page-error notice small hidden"></div>
      </div>
      <div data-comment-items>${renderCommentTree(loaded, view)}</div>
    </div>
    ${renderCommentForm(asMember, options, canAttach, formKey)}
  `;

  const reload = () => loadComments(postId, container, options);
  // THREAD는 댓글 목록을 본문 쪽으로 옮기므로 container 대신 목록 요소를 기억한다
  const items = container.querySelector("[data-comment-items]");
  const bindItems = () => {
    bindReveal(items);
    bindDelete(items, reload);
    bindFoldButtons(items);
    if (canReply) bindReplyButtons(items, target, asMember, reload);
  };
  bindItems();
  // 이전 댓글을 불러오면 답글이 부모 아래로 이어지도록 전체 트리를 다시 그린다
  bindCommentPaging(container, target, page, (older) => {
    loaded = [...older, ...loaded];
    items.innerHTML = renderCommentTree(loaded, view);
    bindItems();
  });
  bindFormToggle(container, formKey);
  bindSubmit(container, target, reload, { canAttach, uploader });
  options.onRendered?.(container);
}

function queryCommentPage(target, before = null) {
  return runQuery("board:comments", { ...target, size: COMMENT_PAGE_SIZE, ...(before ? { before } : {}) });
}

function bindCommentPaging(container, target, firstPage, onOlder) {
  const pagination = container.querySelector(".comment-pagination");
  const button = container.querySelector("[data-older-comments]");
  const errorEl = container.querySelector(".comment-page-error");
  let before = firstPage.before;
  button?.addEventListener("click", async () => {
    if (button.disabled || !before) return;
    button.disabled = true;
    errorEl?.classList.add("hidden");
    try {
      const page = await queryCommentPage(target, before);
      onOlder(page.comments);
      before = page.before;
      pagination.classList.toggle("hidden", !page.more);
    } catch (error) {
      if (errorEl) {
        errorEl.textContent = naruErrorMessage(error, "이전 댓글을 불러오지 못했습니다.");
        errorEl.classList.remove("hidden");
      }
    } finally {
      button.disabled = false;
    }
  });
}

// 답글을 부모 댓글 아래로 묶는다. 부모가 목록에 없으면(삭제됐거나 아직 안 불러옴) 일반 댓글로 둔다.
function renderCommentTree(comments, view) {
  const ids = new Set(comments.map((comment) => comment.id));
  const childrenByParent = new Map();
  const roots = [];
  comments.forEach((comment) => {
    const parentId = comment.parentId;
    if (!parentId || parentId === comment.id || !ids.has(parentId)) {
      roots.push(comment);
      return;
    }
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(comment);
  });
  return roots.map((comment) => renderCommentItem(comment, view, childrenByParent)).join("");
}

function renderCommentItem(comment, view, childrenByParent, depth = 0, visited = new Set()) {
  if (visited.has(comment.id)) return "";
  const nextVisited = new Set(visited).add(comment.id);
  const { options, canReply } = view;
  const dateStr = escapeHtml(formatDateTime(comment.createdAt));
  const name = comment.isOwnerComment ? ownerDisplayName() : (comment.name || "익명");
  const nameHtml = `<span class="comment-author">${escapeHtml(name)}</span>`;
  const replyBtn = canReply
    ? `<button type="button" class="btn" data-comment-reply="${comment.id}" aria-expanded="false" title="답글">R</button>`
    : "";
  const deleteBtn = (comment.deletable || comment.hasPassword)
    ? `<button type="button" class="btn" data-del-comment data-comment-delete="${comment.id}" data-ask-pass="${comment.deletable ? "" : "1"}" title="삭제">D</button>`
    : "";
  const actions = replyBtn || deleteBtn
    ? `<span class="comment-admin-actions">${replyBtn}${deleteBtn}</span>`
    : "";

  const metaLeft = options.dateFirstHeader ? `<span class="muted small">${dateStr}</span>` : nameHtml;
  const metaRight = options.dateFirstHeader
    ? `${nameHtml}${actions}`
    : `<span class="muted small">${dateStr}</span>${actions}`;

  let bodyHtml;
  if (comment.body != null) {
    const foldable = Boolean(comment.more) && Boolean(comment.body);
    const expanded = expandedComments.has(comment.id);
    const foldBtn = foldable
      ? `<button type="button" class="comment-more-btn" data-comment-more="${comment.id}" aria-expanded="${expanded ? "true" : "false"}">${expanded ? "접기" : "펼치기"}</button>`
      : "";
    const foldClass = foldable && !expanded ? " is-folded is-manual-fold" : "";
    const textHtml = comment.body
      ? `<div class="comment-content${foldClass}" data-comment-body="${comment.id}">${renderCommentHtml(comment.body)}</div>`
      : "";
    bodyHtml = `${foldBtn}${textHtml}${renderCommentImages(comment.images)}`;
  } else if (comment.hasPassword) {
    bodyHtml = `
      <div class="comment-secret-lock" data-reveal-box="${comment.id}">
        <small>비밀 댓글입니다.</small>
        <div class="comment-secret-unlock">
          <input type="password" class="comment-secret-input" placeholder="비밀번호">
          <button type="button" class="btn comment-secret-submit" data-reveal="${comment.id}" data-reveal-kind="board:commentReveal" data-reveal-class="comment-content">확인</button>
        </div>
        <div class="comment-secret-error hidden"></div>
      </div>
    `;
  } else {
    bodyHtml = '<div class="comment-content muted small">비밀 댓글입니다. (작성자·관리자만 볼 수 있습니다)</div>';
  }

  const repliesHtml = (childrenByParent.get(comment.id) || [])
    .map((child) => renderCommentItem(child, view, childrenByParent, depth + 1, nextVisited))
    .join("");

  return `
    <article class="comment-item${depth > 0 ? " is-reply" : ""}" data-comment-id="${comment.id}">
      ${depth > 0 ? '<span class="comment-reply-arrow" aria-hidden="true">→</span>' : ""}
      <div class="comment-header">
        <div class="comment-meta-left">${metaLeft}</div>
        <div class="comment-meta-right">${metaRight}</div>
      </div>
      ${bodyHtml}
      ${canReply ? `<div data-reply-slot="${comment.id}"></div>` : ""}
      ${repliesHtml ? `<div class="comment-replies">${repliesHtml}</div>` : ""}
    </article>
  `;
}

function renderCommentImages(images) {
  const urls = Array.isArray(images) ? images.filter(Boolean) : [];
  if (!urls.length) return "";
  return `
    <div class="comment-images">
      ${urls.map((url) => `
        <button type="button" class="comment-image-view" data-lightbox-image="${escapeHtml(url)}" aria-label="댓글 이미지 원본 보기">
          <img src="${escapeHtml(url)}" alt="댓글 이미지" loading="lazy">
        </button>
      `).join("")}
    </div>
  `;
}

// 댓글·답글 폼 공통 옵션 줄: [접기] [비밀] (extra) [비밀번호 — 게스트, 비밀 체크 시] [등록]
function renderOptionControls(asMember, extra = "") {
  return `
    <label class="comment-toggle"><input type="checkbox" class="comment-fold-toggle"> <span>접기</span></label>
    <label class="comment-toggle"><input type="checkbox" class="comment-secret-toggle"> <span>비밀</span></label>
    ${extra}
    ${asMember ? "" : `
    <span class="comment-secret-pass-wrap hidden">
      <span class="comment-pass-label">비밀번호</span>
      <input type="password" class="comment-pass-input" placeholder="비밀번호" maxlength="64">
    </span>`}
    <button type="submit" class="btn primary comment-submit-btn">등록</button>
  `;
}

// ▼ 토글은 LOG 피드에서만 보인다 (상세·타래·방명록은 CSS가 숨기고 항상 펼침)
function renderCommentForm(asMember, options, canAttach, formKey) {
  if (options.memberOnly && !asMember) {
    return options.compact ? "" : '<div class="comment-member-only muted small mt-sm">로그인한 회원만 댓글을 쓸 수 있습니다.</div>';
  }
  const attachButton = canAttach
    ? `<button type="button" class="btn comment-image-attach">이미지 첨부</button>
       <input type="file" class="comment-image-input hidden" accept="image/*" multiple>`
    : "";
  return `
    <form class="comment-form" autocomplete="off">
      <div class="comment-form-head">
        <button type="button" class="comment-form-toggle" data-comment-form-toggle aria-label="댓글 작성 폼 열기">▼</button>
      </div>
      <div class="comment-form-body${expandedCommentForms.has(formKey) ? "" : " hidden"}">
        ${asMember ? "" : `
        <div class="comment-form-row comment-form-row-name">
          <input type="text" class="comment-name-input" placeholder="닉네임" maxlength="40">
        </div>`}
        <div class="comment-form-row">
          <textarea class="comment-memo-input" rows="3" placeholder="내용"></textarea>
        </div>
        ${canAttach ? '<div class="comment-image-previews hidden"></div>' : ""}
        <div class="comment-form-row comment-form-row-inline comment-form-row-options">
          ${renderOptionControls(asMember, attachButton)}
        </div>
        <div class="comment-msg notice small hidden"></div>
      </div>
    </form>
  `;
}

// 답글 폼: R을 누른 댓글 아래에 한 번에 하나만 연다
function renderReplyForm(asMember) {
  return `
    <form class="comment-reply-form" autocomplete="off">
      ${asMember ? "" : '<input type="text" class="comment-name-input" placeholder="닉네임" maxlength="40">'}
      <textarea class="comment-memo-input" rows="3" placeholder="답글 내용"></textarea>
      <div class="comment-form-row-inline comment-form-row-options">
        ${renderOptionControls(asMember)}
      </div>
      <div class="comment-msg notice small hidden"></div>
    </form>
  `;
}

function bindReplyButtons(root, target, asMember, reload) {
  root.querySelectorAll("[data-comment-reply]").forEach((button) => {
    button.addEventListener("click", () => {
      const parentId = Number(button.dataset.commentReply);
      const slot = root.querySelector(`[data-reply-slot="${parentId}"]`);
      if (!slot) return;
      const wasOpen = Boolean(slot.firstElementChild);
      root.querySelectorAll("[data-reply-slot]").forEach((other) => { other.innerHTML = ""; });
      root.querySelectorAll("[data-comment-reply]").forEach((other) => other.setAttribute("aria-expanded", "false"));
      if (wasOpen) return;
      slot.innerHTML = renderReplyForm(asMember);
      button.setAttribute("aria-expanded", "true");
      bindReplyForm(slot.querySelector("form"), target, parentId, reload);
      slot.querySelector("textarea")?.focus();
    });
  });
}

function bindReplyForm(form, target, parentId, reload) {
  const showMsg = bindFormBasics(form);
  const submitBtn = form.querySelector(".comment-submit-btn");
  let busy = false;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    const { payload, error } = readCommentForm(form, { ...target, parent: parentId });
    if (error) return showMsg(error);
    busy = true;
    if (submitBtn) submitBtn.disabled = true;
    try {
      await runMutate("comment:add", payload);
      await reload();
    } catch (error) {
      await handleAddError(error, showMsg, "답글 등록에 실패했습니다.");
    } finally {
      busy = false;
      if (submitBtn?.isConnected) submitBtn.disabled = false;
    }
  });
}

// 메시지 표시 함수를 돌려주고, 비밀 체크 시 비밀번호 칸을 보이게 한다
function bindFormBasics(form) {
  const msgEl = form.querySelector(".comment-msg");
  const secretToggle = form.querySelector(".comment-secret-toggle");
  const passWrap = form.querySelector(".comment-secret-pass-wrap");
  secretToggle?.addEventListener("change", () => {
    passWrap?.classList.toggle("hidden", !secretToggle.checked);
  });
  return (text) => {
    if (!msgEl) return;
    msgEl.textContent = text;
    msgEl.classList.remove("hidden");
  };
}

// 폼 값 → comment:add 인자. 이름 칸이 있으면(게스트) 이름·비밀번호를 확인한다
function readCommentForm(form, target, { allowEmpty = false } = {}) {
  const body = form.querySelector(".comment-memo-input")?.value.trim() || "";
  const secret = Boolean(form.querySelector(".comment-secret-toggle")?.checked);
  const more = Boolean(form.querySelector(".comment-fold-toggle")?.checked);
  if (!body && !allowEmpty) return { error: "내용을 입력해 주세요." };
  const payload = { ...target, body, secret, more };
  const nameInput = form.querySelector(".comment-name-input");
  if (nameInput) {
    payload.name = nameInput.value.trim();
    payload.password = form.querySelector(".comment-pass-input")?.value || "";
    if (!payload.name) return { error: "닉네임을 입력해 주세요." };
    if (secret && !payload.password) return { error: "비밀 댓글은 비밀번호를 입력하세요." };
  }
  return { payload };
}

async function handleAddError(error, showMsg, fallback) {
  if (error?.details?.needProfile) {
    await promptNickname("댓글을 쓰려면 닉네임이 필요합니다. 사용할 닉네임을 입력하세요.");
    return;
  }
  showMsg(naruErrorMessage(error, fallback));
}

function bindFormToggle(container, formKey) {
  const toggle = container.querySelector("[data-comment-form-toggle]");
  const body = container.querySelector(".comment-form-body");
  if (!toggle || !body) return;
  toggle.addEventListener("click", () => {
    const hidden = body.classList.toggle("hidden");
    if (hidden) expandedCommentForms.delete(formKey);
    else expandedCommentForms.add(formKey);
  });
}

function bindFoldButtons(container) {
  container.querySelectorAll("[data-comment-more]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = Number(button.dataset.commentMore);
      const body = button.closest(".comment-item")?.querySelector(`[data-comment-body="${id}"]`);
      if (!body) return;
      const collapsed = body.classList.toggle("is-folded");
      body.classList.toggle("is-manual-fold", collapsed);
      if (collapsed) expandedComments.delete(id);
      else expandedComments.add(id);
      button.textContent = collapsed ? "펼치기" : "접기";
      button.setAttribute("aria-expanded", String(!collapsed));
    });
  });
}

// 이미지 첨부: 비율 유지 리사이즈 → WebP (GIF는 원본 유지)
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

function bindCommentImages(form, pending, isBusy) {
  const attachBtn = form.querySelector(".comment-image-attach");
  const fileInput = form.querySelector(".comment-image-input");
  const previews = form.querySelector(".comment-image-previews");
  const textarea = form.querySelector(".comment-memo-input");
  if (!attachBtn || !fileInput || !previews) return null;
  let processing = false;

  const refresh = () => {
    previews.innerHTML = pending.map((item, index) => `
      <span class="comment-image-preview">
        <img src="${escapeHtml(item.previewUrl)}" alt="첨부 예정 이미지">
        <button type="button" class="comment-image-remove" data-image-remove="${index}" aria-label="첨부 취소">&times;</button>
      </span>
    `).join("");
    previews.classList.toggle("hidden", !pending.length);
  };

  const addFiles = async (files) => {
    if (isBusy() || processing) return;
    const incoming = Array.from(files || []).filter((file) => /^image\//i.test(file?.type || ""));
    if (!incoming.length) return;
    if (pending.length + incoming.length > MAX_COMMENT_IMAGES) {
      window.alert(`이미지는 댓글당 최대 ${MAX_COMMENT_IMAGES}장까지 첨부할 수 있습니다.`);
      return;
    }
    processing = true;
    try {
      for (const file of incoming) {
        const blob = await resizeCommentImage(file);
        pending.push({ blob, previewUrl: URL.createObjectURL(blob) });
      }
      refresh();
    } catch (error) {
      window.alert(error?.message || "이미지를 처리하지 못했습니다.");
    } finally {
      processing = false;
    }
  };

  attachBtn.addEventListener("click", () => { if (!isBusy()) fileInput.click(); });
  fileInput.addEventListener("change", async () => {
    await addFiles(fileInput.files);
    fileInput.value = "";
  });
  textarea?.addEventListener("paste", (event) => {
    const files = Array.from(event.clipboardData?.files || []).filter((file) => /^image\//i.test(file.type || ""));
    if (!files.length) return;
    event.preventDefault();
    addFiles(files);
  });
  previews.addEventListener("click", (event) => {
    if (isBusy()) return;
    const removeBtn = event.target instanceof Element ? event.target.closest("[data-image-remove]") : null;
    if (!removeBtn) return;
    const index = Number(removeBtn.dataset.imageRemove);
    if (!Number.isInteger(index) || index < 0 || index >= pending.length) return;
    URL.revokeObjectURL(pending[index].previewUrl);
    pending.splice(index, 1);
    refresh();
  });
  return {
    isProcessing: () => processing,
    setBusy(value) {
      attachBtn.disabled = value;
      fileInput.disabled = value;
      previews.querySelectorAll("button").forEach((button) => { button.disabled = value; });
    }
  };
}

// 게스트 비밀 댓글·방명록 열람 — 서버가 비밀번호를 확인하면 그 자리에서 본문으로 교체한다
export function bindReveal(root) {
  root.querySelectorAll("[data-reveal]").forEach((button) => {
    const id = Number(button.dataset.reveal);
    const kind = button.dataset.revealKind;
    const box = root.querySelector(`[data-reveal-box="${id}"]`);
    const input = box?.querySelector("input[type=password]");
    const errorEl = box?.querySelector(".comment-secret-error, .guestbook-secret-error");
    bindPasswordPrompt(button, input, errorEl, async (password) => {
      const { body } = await runQuery(kind, { id, password });
      if (!box) return;
      const bodyEl = document.createElement("div");
      bodyEl.className = button.dataset.revealClass || "comment-content";
      bodyEl.innerHTML = kind === "board:commentReveal" ? renderCommentHtml(body) : renderPlainHtml(body);
      box.replaceWith(bodyEl);
    });
  });
}

// 댓글 본문 — img·유튜브 iframe 허용 + 링크 문법
function renderCommentHtml(body) {
  return renderRichText(body, { allowIframes: "youtube" });
}

function bindDelete(root, reload) {
  root.querySelectorAll("[data-comment-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = Number(button.dataset.commentDelete);
      const hasReplies = Boolean(button.closest(".comment-item")?.querySelector(":scope > .comment-replies"));
      const withReplies = hasReplies ? " 답글도 함께 삭제됩니다." : "";
      let password;
      if (button.dataset.askPass === "1") {
        password = window.prompt(`댓글 비밀번호를 입력하세요.${withReplies}`);
        if (password === null) return;
      } else if (!window.confirm(`이 댓글을 삭제할까요?${withReplies}`)) {
        return;
      }
      button.disabled = true;
      try {
        await runMutate("comment:remove", password != null ? { id, password } : { id });
        await reload();
      } catch (error) {
        window.alert(naruErrorMessage(error, "댓글 삭제에 실패했습니다."));
        button.disabled = false;
      }
    });
  });
}

function bindSubmit(container, target, reload, { canAttach, uploader }) {
  const form = container.querySelector(".comment-form");
  if (!form) return;
  const showMsg = bindFormBasics(form);
  const pendingImages = [];
  let submitting = false;
  let submitted = false;
  const imageControls = canAttach ? bindCommentImages(form, pendingImages, () => submitting || submitted) : null;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submitting || submitted) return;
    if (imageControls?.isProcessing()) return showMsg("이미지 처리 후 다시 등록해 주세요.");
    const { payload, error } = readCommentForm(form, target, { allowEmpty: pendingImages.length > 0 });
    if (error) return showMsg(error);

    const submitBtn = form.querySelector(".comment-submit-btn");
    submitting = true;
    if (submitBtn) submitBtn.disabled = true;
    imageControls?.setBusy(true);
    try {
      if (pendingImages.length && uploader) {
        showMsg("이미지 업로드 중…");
        // 업로드 결과를 기억해 등록이 실패해도 다시 올리지 않는다
        for (const item of pendingImages) {
          if (!item.uploadedUrl) item.uploadedUrl = (await uploader.media.upload(item.blob)).url;
        }
        payload.images = pendingImages.map((item) => item.uploadedUrl);
      }
      await runMutate("comment:add", payload);
      submitted = true;
      pendingImages.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      pendingImages.length = 0;
      await reload();
    } catch (error) {
      if (submitted) {
        showMsg("댓글은 등록했지만 목록을 다시 불러오지 못했습니다. 페이지를 새로고침해 주세요.");
        return;
      }
      await handleAddError(error, showMsg, "댓글 등록에 실패했습니다.");
    } finally {
      submitting = false;
      if (!submitted) {
        if (submitBtn) submitBtn.disabled = false;
        imageControls?.setBusy(false);
      }
    }
  });
}
