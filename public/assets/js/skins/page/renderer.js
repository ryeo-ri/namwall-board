import { getPostSkinData } from "../registry.js";

export function renderPageList(posts, board = {}, options = {}) {
  const deleteMode = Boolean(options.deleteMode);
  const selectedPostIds = new Set(options.selectedPostIds || []);

  if (!Array.isArray(posts) || !posts.length) {
    return '<div class="notice">페이지가 없습니다.</div>';
  }

  return `
    <div class="board-list board-line-list page-list${deleteMode ? " is-delete-mode" : ""}">
      ${posts.map((post) => {
        const title = escapeHtml(post.title || getPostSkinData(post).page?.title || "(제목 없음)");
        const dateStr = toDate(post.createdAt).toLocaleDateString("ko-KR");
        const boardUrl = `/view.html?id=${encodeURIComponent(post.id)}&bo=${encodeURIComponent(post.boardId || board?.id || "page")}`;
        const postId = String(post.id || "");
        const isSelected = selectedPostIds.has(postId);

        return `
          <article class="search-item board-line-item page-line-item${deleteMode ? " is-delete-mode" : ""}${isSelected ? " is-delete-selected" : ""}" data-post-id="${escapeHtml(postId)}">
            ${deleteMode ? `
              <label class="board-line-select" aria-label="페이지 선택">
                <input type="checkbox" data-board-select="${escapeHtml(postId)}" ${isSelected ? "checked" : ""}>
              </label>
            ` : ""}
            <a href="${boardUrl}" class="board-line-title">${title}</a>
            <span class="board-line-date">${escapeHtml(dateStr)}</span>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

export function renderPageView(post = {}) {
  const page = normalizePageData(post);
  if (page.mode === "url") {
    if (!isSafeHttpUrl(page.iframeUrl)) {
      return {
        imageHtml: "",
        contentHtml: '<div class="notice">표시할 외부 iframe URL이 없습니다.</div>',
        sourceText: ""
      };
    }
    return {
      imageHtml: "",
      contentHtml: renderFrame({
        src: page.iframeUrl,
        title: page.title || post.title || "PAGE",
        height: page.height
      }),
      sourceText: ""
    };
  }

  if (!page.html) {
    return {
      imageHtml: "",
      contentHtml: '<div class="notice">표시할 HTML 소스가 없습니다.</div>',
      sourceText: ""
    };
  }

  return {
    imageHtml: "",
    contentHtml: renderInlineHtml(page.html),
    sourceText: ""
  };
}

function renderInlineHtml(html = "") {
  return `<div class="page-inline-html" data-page-run-scripts="true">${html}</div>`;
}

function renderFrame({ src = "", srcdoc = "", title = "PAGE", height = 720 } = {}) {
  const safeHeight = Math.max(120, Math.min(Number(height) || 720, 5000));
  const srcAttr = src ? ` src="${escapeHtml(src)}"` : "";
  const srcdocAttr = srcdoc ? ` srcdoc="${escapeHtml(srcdoc)}"` : "";
  return `
    <div class="page-frame-wrap" style="--page-frame-height:${safeHeight}px">
      <iframe
        class="page-frame"
        title="${escapeHtml(title)}"
        sandbox="allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-scripts"
        referrerpolicy="no-referrer-when-downgrade"
        loading="lazy"
        ${srcAttr}${srcdocAttr}
      ></iframe>
    </div>
  `;
}

function normalizePageData(post = {}) {
  const page = getPostSkinData(post).page || {};
  return {
    mode: page.mode === "url" ? "url" : "srcdoc",
    title: String(page.title || post.title || "").trim(),
    html: String(page.html || post.contentHtml || post.commentHtml || post.contentText || "").trim(),
    iframeUrl: String(page.iframeUrl || "").trim(),
    height: Number(page.height) || 720
  };
}

function isSafeHttpUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_error) {
    return false;
  }
}

function toDate(createdAt) {
  const value = createdAt?.toDate ? createdAt.toDate() : new Date(createdAt);
  return Number.isNaN(value.getTime()) ? new Date(0) : value;
}

function escapeHtml(text) {
  if (typeof document === "undefined") {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  const div = document.createElement("div");
  div.textContent = String(text || "");
  return div.innerHTML;
}
