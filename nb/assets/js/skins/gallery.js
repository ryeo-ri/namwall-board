// GALLERY 스킨 — masonry 썸네일 목록 (원본 남월보드 마크업)
// 이미지 클릭 = 라이트박스, 출처 표시, 댓글 없음. 비밀글은 서버 검증 후 열람.
import { runQuery, naruErrorMessage } from "../core/naru-client.js";
import { escapeHtml } from "../core/site.js";
import { renderLockIcon } from "../shared/secret-icon.js";

export function renderGalleryList(posts, board) {
  if (!posts.length) return '<div class="notice">아직 게시물이 없습니다.</div>';
  const columns = clampColumns(board.options?.galleryColumns, 4);

  return `
    <div class="gallery-masonry" style="--gallery-columns:${columns}">
      ${posts.map((post) => renderGalleryCard(post, board)).join("")}
    </div>
  `;
}

export function renderGalleryCard(post, board) {
  const title = escapeHtml(post.title || "");
  const contentMarkup = post.title
    ? `<div class="gallery-card-content">${title}</div>`
    : "";
  const editLink = post.editable
    ? `<div class="gallery-text-footer"><a class="gallery-manage-button gallery-edit-button" href="write.html?id=${encodeURIComponent(post.id)}&bo=${encodeURIComponent(board.id)}">수정</a></div>`
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
  } else if (post.thumb) {
    mediaHtml = `
      <button
        type="button"
        class="gallery-media gallery-lightbox-trigger"
        data-lightbox-image="${escapeHtml(post.thumb)}"
        onclick="openLightbox('${escapeJsString(post.thumb)}')"
        aria-label="${title ? `${title} 원본 이미지 보기` : "원본 이미지 보기"}"
      >
        <img src="${escapeHtml(post.thumb)}" alt="${title}" loading="lazy" class="gallery-image">
        <div class="gallery-overlay"><span class="btn small">원본 보기</span></div>
      </button>
    `;
  } else {
    mediaHtml = `<div class="gallery-text-card">${title || '<span class="gallery-placeholder">내용 없음</span>'}</div>`;
  }

  return `
    <article class="gallery-card" data-post-id="${post.id}">
      <div class="gallery-media-wrap${post.thumb || post.isSecret ? "" : " gallery-text-only-wrap"}">
        ${mediaHtml}
        ${renderGallerySource(post.source)}
      </div>
      ${contentMarkup}
      ${editLink}
    </article>
  `;
}

function renderGallerySource(rawSource) {
  const source = String(rawSource || "").trim();
  if (!source) return "";
  const url = getHttpUrl(source);
  const content = url
    ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" aria-label="출처 링크">링크</a>`
    : `<span>${escapeHtml(source)}</span>`;
  return `<div class="gallery-source">${content}</div>`;
}

// 비밀글 열람 — 서버가 비밀번호를 확인하고 전체 글을 돌려주면 카드를 다시 그린다
export function bindGallery(root, board) {
  root.querySelectorAll("[data-gallery-unlock]").forEach((button) => {
    const id = Number(button.dataset.galleryUnlock);
    const box = root.querySelector(`[data-gallery-secret="${id}"]`);
    const input = box?.querySelector(".gallery-secret-input");
    const errorEl = box?.querySelector(".gallery-secret-error");
    const tryUnlock = async () => {
      try {
        const post = await runQuery("board:post", { id, password: input?.value || "" });
        const card = root.querySelector(`.gallery-card[data-post-id="${id}"]`);
        if (card) {
          card.outerHTML = renderGalleryCard({ ...post, isSecret: false }, board);
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
}

function getHttpUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function clampColumns(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.min(4, Math.round(number))) : fallback;
}

function escapeJsString(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
