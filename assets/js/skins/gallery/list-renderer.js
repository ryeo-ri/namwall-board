import { getPostCoverMedia, renderPostVideoFrame } from "../../shared/post-cover.js";
import { renderLockIcon } from "../../shared/secret-icon.js";
import { getPostSkinData } from "../registry.js";

export function renderGalleryList(posts, board, options = {}) {
  const deleteMode = Boolean(options.deleteMode);
  const selectedPostIds = new Set(options.selectedPostIds || []);
  const isAdmin = Boolean(options.isAdmin);
  const unlockedSecretPostIds = new Set(options.unlockedSecretPostIds || []);

  if (posts.length === 0) {
    return `<div class="notice">아직 게시물이 없습니다. 현재 게시판: ${escapeHtml(board?.id || "")}</div>`;
  }

  return `
    <div class="gallery-masonry">
      ${posts.map((post) => {
        const rawPostId = post.id || "";
        const cover = getPostCoverMedia(post);
        const title = escapeHtml(post.title || "");
        const skinData = getPostSkinData(post);
        const sourceMarkup = renderGallerySource(skinData.source);
        const contentText = getGalleryContentText(post);
        const contentMarkup = contentText
          ? `<div class="gallery-card-content">${escapeHtml(contentText)}</div>`
          : "";
        const extraAttachments = Array.isArray(post.extraAttachments) ? post.extraAttachments.filter((item) => item?.url) : [];
        const createdAt = post.createdAt?.toDate ? post.createdAt.toDate() : new Date(post.createdAt);
        const dateStr = Number.isNaN(createdAt.getTime()) ? "" : createdAt.toLocaleDateString("ko-KR");
        const postId = escapeHtml(rawPostId);
        const isSelected = selectedPostIds.has(rawPostId);
        const isSecret = Boolean(post.isSecret);
        const isUnlocked = isAdmin || !isSecret || unlockedSecretPostIds.has(rawPostId);

        return `
          <article class="gallery-card${deleteMode ? " gallery-card-delete-mode" : ""}${isSelected ? " is-delete-selected" : ""}" data-post-id="${postId}">
            ${isSecret && !isUnlocked
              ? `
                <div class="gallery-media-wrap">
                  ${deleteMode ? `
                    <div class="gallery-delete-topbar">
                      <div class="gallery-delete-left">
                        <label class="gallery-delete-check">
                          <input type="checkbox" data-gallery-select="${postId}" ${isSelected ? "checked" : ""}>
                        </label>
                        <span class="gallery-delete-date">${escapeHtml(dateStr)}</span>
                      </div>
                      <div class="gallery-manage-actions">
                        <a class="gallery-manage-button gallery-edit-button" href="write.html?id=${encodeURIComponent(rawPostId)}&bo=${encodeURIComponent(post.boardId || board?.id || "board")}" aria-label="게시물 수정">수정</a>
                        <button type="button" class="gallery-manage-button gallery-delete-button" data-gallery-delete="${postId}" aria-label="게시물 삭제">삭제</button>
                      </div>
                    </div>
                  ` : ""}
                  <div class="gallery-media gallery-media-secret">
                    <div class="gallery-secret-lock">
                      <div class="gallery-secret-lock-label" aria-label="비밀글">${renderLockIcon("gallery-secret-lock-icon")}</div>
                      <div class="gallery-secret-unlock">
                        <input type="password" class="gallery-secret-input" placeholder="비밀번호">
                        <button type="button" class="btn small gallery-secret-submit">확인</button>
                      </div>
                      <div class="gallery-secret-error hidden"></div>
                    </div>
                  </div>
                </div>
              `
              : cover.mode === "video" && cover.embedHtml
              ? `
                <div class="gallery-media-wrap">
                  ${extraAttachments.length ? `
                    <div class="gallery-extra-layer">
                      ${renderExtraLightboxButtons(extraAttachments)}
                    </div>
                  ` : ""}
                  ${deleteMode ? `
                    <div class="gallery-delete-topbar">
                      <div class="gallery-delete-left">
                        <label class="gallery-delete-check">
                          <input type="checkbox" data-gallery-select="${postId}" ${isSelected ? "checked" : ""}>
                        </label>
                        <span class="gallery-delete-date">${escapeHtml(dateStr)}</span>
                      </div>
                      <div class="gallery-manage-actions">
                        <a class="gallery-manage-button gallery-edit-button" href="write.html?id=${encodeURIComponent(rawPostId)}&bo=${encodeURIComponent(post.boardId || board?.id || "board")}" aria-label="게시물 수정">수정</a>
                        <button type="button" class="gallery-manage-button gallery-delete-button" data-gallery-delete="${postId}" aria-label="게시물 삭제">삭제</button>
                      </div>
                    </div>
                  ` : ""}
                    <div class="gallery-media gallery-media-video">
                      ${renderPostVideoFrame(cover.embedHtml, "gallery-media-video-frame")}
                    </div>
                    ${sourceMarkup}
                  </div>
                  ${contentMarkup}
                `
              : cover.imageUrl
                ? `
                  <div class="gallery-media-wrap">
                    ${extraAttachments.length ? `
                      <div class="gallery-extra-layer">
                        ${renderExtraLightboxButtons(extraAttachments)}
                      </div>
                    ` : ""}
                    ${deleteMode ? `
                      <div class="gallery-delete-topbar">
                        <div class="gallery-delete-left">
                          <label class="gallery-delete-check">
                            <input type="checkbox" data-gallery-select="${postId}" ${isSelected ? "checked" : ""}>
                          </label>
                          <span class="gallery-delete-date">${escapeHtml(dateStr)}</span>
                        </div>
                        <div class="gallery-manage-actions">
                          <a class="gallery-manage-button gallery-edit-button" href="write.html?id=${encodeURIComponent(rawPostId)}&bo=${encodeURIComponent(post.boardId || board?.id || "board")}" aria-label="게시물 수정">수정</a>
                          <button type="button" class="gallery-manage-button gallery-delete-button" data-gallery-delete="${postId}" aria-label="게시물 삭제">삭제</button>
                        </div>
                      </div>
                    ` : ""}
                    <button
                      type="button"
                      class="gallery-media gallery-lightbox-trigger"
                      data-post-id="${postId}"
                      data-lightbox-image="${escapeHtml(cover.imageUrl)}"
                      aria-label="${title ? `${title} 원본 이미지 보기` : "원본 이미지 보기"}"
                      ${deleteMode ? 'data-delete-mode="Y"' : ""}
                    >
                      <img src="${escapeHtml(cover.imageUrl)}" alt="${title}" loading="lazy" class="gallery-image">
                      <div class="gallery-overlay">
                        <span class="btn small">원본 보기</span>
                      </div>
                    </button>
                    ${sourceMarkup}
                  </div>
                  ${contentMarkup}
                `
              : `
                  <div class="gallery-media-wrap gallery-text-only-wrap">
                    ${deleteMode ? `
                      <div class="gallery-delete-topbar">
                        <div class="gallery-delete-left">
                          <label class="gallery-delete-check">
                            <input type="checkbox" data-gallery-select="${postId}" ${isSelected ? "checked" : ""}>
                          </label>
                          <span class="gallery-delete-date">${escapeHtml(dateStr)}</span>
                        </div>
                        <div class="gallery-manage-actions">
                          <a class="gallery-manage-button gallery-edit-button" href="write.html?id=${encodeURIComponent(rawPostId)}&bo=${encodeURIComponent(post.boardId || board?.id || "board")}" aria-label="게시물 수정">수정</a>
                          <button type="button" class="gallery-manage-button gallery-delete-button" data-gallery-delete="${postId}" aria-label="게시물 삭제">삭제</button>
                        </div>
                      </div>
                    ` : ""}
                    ${contentText
                      ? `<div class="gallery-text-card">${escapeHtml(contentText)}</div>`
                      : `<div class="gallery-placeholder">내용 없음</div>`}
                    ${extraAttachments.length || sourceMarkup ? `
                      <div class="gallery-text-footer">
                        ${extraAttachments.length ? renderExtraLightboxButtons(extraAttachments) : ""}
                        ${sourceMarkup}
                      </div>
                    ` : ""}
                  </div>
                `} 
          </article>
        `;
      }).join("")}
    </div>
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

function getHttpUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function getGalleryContentText(post = {}) {
  const contentText = String(post.contentText || "").trim();
  if (contentText) return contentText;

  const html = String(post.commentHtml || post.contentHtml || "");
  if (!html) return "";

  const div = document.createElement("div");
  div.innerHTML = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n");
  return String(div.textContent || "")
    .replace(/\u00a0/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function renderExtraLightboxButtons(attachments) {
  if (!attachments.length) return "";

  return `
    <span class="gallery-extra-floating" aria-label="추가 이미지 ${attachments.length}개">
      ${attachments.map((attachment, index) => {
        const url = escapeHtml(attachment.url || "");
        const label = escapeHtml(attachment.name || `추가 이미지 ${index + 1}`);
        const isVideo = String(attachment?.mode || "").toLowerCase() === "video" || Boolean(attachment?.embedHtml);
        return `
          <button
            type="button"
            class="gallery-extra-floating-button${isVideo ? " gallery-extra-video-button" : ""}"
            data-lightbox-image="${url}"
            aria-label="${label} 원본 보기"
            title="추가 이미지 ${index + 1}"
          >
            <span class="gallery-extra-plus-icon" aria-hidden="true">◆</span>
          </button>
        `;
      }).join("")}
    </span>
  `;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}
