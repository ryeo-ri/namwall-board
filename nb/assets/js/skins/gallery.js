// GALLERY 스킨 — masonry 썸네일 목록 (원본 남월보드 마크업)
// 이미지 클릭 = 라이트박스, 추가 이미지는 카드 위 ◆ 플로팅 버튼, 출처 표시, 댓글 없음.
// 관리자 모드(showManage·selectable): 카드 상단 바에 번호·날짜·수정·삭제와 선택 체크박스.
// 비밀글은 서버 검증 후 열람.
import { runQuery, runMutate, naruErrorMessage } from "../core/naru-client.js";
import { escapeHtml, formatDate } from "../core/site.js";
import { renderLockIcon } from "../shared/secret-icon.js";

export function renderGalleryList(posts, board, options = {}) {
  if (!posts.length) return '<div class="notice">아직 게시물이 없습니다.</div>';
  const columns = clampColumns(board.options?.galleryColumns, 4);

  return `
    <div class="gallery-masonry" style="--gallery-columns:${columns}">
      ${posts.map((post) => renderGalleryCard(post, board, options)).join("")}
    </div>
  `;
}

export function renderGalleryCard(post, board, options = {}) {
  const showManage = options.showManage !== false;
  const selectable = options.selectable === true;
  const title = escapeHtml(post.title || "");
  const contentMarkup = post.title
    ? `<div class="gallery-card-content">${title}</div>`
    : "";

  // 카드 상단 바(그림 위 줄글): (관리자 모드) 선택 체크박스 + 번호 + 날짜 + 수정·삭제
  const canManage = Boolean(post.editable && showManage);
  const manageBar = canManage || selectable
    ? `
      <div class="gallery-delete-topbar">
        <div class="gallery-delete-left">
          ${selectable ? `<label class="gallery-delete-check"><input type="checkbox" data-gallery-select="${post.id}"></label>` : ""}
          <span class="gallery-manage-no">${post.id}</span>
          <span class="gallery-delete-date">${escapeHtml(formatDate(post.createdAt))}</span>
        </div>
        ${canManage ? `
          <div class="gallery-manage-actions">
            <a class="gallery-manage-button gallery-edit-button" href="write.html?id=${encodeURIComponent(post.id)}&bo=${encodeURIComponent(board.id)}" aria-label="게시물 수정">수정</a>
            <button type="button" class="gallery-manage-button gallery-delete-button" data-gallery-delete="${post.id}" aria-label="게시물 삭제">삭제</button>
          </div>
        ` : ""}
      </div>
    `
    : "";

  // 추가 이미지: 카드 위 ◆ 플로팅 버튼 — 클릭하면 라이트박스 (원본 gallery-extra-floating)
  const extras = Array.isArray(post.attachments) ? post.attachments.filter((item) => item?.url) : [];
  const extraLayer = extras.length
    ? `
      <div class="gallery-extra-layer">
        <span class="gallery-extra-floating" aria-label="추가 이미지 ${extras.length}개">
          ${extras.map((item, index) => `
            <button
              type="button"
              class="gallery-extra-floating-button"
              onclick="openLightbox('${escapeJsString(item.url)}')"
              aria-label="${escapeHtml(item.name || `추가 이미지 ${index + 1}`)} 원본 보기"
              title="추가 이미지 ${index + 1}"
            ><span class="gallery-extra-plus-icon" aria-hidden="true">◆</span></button>
          `).join("")}
        </span>
      </div>
    `
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
        ${manageBar}
        ${extraLayer}
        ${mediaHtml}
        ${renderGallerySource(post.source)}
      </div>
      ${contentMarkup}
    </article>
  `;
}

function renderGallerySource(rawSource) {
  const content = renderSourceLinks(rawSource);
  return content ? `<div class="gallery-source">${content}</div>` : "";
}

// 출처 표시 — [라벨]URL 형식이면 라벨만 링크로, 나머지는 일반 텍스트 (여러 개 가능)
// URL만 적으면 '링크', 그 외 텍스트는 그대로 보여준다.
export function renderSourceLinks(rawSource) {
  const source = String(rawSource || "").trim();
  if (!source) return "";

  // URL은 공백·대괄호 앞까지 — 붙여 쓴 다음 [라벨]을 삼키지 않게
  const linkPattern = /\[([^\]\r\n]+)\](https?:\/\/[^\s[\]]+)/gi;
  let content = "";
  let lastIndex = 0;
  let match;

  while ((match = linkPattern.exec(source)) !== null) {
    content += escapeHtml(source.slice(lastIndex, match.index));
    // "…/abc, 다음" 처럼 URL 끝에 붙은 문장부호는 링크에서 빼고 텍스트로 둔다
    const rawUrl = match[2].replace(/[.,;:!?]+$/, "");
    const url = getHttpUrl(rawUrl);
    content += url
      ? sourceLink(url, match[1].trim()) + escapeHtml(match[2].slice(rawUrl.length))
      : escapeHtml(match[0]);
    lastIndex = linkPattern.lastIndex;
  }

  if (lastIndex > 0) return content + escapeHtml(source.slice(lastIndex));
  // 공백이 섞인 텍스트는 URL 하나로 보지 않는다 (new URL은 경로의 공백을 허용함)
  const url = /\s/.test(source) ? "" : getHttpUrl(source);
  return url ? sourceLink(url, "링크") : `<span>${escapeHtml(source)}</span>`;
}

function sourceLink(url, label) {
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="text-decoration: underline;">${escapeHtml(label)}</a>`;
}

// 비밀글 열람(서버 확인 후 카드 교체) + 삭제(이벤트 위임: 다시 그려도 유지)
export function bindGallery(root, board, reload, options = {}) {
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
          card.outerHTML = renderGalleryCard({ ...post, isSecret: false }, board, options);
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

  // 삭제 — 루트에 한 번만 위임 바인딩
  if (!root.dataset.galleryDeleteBound) {
    root.dataset.galleryDeleteBound = "1";
    root.addEventListener("click", async (event) => {
      const button = event.target instanceof Element ? event.target.closest("[data-gallery-delete]") : null;
      if (!button) return;
      const id = Number(button.dataset.galleryDelete);
      if (!id || !window.confirm("이 게시물을 삭제할까요?")) return;
      button.disabled = true;
      try {
        await runMutate("post:remove", { id });
        await reload?.();
      } catch (error) {
        window.alert(naruErrorMessage(error, "삭제에 실패했습니다."));
        button.disabled = false;
      }
    });
  }
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
