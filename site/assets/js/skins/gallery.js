// NAMWALL Edition Copyright (c) 2026 NAMWALL — MPL-2.0 (https://mozilla.org/MPL/2.0/)
// GALLERY 스킨 — masonry 카드 목록, 댓글 없음
// 대표 칸은 이미지(클릭 = 라이트박스)·VIDEO·TEXT 중 하나. 카드 아래 줄에 추가 이미지(●)와 출처(커서를 올리면 표시).
import { runQuery } from "../core/naru-client.js";
import { escapeHtml, formatDate, clampColumns, renderSourceLinks } from "../core/site.js";
import { renderLockIcon, renderManageBar, bindPasswordPrompt } from "../shared/ui.js";
import { isVideoPost, renderVideoFrame } from "../shared/video.js";

export function renderGalleryList(posts, board, options = {}) {
  if (!posts.length) return '<div class="notice">아직 게시물이 없습니다.</div>';
  const columns = clampColumns(board.options?.galleryColumns, 4);
  return `
    <div class="gallery-masonry" style="--gallery-columns:${columns}">
      ${posts.map((post) => renderGalleryCard(post, board, options)).join("")}
    </div>
  `;
}

function renderGalleryCard(post, board, options = {}) {
  // 카드 텍스트 = TEXT 칸(본문). 예전 글은 제목. 줄바꿈은 CSS(pre-wrap)가 살린다.
  const text = escapeHtml(String(post.body ?? "").trim() || String(post.title || "").trim());
  const title = escapeHtml(post.title || "");
  const contentMarkup = text && (post.thumb || post.isSecret)
    ? `<div class="gallery-card-content">${text}</div>`
    : "";

  const manageBar = renderManageBar(post, board, {
    selectable: options.selectable === true,
    canManage: Boolean(post.editable && options.showManage !== false),
    label: formatDate(post.createdAt)
  });

  const extras = Array.isArray(post.attachments) ? post.attachments.filter((item) => item?.url) : [];
  const extraDots = extras.length
    ? `<span class="gallery-extra-dots" aria-label="추가 이미지 ${extras.length}개">${extras.map((item, index) => `<button
        type="button"
        class="gallery-extra-dot"
        data-lightbox-image="${escapeHtml(item.url)}"
        aria-label="${escapeHtml(item.name || `추가 이미지 ${index + 1}`)} 원본 보기"
        title="추가 이미지 ${index + 1}"
      >●</button>`).join("")}</span>`
    : "";
  const sourceContent = renderSourceLinks(post.source);
  const footer = extraDots || sourceContent
    ? `<div class="gallery-card-footer">${extraDots}${sourceContent ? `<span class="gallery-card-source">${sourceContent}</span>` : ""}</div>`
    : "";

  let mediaHtml;
  if (post.isSecret) {
    mediaHtml = `
      <div class="gallery-media gallery-media-secret" data-gallery-secret="${post.id}">
        <div class="gallery-secret-lock">
          <div class="gallery-secret-lock-label" aria-label="비밀글">${renderLockIcon("gallery-secret-lock-icon")}</div>
          <div class="gallery-secret-unlock">
            <input type="password" class="gallery-secret-input" placeholder="비밀번호">
            <button type="button" class="btn small gallery-secret-submit" data-gallery-unlock="${post.id}">확인</button>
          </div>
          <div class="gallery-secret-error hidden"></div>
        </div>
      </div>
    `;
  } else if (isVideoPost(post)) {
    mediaHtml = `<div class="gallery-media gallery-media-video">${renderVideoFrame(post.thumb)}</div>`;
  } else if (post.thumb) {
    mediaHtml = `
      <button
        type="button"
        class="gallery-media gallery-lightbox-trigger"
        data-lightbox-image="${escapeHtml(post.thumb)}"
        aria-label="${title ? `${title} 원본 이미지 보기` : "원본 이미지 보기"}"
      >
        <img src="${escapeHtml(post.thumb)}" alt="${title}" loading="lazy" class="gallery-image">
        <div class="gallery-overlay"><span class="btn small">원본 보기</span></div>
      </button>
    `;
  } else {
    mediaHtml = `<div class="gallery-text-card">${text || '<span class="gallery-placeholder">내용 없음</span>'}</div>`;
  }

  return `
    <article class="gallery-card" data-post-id="${post.id}">
      <div class="gallery-media-wrap${post.thumb || post.isSecret ? "" : " gallery-text-only-wrap"}">
        ${manageBar}
        ${mediaHtml}
      </div>
      ${footer}
      ${contentMarkup}
    </article>
  `;
}

// 비밀글 열람 — 서버가 비밀번호를 확인하면 카드를 다시 그린다
export function bindGallery(root, board, options = {}) {
  root.querySelectorAll("[data-gallery-unlock]").forEach((button) => {
    const id = Number(button.dataset.galleryUnlock);
    const box = root.querySelector(`[data-gallery-secret="${id}"]`);
    bindPasswordPrompt(button, box?.querySelector(".gallery-secret-input"), box?.querySelector(".gallery-secret-error"), async (password) => {
      const post = await runQuery("board:post", { id, password });
      const card = root.querySelector(`.gallery-card[data-post-id="${id}"]`);
      if (card) card.outerHTML = renderGalleryCard({ ...post, isSecret: false }, board, options);
    });
  });
}
