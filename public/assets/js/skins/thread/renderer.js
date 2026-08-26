import { getBoardSkinOption } from "../registry.js";
import { sanitizeHTML } from "../../shared/html-sanitizer-v2.js";
import { renderLockIcon } from "../../shared/secret-icon.js";

/* 타래(THREAD) 스킨 — 카드형 목록 + 좌측 썸네일 / 우측 내용 상세 */

export function renderThreadList(posts, board = {}, options = {}) {
  if (!Array.isArray(posts) || !posts.length) {
    return '<div class="notice">아직 등록된 타래가 없습니다.</div>';
  }

  const columns = clampNumber(getBoardSkinOption(board, "galleryColumns", 3), 1, 4, 3);
  return `
    <div class="thread-list" style="--thread-columns:${columns}" aria-label="타래 목록">
      ${posts.map((post) => renderThreadCard(post, board, options)).join("")}
    </div>
  `;
}

function renderThreadCard(post, board, options) {
  const deleteMode = Boolean(options.deleteMode);
  const selectedIds = new Set(options.selectedPostIds || []);
  const postId = String(post.id || "");
  const selected = selectedIds.has(postId);
  const title = escapeHtml(post.title || "(제목 없음)");
  const category = escapeHtml(board?.title || board?.name || "");
  const href = `view.html?id=${encodeURIComponent(postId)}&bo=${encodeURIComponent(post.boardId || board?.id || "thread")}`;
  const coverUrl = String(post.imageUrl || post.thumbUrl || "").trim();
  const isSecret = post.isSecret === true;

  return `
    <article class="card thread-card${deleteMode ? " is-delete-mode" : ""}${selected ? " is-delete-selected" : ""}" data-post-id="${escapeHtml(postId)}">
      <a class="thread-card-link" href="${href}">
        <div class="thread-card-cover">
          ${coverUrl
            ? `<img src="${escapeHtml(coverUrl)}" alt="${title}" loading="lazy">`
            : '<div class="thread-card-placeholder">THREAD</div>'}
        </div>
        <div class="thread-card-body">
          ${category ? `<span class="thread-card-category">${category}</span>` : ""}
          <strong class="thread-card-title">${isSecret ? renderLockIcon("thread-card-lock-icon") : ""}${title}</strong>
          <span class="btn thread-card-btn">보기</span>
        </div>
      </a>
      ${deleteMode ? `
        <label class="thread-delete-check" aria-label="타래 선택">
          <input type="checkbox" data-board-select="${escapeHtml(postId)}" ${selected ? "checked" : ""}>
        </label>
      ` : ""}
    </article>
  `;
}

export function renderThreadDetail(post = {}, board = {}, context = {}) {
  const secretUnlocked = context.secretUnlocked !== false;
  const title = escapeHtml(post.title || "(제목 없음)");
  const category = escapeHtml(board?.title || board?.name || "");
  const coverUrl = String(post.imageUrl || post.thumbUrl || "").trim();
  const commentPosition = String(getBoardSkinOption(board, "commentPosition", "bottom")).trim().toLowerCase();
  const showDetailThumb = String(getBoardSkinOption(board, "detailThumb", "show")).trim().toLowerCase() !== "hide";
  const listUrl = `board.html?bo=${encodeURIComponent(post.boardId || board?.id || "")}`;

  const sideHtml = `
    <div class="thread-view-side">
      ${category ? `<span class="thread-view-category">${category}</span>` : ""}
      <h2 class="thread-view-title">${title}</h2>
      ${coverUrl && secretUnlocked && showDetailThumb
        ? `<img class="thread-view-thumb" src="${escapeHtml(coverUrl)}" alt="${title}">`
        : ""}
    </div>
  `;

  const bodyInner = secretUnlocked
    ? `
      <div class="view-content-body thread-view-content">${sanitizeHTML(post.contentHtml || post.commentHtml || post.contentText || "", { allowIframes: true })}</div>
      ${renderThreadAttachments(post.extraAttachments)}
    `
    : `<div class="notice secret-cover-lock" aria-label="비밀글 잠금">${renderLockIcon("secret-cover-lock-icon")}</div>`;

  // 하단 댓글 모드: 카드 우하단 COMMENT ▼ 토글 (기본 접힘, 참고 사이트 형태)
  const commentToggleHtml = commentPosition !== "left"
    ? `
      <button type="button" class="thread-comment-toggle" data-thread-comment-toggle aria-expanded="false">
        COMMENT <span class="thread-comment-caret">▼</span>
      </button>
    `
    : "";

  return {
    imageHtml: "",
    contentHtml: `
      <section class="thread-view">
        ${sideHtml}
        <div class="thread-view-body">
          <div class="thread-view-scroll">${bodyInner}</div>
        </div>
        ${commentToggleHtml}
      </section>
      <div class="thread-view-actions">
        <a class="btn thread-list-btn" href="${escapeHtml(listUrl)}">목록</a>
      </div>
    `,
    sourceText: "",
    hideTags: false
  };
}

/* 댓글 위치 옵션 — left: 좌측 패널로 이동 / bottom: COMMENT ▼ 토글(기본 접힘) */
export function bindThreadDetail({ board } = {}) {
  const position = String(getBoardSkinOption(board, "commentPosition", "bottom")).trim().toLowerCase();
  const commentsWrap = document.getElementById("viewCommentsWrap");
  if (!commentsWrap) return;

  if (position === "left") {
    const side = document.querySelector(".thread-view-side");
    if (!side) return;
    commentsWrap.classList.add("thread-side-comments");
    side.appendChild(commentsWrap);
    return;
  }

  const toggle = document.querySelector("[data-thread-comment-toggle]");
  const scroll = document.querySelector(".thread-view-scroll");
  const viewComments = document.getElementById("viewComments");
  if (!toggle || !scroll || !viewComments) return;

  // 하단 모드: 댓글 목록은 본문 스크롤 영역 안에 이어 쌓이고,
  // 아래 래퍼에는 등록 폼만 남는다 (COMMENT ▼로 열고 닫음, 기본 접힘)
  commentsWrap.classList.add("hidden", "thread-bottom-comments");
  const inlineHost = document.createElement("div");
  inlineHost.className = "thread-inline-comments";
  scroll.appendChild(inlineHost);

  const relocateCommentList = () => {
    const list = viewComments.querySelector(".comments-list");
    if (list) inlineHost.replaceChildren(list);
    // 등록 폼은 항상 펼침 (자체 ▼ 토글 제거)
    viewComments.querySelector(".comment-form-head")?.classList.add("hidden");
    viewComments.querySelector("[data-comment-form-body]")?.classList.remove("hidden");
  };
  new MutationObserver(relocateCommentList).observe(viewComments, { childList: true });
  relocateCommentList();

  toggle.addEventListener("click", () => {
    const opened = !commentsWrap.classList.toggle("hidden");
    toggle.setAttribute("aria-expanded", opened ? "true" : "false");
    const caret = toggle.querySelector(".thread-comment-caret");
    if (caret) caret.textContent = opened ? "▲" : "▼";
    if (opened) commentsWrap.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function renderThreadAttachments(attachments) {
  if (!Array.isArray(attachments) || !attachments.length) return "";
  const images = attachments.filter((item) => item?.url && isImageAttachment(item));
  const videos = attachments.filter((item) => isVideoAttachment(item));
  if (!images.length && !videos.length) return "";

  return `
    <div class="thread-view-images">
      ${images.map((item) => {
        const url = escapeHtml(item.url);
        const name = escapeHtml(item.name || "첨부 이미지");
        return `
          <button
            type="button"
            class="thread-view-image"
            onclick="openLightbox('${escapeJsString(item.url)}')"
            aria-label="${name} 원본 보기"
          >
            <img src="${url}" alt="${name}" loading="lazy">
          </button>
        `;
      }).join("")}
      ${videos.map((item) => {
        const embed = String(item.embedHtml || item.thumbnailEmbedHtml || "").trim();
        return embed ? `<div class="thread-view-video">${sanitizeHTML(embed, { allowIframes: true })}</div>` : "";
      }).join("")}
    </div>
  `;
}

function isImageAttachment(attachment) {
  const mimeType = String(attachment?.mimeType || "").toLowerCase();
  if (mimeType.startsWith("image/")) return true;
  if (String(attachment?.mode || "").toLowerCase() === "video") return false;
  const url = String(attachment?.url || attachment?.path || "").toLowerCase();
  return /\.(png|jpe?g|gif|webp|svg|ico)(\?|#|$)/i.test(url);
}

function isVideoAttachment(attachment) {
  return String(attachment?.mode || "").toLowerCase() === "video"
    || Boolean(attachment?.embedHtml || attachment?.thumbnailEmbedHtml || attachment?.embedSrc || attachment?.thumbnailEmbedSrc);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
}

function escapeJsString(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, "&quot;");
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value || "");
  return div.innerHTML;
}
