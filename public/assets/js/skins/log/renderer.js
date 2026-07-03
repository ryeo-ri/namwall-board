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

  setTimeout(() => {
    Promise.all(posts.map((post) => {
      const container = document.getElementById(`comments-${post.id}`);
      if (!container) return null;
      return loadComments(post.id, container, {
        boardId: board?.id || "",
        commentScope: board?.commentScope || "all",
        manageComments: deleteMode
      });
    })).catch((error) => console.warn("Failed to load some log comments:", error));
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
  const commentWithLinks = enhanceLogCommentLinks(sanitizedComment, board.id);
  const tagChips = tags.length
    ? `<div class="log-tags log-tags-chips">${tags.map((tag) => `<a href="/search.html?tag=${encodeURIComponent(tag)}" class="tag">${escapeHtml(tag)}</a>`).join("")}</div>`
    : "";

  const title = escapeHtml(deriveLogTitle(post, commentHtml, logNumber, dateStr));
  const commentsContainerId = `comments-${post.id}`;
  const isSelected = selectedPostIds.has(post.id);
  const boardUrl = `/view.html?id=${encodeURIComponent(post.id)}&bo=${encodeURIComponent(board.id)}`;
  const hideCover = post.isSecret && !isAdmin && !unlockedSecretPostIds.has(post.id);
  const hasMedia = Boolean(hideCover || (cover.mode === "video" && cover.embedHtml) || cover.imageUrl);
  const bodyPlain = String(sanitizedComment || "").replace(/<[^>]*>/g, "").replace(/ /g, " ").trim();
  const hasBody = bodyPlain.length > 0;
  const authorName = String(post.authorName || "").trim();
  const metaHtml = renderLogMeta(logNumber, board.id);
  const commentsHtml = `<div id="${commentsContainerId}" class="comments-section log-comments"></div>`;
  // Render the post body as the first comment-style entry inside the comment area.
  const bodyCommentHtml = hasBody ? `
          <div class="comments-section log-comments log-body-comment-wrap">
            <article class="comment-item log-body-comment">
              <div class="comment-header">
                <div class="comment-meta-left"><span class="comment-author">${escapeHtml(authorName || "익명")}</span></div>
                <div class="comment-meta-right"><span class="muted small">${escapeHtml(dateStr)}</span></div>
              </div>
              <div class="comment-content">${commentWithLinks}</div>
            </article>
          </div>
  ` : "";
  const contentBits = `
          ${layout.commentPosition === "bottom" || !hasMedia ? tagChips : ""}

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
        ${bodyCommentHtml}
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
            ${bodyCommentHtml}
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

function renderLogMeta(logNumber, boardId) {
  if (!logNumber) return "";
  return `<a href="/board.html?bo=${encodeURIComponent(boardId)}&log=${encodeURIComponent(String(logNumber))}" class="log-number">${escapeHtml(String(logNumber))}</a>`;
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

function enhanceLogCommentLinks(html = "", boardId = "") {
  if (typeof document === "undefined" || !html) return html;

  const root = document.createElement("div");
  root.innerHTML = html;
  const textNodes = [];
  collectTextNodes(root, textNodes);
  textNodes.forEach((node) => replaceLogTextNode(node, boardId));
  return root.innerHTML;
}

function collectTextNodes(node, result = []) {
  Array.from(node.childNodes || []).forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      if (shouldEnhanceTextNode(child)) result.push(child);
      return;
    }
    if (child.nodeType === Node.ELEMENT_NODE) {
      collectTextNodes(child, result);
    }
  });
  return result;
}

function shouldEnhanceTextNode(node) {
  let parent = node.parentElement;
  while (parent) {
    const tagName = parent.tagName?.toLowerCase();
    if (["a", "code", "pre"].includes(tagName)) return false;
    parent = parent.parentElement;
  }
  return true;
}

function replaceLogTextNode(node, boardId = "") {
  const text = node.nodeValue || "";
  const tokenPattern = /\[([^\]\r\n]{1,80})\](https?:\/\/[^\s<>"']+)|#(\d+)/g;
  if (!tokenPattern.test(text)) return;

  tokenPattern.lastIndex = 0;
  const fragment = document.createDocumentFragment();
  let lastIndex = 0;
  let match;

  while ((match = tokenPattern.exec(text))) {
    const [matchedText, label, rawUrl, logNo] = match;
    if (match.index > lastIndex) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }

    if (rawUrl) {
      fragment.appendChild(createNamedLogLink(label, rawUrl, matchedText));
    } else if (logNo) {
      fragment.appendChild(createLogNumberLink(logNo, boardId));
    }
    lastIndex = match.index + matchedText.length;
  }

  if (lastIndex < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
  }

  node.replaceWith(fragment);
}

function createNamedLogLink(label = "", rawUrl = "", fallbackText = "") {
  const safeUrl = normalizeHttpUrl(rawUrl);
  if (!safeUrl) return document.createTextNode(fallbackText);

  const link = document.createElement("a");
  link.href = safeUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.className = "log-named-link";

  const strong = document.createElement("strong");
  strong.textContent = label;
  link.appendChild(strong);
  return link;
}

function createLogNumberLink(logNo = "", boardId = "") {
  const link = document.createElement("a");
  link.href = `/board.html?bo=${encodeURIComponent(boardId)}&log=${encodeURIComponent(logNo)}`;
  link.className = "log-tag";
  link.textContent = String(logNo);
  return link;
}

function normalizeHttpUrl(value = "") {
  try {
    const url = new URL(String(value || "").trim());
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch (_error) {
    return "";
  }
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
