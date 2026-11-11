// NARU BOARD Copyright (c) 2026 NAMWALL — MPL-2.0 (https://mozilla.org/MPL/2.0/)
// BOOKMARK 스킨 — 배너 모음(이름·배너 이미지·링크). 맨 위는 게시판 설정의 소개 HTML(introHtml)
import { escapeHtml, getHttpUrl, clampColumns } from "../core/site.js";
import { sanitizeHTML } from "../shared/sanitizer.js";
import { renderManageBar } from "../shared/ui.js";

export function renderBookmarkList(posts, board, options = {}) {
  const columns = clampColumns(board.options?.galleryColumns, 3);
  const introHtml = String(board.options?.introHtml || "").trim();
  const intro = introHtml
    ? `<div class="bookmark-intro">${sanitizeHTML(introHtml, { allowIframes: true })}</div>`
    : "";
  const grid = posts.length
    ? `<div class="bookmark-grid" style="--bookmark-columns:${columns}">
        ${posts.map((post) => renderBookmarkItem(post, board, options)).join("")}
      </div>`
    : '<div class="notice">아직 등록된 배너가 없습니다.</div>';
  return intro + grid;
}

function renderBookmarkItem(post, board, options = {}) {
  const name = String(post.title || "").trim();
  const link = getHttpUrl(post.source);
  const manageBar = renderManageBar(post, board, {
    selectable: options.selectable === true,
    canManage: Boolean(post.editable && options.showManage !== false),
    label: name,
    noun: "배너"
  });

  let inner;
  if (post.isSecret) {
    inner = '<span class="bookmark-text-banner">비밀글</span>';
  } else if (post.thumb) {
    inner = `<img src="${escapeHtml(post.thumb)}" alt="${escapeHtml(name)}" loading="lazy">`;
  } else {
    inner = `<span class="bookmark-text-banner">${escapeHtml(name) || "배너"}</span>`;
  }

  const banner = link && !post.isSecret
    ? `<a class="bookmark-banner" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(name)}">${inner}</a>`
    : `<span class="bookmark-banner" title="${escapeHtml(name)}">${inner}</span>`;

  return `
    <article class="bookmark-item" data-post-id="${post.id}">
      ${manageBar}
      ${banner}
    </article>
  `;
}
