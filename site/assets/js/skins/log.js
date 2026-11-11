// NAMWALL Edition Copyright (c) 2026 NAMWALL — MPL-2.0 (https://mozilla.org/MPL/2.0/)
// LOG 스킨 — 목록과 상세가 합쳐진 피드: 이미지 + 본문(첫 댓글 모양) + 댓글, 로그 번호, 태그
import { runQuery } from "../core/naru-client.js";
import { escapeHtml, formatDateTime, ownerDisplayName } from "../core/site.js";
import { renderRichText } from "../shared/rich-text.js";
import { renderLockIcon, bindPasswordPrompt } from "../shared/ui.js";
import { loadComments } from "../shared/comments.js";
import { isVideoPost, renderVideoFrame } from "../shared/video.js";

function resolveLogLayout(board) {
  const width = Number(board.options?.imageWidth);
  return {
    imageWidth: Number.isFinite(width) && width > 0 ? `${Math.round(width)}px` : (width === 0 ? "none" : ""),
    commentPosition: board.options?.commentPosition === "bottom" ? "bottom" : "default"
  };
}

// options.showManage: 수정·삭제 표시 / options.selectable: 선택삭제 체크박스
export function renderLogFeed(posts, board, options = {}) {
  if (!posts.length) return '<div class="notice">아직 게시물이 없습니다.</div>';
  const layout = resolveLogLayout(board);
  const hasMediaWidth = Boolean(layout.imageWidth && layout.imageWidth !== "none");
  return `
    <div class="log-feed${layout.commentPosition === "bottom" ? " is-comment-bottom" : ""}${layout.imageWidth === "none" ? " is-unlimited-image" : ""}${hasMediaWidth ? " has-log-media-width" : ""}"${hasMediaWidth ? ` style="--log-media-width:${layout.imageWidth};"` : ""}>
      ${posts.map((post) => renderLogEntry(post, board, layout, options)).join("")}
    </div>
  `;
}

function renderLogEntry(post, board, layout, { showManage = true, selectable = false } = {}) {
  const dateStr = escapeHtml(formatDateTime(post.createdAt));
  const author = post.isOwnerPost ? ownerDisplayName() : (post.nickname || "익명");
  const locked = post.isSecret && post.body == null;
  const hasMedia = Boolean(locked || post.thumb);

  const bodyHtml = renderRichText(post.body, { boardId: board.id, allowIframes: true });
  const bodyContent = document.createElement("div");
  bodyContent.innerHTML = bodyHtml;
  const hasBody = Boolean(bodyContent.textContent.trim() || bodyContent.querySelector("img[src], iframe[src]"));

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
        <button type="button" class="log-manage-button log-delete-button" data-del-post="${post.id}">삭제</button>
      </div>
    `
    : "";
  const selectHtml = selectable
    ? `<label class="log-select-wrap" title="선택삭제 대상"><input type="checkbox" class="log-select-check" data-post-select="${post.id}"></label>`
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
      ` : isVideoPost(post) ? `
        <div class="log-hero log-hero-video">${renderVideoFrame(post.thumb, "log-hero-video-frame")}</div>
      ` : post.thumb ? `
        <button
          type="button"
          class="log-hero"
          data-lightbox-image="${escapeHtml(post.thumb)}"
          aria-label="원본 이미지 보기"
        >
          <img src="${escapeHtml(post.thumb)}" alt="" loading="lazy" class="log-hero-image">
        </button>
      ` : "";

  const inlineGallery = !locked && Array.isArray(post.images) && post.images.length
    ? `
      <div class="log-inline-gallery">
        ${post.images.map((url) => `
          <button type="button" class="log-inline-image" data-lightbox-image="${escapeHtml(url)}" aria-label="원본 이미지 보기">
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
      ${(metaHtml || manageHtml || selectHtml) ? `
        <div class="log-top-meta">
          ${selectHtml}
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

export function bindLogFeed(root, board, posts, options = {}) {
  const layout = resolveLogLayout(board);
  const commentOptions = { compact: true, allowReplies: true, memberOnly: board?.options?.memberComment === true };
  const loadPostComments = (id) => {
    const container = root.querySelector(`#log-comments-${id}`);
    if (container) loadComments(id, container, commentOptions);
  };

  posts.forEach((post) => {
    if (!(post.isSecret && post.body == null)) loadPostComments(post.id);
  });

  // 비밀글 열람 — 서버가 비밀번호를 확인하면 글 전체를 다시 그린다
  root.querySelectorAll("[data-log-unlock]").forEach((button) => {
    const id = Number(button.dataset.logUnlock);
    const box = root.querySelector(`[data-log-secret="${id}"]`);
    bindPasswordPrompt(button, box?.querySelector(".log-secret-input"), box?.querySelector(".log-secret-error"), async (password) => {
      const post = await runQuery("board:post", { id, password });
      const article = root.querySelector(`.log-post[data-post-id="${id}"]`);
      if (!article) return;
      const wrap = document.createElement("div");
      wrap.innerHTML = renderLogEntry({ ...post, isSecret: false }, board, layout, options);
      article.replaceWith(wrap.firstElementChild);
      loadPostComments(id);
    });
  });

  // ?log=N — 해당 로그 번호로 스크롤
  const target = Number(new URLSearchParams(location.search).get("log")) || 0;
  if (target) {
    const post = posts.find((item) => item.logNo === target);
    const article = post ? root.querySelector(`.log-post[data-post-id="${post.id}"]`) : null;
    article?.scrollIntoView({ block: "start" });
  }
}
