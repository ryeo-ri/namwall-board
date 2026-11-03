// LOG 스킨 — 목록과 뷰가 합쳐진 피드 (원본 남월보드 마크업)
// 이미지 + 본문(댓글 스타일) + 댓글, logNo 칩, 태그, 라이트박스.
// 비밀글은 서버가 가리고, 비밀번호 확인 후 그 자리에서 열람한다.
import { runQuery, runMutate, naruErrorMessage } from "../core/naru-client.js";
import { escapeHtml, formatDateTime, ownerDisplayName } from "../core/site.js";
import { sanitizeHTML } from "../shared/sanitizer.js";
import { renderLockIcon } from "../shared/secret-icon.js";
import { loadComments } from "../shared/comments.js";

function resolveLogLayout(board) {
  const width = Number(board.options?.imageWidth);
  return {
    imageWidth: Number.isFinite(width) && width > 0 ? `${Math.round(width)}px` : (width === 0 ? "none" : ""),
    commentPosition: board.options?.commentPosition === "bottom" ? "bottom" : "default"
  };
}

// showManage: 수정·삭제 버튼 표시 여부 — 관리자는 ADMIN 토글이 켜졌을 때만 보인다
export function renderLogFeed(posts, board, options = {}) {
  if (!posts.length) return '<div class="notice">아직 게시물이 없습니다.</div>';
  const layout = resolveLogLayout(board);
  const hasMediaWidth = Boolean(layout.imageWidth && layout.imageWidth !== "none");
  const showManage = options.showManage !== false;

  return `
    <div class="log-feed${layout.commentPosition === "bottom" ? " is-comment-bottom" : ""}${layout.imageWidth === "none" ? " is-unlimited-image" : ""}${hasMediaWidth ? " has-log-media-width" : ""}"${hasMediaWidth ? ` style="--log-media-width:${layout.imageWidth};"` : ""}>
      ${posts.map((post) => renderLogEntry(post, board, layout, showManage)).join("")}
    </div>
  `;
}

export function renderLogEntry(post, board, layout, showManage = true) {
  const dateStr = escapeHtml(formatDateTime(post.createdAt));
  const author = post.isOwnerPost ? ownerDisplayName() : (post.nickname || "익명");
  const locked = post.isSecret && post.body == null;
  const hasMedia = Boolean(locked || post.thumb);

  const bodyHtml = sanitizeHTML(String(post.body || "").replace(/\n/g, "<br>"), { allowIframes: true });
  const hasBody = bodyHtml.replace(/<[^>]*>/g, "").trim().length > 0;

  const tagChips = Array.isArray(post.tags) && post.tags.length
    ? `<div class="log-tags log-tags-chips">${post.tags.map((tag) => `<a href="search.html?tag=${encodeURIComponent(tag)}" class="tag">${escapeHtml(tag)}</a>`).join("")}</div>`
    : "";

  const metaHtml = post.logNo
    ? `<a href="board.html?bo=${encodeURIComponent(board.id)}&log=${encodeURIComponent(String(post.logNo))}" class="log-number">${escapeHtml(String(post.logNo))}</a>`
    : "";
  const manageHtml = post.editable && showManage
    ? `
      <div class="log-manage-actions">
        <a class="log-manage-button log-edit-button" href="write.html?id=${encodeURIComponent(post.id)}&bo=${encodeURIComponent(board.id)}">수정</a>
        <button type="button" class="log-manage-button log-delete-button" data-log-delete="${post.id}">삭제</button>
      </div>
    `
    : "";

  const mediaHtml = locked ? `
        <div class="log-hero log-hero-secret" data-log-secret="${post.id}">
          <div class="log-secret-lock">
            <div class="log-secret-lock-label" aria-label="비밀글">${renderLockIcon("log-secret-lock-icon")}</div>
            <div class="log-secret-unlock">
              <input type="password" class="log-secret-input" placeholder="비밀번호">
              <button type="button" class="btn log-secret-submit" data-log-unlock="${post.id}">확인</button>
            </div>
            <div class="log-secret-error hidden"></div>
          </div>
        </div>
      ` : post.thumb ? `
        <button
          type="button"
          class="log-hero"
          data-lightbox-image="${escapeHtml(post.thumb)}"
          onclick="openLightbox('${escapeJsString(post.thumb)}')"
          aria-label="원본 이미지 보기"
        >
          <img src="${escapeHtml(post.thumb)}" alt="" loading="lazy" class="log-hero-image">
        </button>
      ` : "";

  const inlineGallery = !locked && Array.isArray(post.images) && post.images.length
    ? `
      <div class="log-inline-gallery">
        ${post.images.map((url) => `
          <button type="button" class="log-inline-image" data-lightbox-image="${escapeHtml(url)}" onclick="openLightbox('${escapeJsString(url)}')" aria-label="원본 이미지 보기">
            <img src="${escapeHtml(url)}" alt="" loading="lazy">
          </button>
        `).join("")}
      </div>
    `
    : "";

  const sourceHtml = !locked && post.source
    ? `<footer class="log-footer"><div class="log-source">출처 ${escapeHtml(post.source)}</div></footer>`
    : "";

  const contentBits = `
    ${layout.commentPosition === "bottom" || !hasMedia ? tagChips : ""}
    ${inlineGallery}
    ${sourceHtml}
  `;

  // 본문은 댓글 영역 첫 항목처럼 (원본 log-body-comment)
  const bodyCommentHtml = !locked && hasBody ? `
    <div class="comments-section log-comments log-body-comment-wrap">
      <article class="comment-item log-body-comment">
        <div class="comment-header">
          <div class="comment-meta-left"><span class="comment-author">${escapeHtml(author)}</span></div>
          <div class="comment-meta-right"><span class="muted small">${dateStr}</span></div>
        </div>
        <div class="comment-content">${bodyHtml}</div>
      </article>
    </div>
  ` : "";
  const commentsHtml = `<div id="log-comments-${post.id}" class="comments-section log-comments"></div>`;

  return `
    <article class="card log-post mt-sm" data-post-id="${post.id}">
      ${(metaHtml || manageHtml) ? `
        <div class="log-top-meta">
          ${metaHtml}
          ${manageHtml}
        </div>
      ` : ""}
      ${layout.commentPosition === "bottom" ? `
        <div class="log-post-stack">
          ${hasMedia ? `<div class="log-media-column">${mediaHtml}</div>` : ""}
          <div class="log-content-column log-content-column-full">
            ${contentBits}
          </div>
        </div>
        ${bodyCommentHtml}
        ${commentsHtml}
      ` : `
        <div class="log-post-content">
          ${hasMedia ? `
            <div class="log-media-column">
              ${mediaHtml}
              ${tagChips}
            </div>
          ` : ""}
          <div class="log-content-column">
            ${!hasMedia ? tagChips : ""}
            ${inlineGallery}
            ${bodyCommentHtml}
            ${commentsHtml}
            ${sourceHtml}
          </div>
        </div>
      `}
    </article>
  `;
}

export function bindLogFeed(root, board, posts, reload, options = {}) {
  const layout = resolveLogLayout(board);
  const showManage = options.showManage !== false;

  // 글별 댓글
  posts.forEach((post) => {
    const container = root.querySelector(`#log-comments-${post.id}`);
    if (container && !(post.isSecret && post.body == null)) {
      loadComments(post.id, container, { compact: true, logStyle: true });
    }
  });

  // 비밀글 해제 — 서버가 비밀번호를 확인하고 전체 글을 돌려준다
  root.querySelectorAll("[data-log-unlock]").forEach((button) => {
    const id = Number(button.dataset.logUnlock);
    const box = root.querySelector(`[data-log-secret="${id}"]`);
    const input = box?.querySelector(".log-secret-input");
    const errorEl = box?.querySelector(".log-secret-error");
    const tryUnlock = async () => {
      try {
        const post = await runQuery("board:post", { id, password: input?.value || "" });
        const article = root.querySelector(`.log-post[data-post-id="${id}"]`);
        if (article) {
          const wrap = document.createElement("div");
          wrap.innerHTML = renderLogEntry({ ...post, isSecret: false }, board, layout, showManage);
          article.replaceWith(wrap.firstElementChild);
          const container = root.querySelector(`#log-comments-${id}`);
          if (container) loadComments(id, container, { compact: true, logStyle: true });
          bindLogDeletes(root, reload);
        }
      } catch (error) {
        if (errorEl) {
          errorEl.textContent = naruErrorMessage(error, "열람에 실패했습니다.");
          errorEl.classList.remove("hidden");
        }
      }
    };
    button.addEventListener("click", tryUnlock);
    input?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); tryUnlock(); }
    });
  });

  bindLogDeletes(root, reload);

  // ?log=N — 해당 로그 번호로 스크롤
  const target = Number(new URLSearchParams(location.search).get("log")) || 0;
  if (target) {
    const post = posts.find((item) => item.logNo === target);
    const article = post ? root.querySelector(`.log-post[data-post-id="${post.id}"]`) : null;
    article?.scrollIntoView({ block: "start" });
  }
}

function bindLogDeletes(root, reload) {
  root.querySelectorAll("[data-log-delete]").forEach((button) => {
    if (button.dataset.bound) return;
    button.dataset.bound = "1";
    button.addEventListener("click", async () => {
      if (!window.confirm("이 글을 삭제할까요?")) return;
      try {
        await runMutate("post:remove", { id: Number(button.dataset.logDelete) });
        await reload();
      } catch (error) {
        window.alert(naruErrorMessage(error, "삭제에 실패했습니다."));
      }
    });
  });
}

function escapeJsString(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
