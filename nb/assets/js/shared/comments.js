// 댓글 — 목록/작성(회원·게스트)/비밀 댓글/접기/삭제 (원본 남월보드 마크업)
// 이미지 첨부(allowImages 옵션): 회원·관리자만, Ctrl+V 붙여넣기, 최대 8장, 1400px WebP 리사이즈.
// 덧글 제한(memberOnly 옵션 = 게시판 options.memberComment): 비로그인 방문자에게 폼을 숨긴다.
// 권한 판정은 전부 서버 쿼리·뮤테이션이 하고, 여기서는 받은 플래그대로 그린다.
import { runQuery, runMutate, getAdminSession, getMemberSession, naruErrorMessage } from "../core/naru-client.js";
import { loadBoot, promptNickname, escapeHtml, formatDateTime, ownerDisplayName } from "../core/site.js";
import { sanitizeHTML } from "./sanitizer.js";

const MAX_COMMENT_IMAGES = 8;
const COMMENT_IMAGE_MAX_EDGE = 1400;

// ▼로 연 댓글 폼과 '펼치기'로 연 접기 댓글 — 다시 그려도 상태 유지
const expandedCommentForms = new Set();
const expandedComments = new Set();

export async function loadComments(postId, container, options = {}) {
  if (!container) return;
  const [boot, admin, member] = await Promise.all([loadBoot(), getAdminSession(), getMemberSession()]);
  const uploader = admin || member;
  const canAttach = options.allowImages === true && Boolean(uploader);

  let comments = [];
  try {
    comments = await runQuery("board:comments", { post: postId });
  } catch (error) {
    container.innerHTML = `<div class="notice small">${escapeHtml(naruErrorMessage(error, "댓글을 불러오지 못했습니다."))}</div>`;
    return;
  }

  container.innerHTML = `
    <div class="comments-list">
      ${comments.map((comment) => renderCommentItem(comment, options)).join("")}
    </div>
    ${renderCommentForm(boot, options, canAttach, postId)}
  `;

  const reload = () => loadComments(postId, container, options);
  bindReveal(container);
  bindDelete(container, reload);
  bindFoldButtons(container);
  bindFormToggle(container, postId);
  bindSubmit(container, postId, reload, { canAttach, uploader });
}

function displayName(entry) {
  if (entry.isOwnerComment || entry.isOwnerEntry) return ownerDisplayName();
  return entry.name || "익명";
}

function renderCommentItem(comment, options) {
  const dateStr = escapeHtml(formatDateTime(comment.createdAt));
  const nameHtml = `<span class="comment-author">${escapeHtml(displayName(comment))}</span>`;
  const deleteBtn = (comment.deletable || comment.hasPassword)
    ? `<span class="comment-admin-actions"><button type="button" class="btn" data-del-comment data-comment-delete="${comment.id}" data-ask-pass="${comment.deletable ? "" : "1"}" title="삭제">D</button></span>`
    : "";

  const metaLeft = options.dateFirstHeader ? `<span class="muted small">${dateStr}</span>` : nameHtml;
  const metaRight = options.dateFirstHeader
    ? `${nameHtml}${deleteBtn}`
    : `<span class="muted small">${dateStr}</span>${deleteBtn}`;

  let bodyHtml;
  if (comment.body != null) {
    // 접기 댓글: 작성 시 체크한 댓글은 접힌 상태 + '펼치기' 버튼 (원본 more)
    const foldable = Boolean(comment.more) && Boolean(comment.body);
    const expanded = expandedComments.has(comment.id);
    const foldBtn = foldable
      ? `<button type="button" class="comment-more-btn" data-comment-more="${comment.id}" aria-expanded="${expanded ? "true" : "false"}">${expanded ? "접기" : "펼치기"}</button>`
      : "";
    const foldClass = foldable && !expanded ? " is-folded is-manual-fold" : "";
    const textHtml = comment.body
      ? `<div class="comment-content${foldClass}" data-comment-body="${comment.id}">${sanitizeHTML(toBr(comment.body), { allowIframes: false })}</div>`
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

  return `
    <article class="comment-item" data-comment-id="${comment.id}">
      <div class="comment-header">
        <div class="comment-meta-left">${metaLeft}</div>
        <div class="comment-meta-right">${metaRight}</div>
      </div>
      ${bodyHtml}
    </article>
  `;
}

function renderCommentImages(images) {
  const urls = Array.isArray(images) ? images.filter(Boolean) : [];
  if (!urls.length) return "";
  return `
    <div class="comment-images">
      ${urls.map((url) => `
        <button type="button" class="comment-image-view" data-comment-image-view="${escapeHtml(url)}" aria-label="댓글 이미지 원본 보기">
          <img src="${escapeHtml(url)}" alt="댓글 이미지" loading="lazy">
        </button>
      `).join("")}
    </div>
  `;
}

// 원본 댓글 폼: ▼ 토글 → 닉네임(게스트만 — 나루 로그인 시 생략) → 내용 →
// [접기] [비밀] [이미지 첨부] [비밀번호(비밀 체크 시)] [등록]
// 상세(#viewComments)·방명록에서는 CSS가 토글을 숨기고 항상 펼친다.
function renderCommentForm(boot, options, canAttach, postId) {
  if (options.allowWrite === false) return "";
  const asMember = boot.owner || boot.me;
  // 덧글 제한 게시판(memberOnly): 비로그인 방문자에게는 폼 대신 안내 — 로그 피드는 글마다 반복되니 생략
  if (options.memberOnly && !asMember) {
    return options.compact ? "" : '<div class="comment-member-only muted small mt-sm">로그인한 회원만 댓글을 쓸 수 있습니다.</div>';
  }
  const formExpanded = expandedCommentForms.has(postId);

  const nameRow = asMember ? "" : `
        <div class="comment-form-row comment-form-row-name">
          <input type="text" class="comment-name-input" placeholder="닉네임" maxlength="40">
        </div>`;
  const passWrap = asMember ? "" : `
          <span class="comment-secret-pass-wrap hidden">
            <span class="comment-pass-label">비밀번호</span>
            <input type="password" class="comment-pass-input" placeholder="비밀번호" maxlength="64">
          </span>`;
  // 이미지 첨부 버튼은 하단 옵션줄(접기·비밀 옆), 미리보기는 내용 입력칸 아래
  const attachButton = canAttach
    ? `
          <button type="button" class="btn comment-image-attach">이미지 첨부</button>
          <input type="file" class="comment-image-input hidden" accept="image/*" multiple>`
    : "";
  const attachPreviews = canAttach ? '<div class="comment-image-previews hidden"></div>' : "";
  return `
    <form class="comment-form" autocomplete="off" data-as-member="${asMember ? "1" : ""}">
      <div class="comment-form-head">
        <button type="button" class="comment-form-toggle" data-comment-form-toggle aria-label="댓글 작성 폼 열기">▼</button>
      </div>
      <div class="comment-form-body${formExpanded ? "" : " hidden"}">
        ${nameRow}
        <div class="comment-form-row">
          <textarea class="comment-memo-input" rows="3" placeholder="내용"></textarea>
        </div>
        ${attachPreviews}
        <div class="comment-form-row comment-form-row-inline comment-form-row-options">
          <label class="comment-toggle"><input type="checkbox" class="comment-fold-toggle"> <span>접기</span></label>
          <label class="comment-toggle"><input type="checkbox" class="comment-secret-toggle"> <span>비밀</span></label>
          ${attachButton}
          ${passWrap}
          <button type="submit" class="btn primary comment-submit-btn">등록</button>
        </div>
        <div class="comment-msg notice small hidden"></div>
      </div>
    </form>
  `;
}

function bindFormToggle(container, postId) {
  const toggle = container.querySelector("[data-comment-form-toggle]");
  const body = container.querySelector(".comment-form-body");
  if (!toggle || !body) return;
  toggle.addEventListener("click", () => {
    const hidden = body.classList.toggle("hidden");
    if (hidden) expandedCommentForms.delete(postId);
    else expandedCommentForms.add(postId);
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

function toBr(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\n/g, "<br>");
}

/* ── 이미지 첨부: 비율 유지 리사이즈 → WebP (움짤 GIF는 원본 유지) ── */
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

function bindCommentImages(form, pending) {
  const attachBtn = form.querySelector(".comment-image-attach");
  const fileInput = form.querySelector(".comment-image-input");
  const previews = form.querySelector(".comment-image-previews");
  const textarea = form.querySelector(".comment-memo-input");
  if (!attachBtn || !fileInput || !previews) return;

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
    const incoming = Array.from(files || []).filter((file) => /^image\//i.test(file?.type || ""));
    if (!incoming.length) return false;
    if (pending.length + incoming.length > MAX_COMMENT_IMAGES) {
      window.alert(`이미지는 댓글당 최대 ${MAX_COMMENT_IMAGES}장까지 첨부할 수 있습니다.`);
      return true;
    }
    try {
      for (const file of incoming) {
        const blob = await resizeCommentImage(file);
        pending.push({ blob, previewUrl: URL.createObjectURL(blob) });
      }
      refresh();
    } catch (error) {
      window.alert(error?.message || "이미지를 처리하지 못했습니다.");
    }
    return true;
  };

  attachBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    await addFiles(fileInput.files);
    fileInput.value = "";
  });
  textarea?.addEventListener("paste", async (event) => {
    const files = Array.from(event.clipboardData?.files || []).filter((file) => /^image\//i.test(file.type || ""));
    if (!files.length) return;
    event.preventDefault();
    await addFiles(files);
  });
  previews.addEventListener("click", (event) => {
    const removeBtn = event.target instanceof Element ? event.target.closest("[data-image-remove]") : null;
    if (!removeBtn) return;
    const index = Number(removeBtn.dataset.imageRemove);
    if (!Number.isInteger(index) || index < 0 || index >= pending.length) return;
    URL.revokeObjectURL(pending[index].previewUrl);
    pending.splice(index, 1);
    refresh();
  });
}

// 게스트 비밀 댓글·방명록 열람 — 서버가 비밀번호를 확인하고 본문을 돌려준다.
// 성공하면 그 자리에서 본문으로 교체한다.
export function bindReveal(root) {
  root.querySelectorAll("[data-reveal]").forEach((button) => {
    const id = Number(button.dataset.reveal);
    const kind = button.dataset.revealKind;
    const bodyClass = button.dataset.revealClass || "comment-content";
    const box = root.querySelector(`[data-reveal-box="${id}"]`);
    const input = box?.querySelector("input[type=password]");
    const errorEl = box?.querySelector(".comment-secret-error, .guestbook-secret-error");
    const tryReveal = async () => {
      try {
        const { body } = await runQuery(kind, { id, password: input?.value || "" });
        if (box) {
          const bodyEl = document.createElement("div");
          bodyEl.className = bodyClass;
          bodyEl.innerHTML = sanitizeHTML(toBr(body), { allowIframes: false });
          box.replaceWith(bodyEl);
        }
      } catch (error) {
        if (errorEl) {
          errorEl.textContent = naruErrorMessage(error, "열람에 실패했습니다.");
          errorEl.classList.remove("hidden");
        }
      }
    };
    button.addEventListener("click", tryReveal);
    input?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); tryReveal(); }
    });
  });
}

function bindDelete(root, reload) {
  root.querySelectorAll("[data-comment-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = Number(button.dataset.commentDelete);
      const askPass = button.dataset.askPass === "1";
      let password;
      if (askPass) {
        password = window.prompt("댓글 비밀번호를 입력하세요.");
        if (password === null) return;
      } else if (!window.confirm("이 댓글을 삭제할까요?")) {
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

  // 댓글 이미지 라이트박스
  root.querySelectorAll("[data-comment-image-view]").forEach((button) => {
    button.addEventListener("click", () => {
      const url = String(button.dataset.commentImageView || "");
      if (!url) return;
      if (typeof window.openLightbox === "function") window.openLightbox(url);
      else window.open(url, "_blank", "noopener");
    });
  });
}

function bindSubmit(container, postId, reload, { canAttach, uploader }) {
  const form = container.querySelector(".comment-form");
  if (!form) return;
  const msgEl = form.querySelector(".comment-msg");
  const showMsg = (text) => {
    if (!msgEl) return;
    msgEl.textContent = text;
    msgEl.classList.remove("hidden");
  };

  const pendingImages = [];
  if (canAttach) bindCommentImages(form, pendingImages);

  // 비밀 체크 시에만 비밀번호 칸 표시 (게스트)
  const secretToggle = form.querySelector(".comment-secret-toggle");
  const passWrap = form.querySelector(".comment-secret-pass-wrap");
  secretToggle?.addEventListener("change", () => {
    passWrap?.classList.toggle("hidden", !secretToggle.checked);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = form.querySelector(".comment-memo-input")?.value.trim() || "";
    const isSecret = Boolean(form.querySelector(".comment-secret-toggle")?.checked);
    const more = Boolean(form.querySelector(".comment-fold-toggle")?.checked);
    if (!body && !pendingImages.length) return showMsg("내용을 입력해 주세요.");

    const payload = { post: postId, body, secret: isSecret, more };
    if (!form.dataset.asMember) {
      payload.name = form.querySelector(".comment-name-input")?.value.trim() || "";
      payload.password = form.querySelector(".comment-pass-input")?.value || "";
      if (!payload.name) return showMsg("닉네임을 입력해 주세요.");
      if (isSecret && !payload.password) return showMsg("비밀 댓글은 비밀번호를 입력하세요.");
    }

    const submitBtn = form.querySelector(".comment-submit-btn");
    if (submitBtn) submitBtn.disabled = true;
    try {
      if (pendingImages.length && uploader) {
        showMsg("이미지 업로드 중…");
        const urls = [];
        for (const item of pendingImages) {
          const uploaded = await uploader.media.upload(item.blob);
          urls.push(uploaded.url);
        }
        payload.images = urls;
      }
      await runMutate("comment:add", payload);
      pendingImages.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      pendingImages.length = 0;
      await reload();
    } catch (error) {
      if (error?.details?.needProfile) {
        if (submitBtn) submitBtn.disabled = false;
        await promptNickname("댓글을 쓰려면 닉네임이 필요합니다. 사용할 닉네임을 입력하세요.");
        return;
      }
      showMsg(naruErrorMessage(error, "댓글 등록에 실패했습니다."));
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}
