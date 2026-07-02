import { sanitizeHTML } from "../../shared/html-sanitizer-v2.js";
import { loadComments } from "../../shared/comments.js";
import { getPostCoverMedia, normalizeVideoEmbedInput, renderPostVideoFrame } from "../../shared/post-cover.js";
import { renderLockIcon } from "../../shared/secret-icon.js";
import { getBoardSkinOption, getPostSkinData } from "../registry.js";

function normalizeLogCommentPosition(value) {
  return String(value || "default").trim().toLowerCase() === "bottom" ? "bottom" : "default";
}

function formatLogImageWidth(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "";
  if (n === 0) return "none";
  return `${Math.round(n)}px`;
}

function resolveLogLayout(board = {}) {
  return {
    imageWidth: formatLogImageWidth(getBoardSkinOption(board, "imageWidth", board?.logImageWidth)),
    commentPosition: normalizeLogCommentPosition(getBoardSkinOption(board, "commentPosition", board?.logCommentPosition || board?.logCommentLayout))
  };
}

export async function renderLogSkin(posts, board, options = {}) {
  const deleteMode = Boolean(options.deleteMode);
  const selectedPostIds = new Set(options.selectedPostIds || []);
  const isAdmin = Boolean(options.isAdmin);
  const unlockedSecretPostIds = new Set(options.unlockedSecretPostIds || []);
  const layout = resolveLogLayout(board);
  const hasMediaWidth = Boolean(layout.imageWidth && layout.imageWidth !== "none");

  if (posts.length === 0) {
    return '<div class="notice">아직 게시물이 없습니다.</div>';
  }

  const html = `
    <div class="log-feed${layout.commentPosition === "bottom" ? " is-comment-bottom" : ""}${layout.imageWidth === "none" ? " is-unlimited-image" : ""}${hasMediaWidth ? " has-log-media-width" : ""}"${hasMediaWidth ? ` style="--log-media-width:${layout.imageWidth};"` : ""}>
      ${posts.map((post) => renderLogEntry(post, board, { deleteMode, selectedPostIds, isAdmin, unlockedSecretPostIds, layout })).join("")}
    </div>
  `;

  setTimeout(async () => {
    for (const post of posts) {
      const container = document.getElementById(`comments-${post.id}`);
      if (container) await loadComments(post.id, container, {
        boardId: board?.id || "",
        commentScope: board?.commentScope || "all",
        manageComments: deleteMode
      });
    }
  }, 100);

  return html;
}

function renderLogEntry(post, board, options = {}) {
  const deleteMode = Boolean(options.deleteMode);
  const selectedPostIds = options.selectedPostIds || new Set();
  const isAdmin = Boolean(options.isAdmin);
  const unlockedSecretPostIds = options.unlockedSecretPostIds || new Set();
  const layout = options.layout || resolveLogLayout(board);
  const skinData = getPostSkinData(post);
  const cover = getPostCoverMedia(post);
  const extraAttachments = Array.isArray(post.extraAttachments)
    ? post.extraAttachments.filter((item) => item?.url || item?.embedHtml || item?.thumbnailEmbedHtml || item?.embedSrc || item?.thumbnailEmbedSrc)
    : [];
  const commentHtml = post.commentHtml || post.comment || post.contentHtml || post.contentText || "";
  const logNumber = skinData.logNo || post.logNo || post.logNumber || "";
  const tags = Array.isArray(post.tags) ? post.tags : [];
  const createdAt = post.createdAt?.toDate ? post.createdAt.toDate() : new Date(post.createdAt);
  const dateStr = Number.isNaN(createdAt.getTime())
    ? ""
    : `${createdAt.toLocaleDateString("ko-KR")} ${createdAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`;

  const sanitizedComment = sanitizeHTML(commentHtml, { allowIframes: true });
  const commentWithTags = sanitizedComment.replace(
    /#(\d+)/g,
    `<a href="/board.html?bo=${encodeURIComponent(board.id)}&log=$1" class="log-tag">#$1</a>`
  );
  const tagChips = tags.length
    ? `<div class="log-tags log-tags-chips">${tags.map((tag) => `<a href="/search.html?tag=${encodeURIComponent(tag)}" class="tag">${escapeHtml(tag)}</a>`).join("")}</div>`
    : "";

  const title = escapeHtml(deriveLogTitle(post, commentHtml, logNumber, dateStr));
  const commentsContainerId = `comments-${post.id}`;
  const isSelected = selectedPostIds.has(post.id);
  const boardUrl = `/view.html?id=${encodeURIComponent(post.id)}&bo=${encodeURIComponent(board.id)}`;
  const hideCover = post.isSecret && !isAdmin && !unlockedSecretPostIds.has(post.id);
  const hasMedia = Boolean(hideCover || (cover.mode === "video" && cover.embedHtml) || cover.imageUrl);
  const metaHtml = renderLogMeta(logNumber, dateStr, board.id);
  const commentsHtml = `<div id="${commentsContainerId}" class="comments-section log-comments"></div>`;
  const contentBits = `
          ${layout.commentPosition === "bottom" || !hasMedia ? tagChips : ""}
          <div class="log-body">${commentWithTags}</div>

          ${extraAttachments.length ? `
            <div class="log-inline-gallery">
              ${extraAttachments.map((attachment) => renderInlineAttachment(attachment)).join("")}
            </div>
          ` : ""}

          ${skinData.source ? `
            <footer class="log-footer">
              ${skinData.source ? `<div class="log-source">출처 ${escapeHtml(skinData.source)}</div>` : ""}
            </footer>
          ` : ""}
  `;

  const mediaHtml = hideCover ? `
            <div class="log-hero log-hero-secret">
          <div class="log-secret-lock">
                <div class="log-secret-lock-label" aria-label="비밀글">${renderLockIcon("log-secret-lock-icon")}</div>
                <div class="log-secret-unlock">
                  <input type="password" class="log-secret-input" placeholder="비밀번호">
                  <button type="button" class="btn log-secret-submit">확인</button>
                </div>
                <div class="log-secret-error hidden"></div>
              </div>
            </div>
          ` : cover.mode === "video" && cover.embedHtml ? `
            ${cover.embedHtml
              ? `
                <div class="log-hero log-hero-video">
                  ${renderPostVideoFrame(cover.embedHtml, "log-hero-video-frame")}
                </div>
              `
              : cover.previewUrl
                ? `
                  <button
                    type="button"
                    class="log-hero log-hero-video"
                    data-lightbox-image="${escapeHtml(cover.previewUrl)}"
                    onclick="openLightbox('${escapeJsString(cover.previewUrl)}')"
                    aria-label="${title} 보기"
                  >
                    <img src="${escapeHtml(cover.previewUrl)}" alt="${title}" loading="lazy" class="log-hero-image">
                    <span class="cover-video-badge">VIDEO</span>
                  </button>
                `
                : ""}
          ` : cover.imageUrl ? `
            ${renderHeroImage(cover.imageUrl, title)}
          ` : "";

  return `
    <article class="card log-post mt-sm${deleteMode ? " log-post-delete-mode" : ""}${isSelected ? " is-delete-selected" : ""}" data-post-id="${escapeHtml(post.id)}">
      ${(deleteMode || metaHtml) ? `
        <div class="log-top-meta">
          ${deleteMode ? `
            <label class="log-delete-check" aria-label="게시물 선택">
              <input type="checkbox" data-log-select="${escapeHtml(post.id)}" ${isSelected ? "checked" : ""}>
            </label>
          ` : ""}
          ${metaHtml}
          ${deleteMode ? `
            <div class="log-manage-actions">
              <a class="log-manage-button log-edit-button" href="/write.html?id=${encodeURIComponent(post.id)}&bo=${encodeURIComponent(post.boardId || board.id || "log")}" aria-label="게시물 수정">수정</a>
              <button type="button" class="log-manage-button log-delete-button" data-log-delete="${escapeHtml(post.id)}" aria-label="게시물 삭제">삭제</button>
            </div>
          ` : ""}
        </div>
      ` : ""}
      ${layout.commentPosition === "bottom" ? `
        <div class="log-post-stack">
          ${hasMedia ? `
            <div class="log-media-column">
              ${mediaHtml}
            </div>
          ` : ""}
          <div class="log-content-column log-content-column-full">
            ${contentBits}
          </div>
        </div>
        ${commentsHtml}
      ` : `
        <div class="log-post-content${layout.imageWidth === "none" ? " is-unlimited-image" : ""}">
          ${hasMedia ? `
            <div class="log-media-column">
              ${mediaHtml}
              ${tagChips}
            </div>
          ` : ""}
          <div class="log-content-column">
            ${!hasMedia ? tagChips : ""}
            ${contentBits}
            ${commentsHtml}
          </div>
        </div>
      `}
    </article>
  `;
}

function renderHeroImage(imageUrl, title) {
  const safeUrl = escapeHtml(imageUrl);
  return `
    <button
      type="button"
      class="log-hero"
      data-lightbox-image="${safeUrl}"
      onclick="openLightbox('${escapeJsString(imageUrl)}')"
      aria-label="${title} 원본 이미지 보기"
    >
      <img src="${safeUrl}" alt="${title}" loading="lazy" class="log-hero-image">
    </button>
  `;
}

function renderLogMeta(logNumber, dateStr, boardId) {
  const pieces = [];
  if (logNumber) {
    pieces.push(`<a href="/board.html?bo=${encodeURIComponent(boardId)}&log=${encodeURIComponent(String(logNumber))}" class="log-number">${escapeHtml(String(logNumber))}</a>`);
  }
  if (dateStr) {
    pieces.push(`<span class="log-date">${escapeHtml(dateStr)}</span>`);
  }
  return pieces.join("");
}

function renderInlineAttachment(attachment) {
  const url = attachment.url || "";
  const title = escapeHtml(attachment.name || "추가 이미지");
  const videoSource = attachment.embedHtml
    || attachment.thumbnailEmbedHtml
    || attachment.embedSrc
    || attachment.thumbnailEmbedSrc
    || "";
  const videoHtml = videoSource ? normalizeVideoEmbedInput(videoSource).html : "";
  const isVideo = String(attachment?.mode || "").toLowerCase() === "video" || Boolean(videoHtml);
  if (isVideo && videoHtml) {
    return `
      <div class="log-inline-video">
        ${renderPostVideoFrame(videoHtml)}
      </div>
    `;
  }
  return `
    <button
      type="button"
      class="log-inline-image"
      data-lightbox-image="${escapeHtml(url)}"
      onclick="openLightbox('${escapeJsString(url)}')"
      aria-label="${title} 원본 이미지 보기"
    >
      <img src="${escapeHtml(url)}" alt="${title}" loading="lazy">
    </button>
  `;
}

function deriveLogTitle(post, commentHtml, logNumber, dateStr) {
  return post.title || post.commentText || post.comment || post.contentText || `${logNumber || ""} ${dateStr || ""}`.trim();
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}

function escapeJsString(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
}
