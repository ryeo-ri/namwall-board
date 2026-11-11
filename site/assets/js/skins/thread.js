// NARU BOARD Copyright (c) 2026 NAMWALL — MPL-2.0 (https://mozilla.org/MPL/2.0/)
// THREAD(타래) 스킨 — 카드형 목록 + 좌(제목·썸네일)/우(본문 스크롤) 분할 상세
// 댓글 위치 옵션(options.commentPosition): bottom(기본, 본문 스크롤에 쌓임) / left(좌측 패널)
import { escapeHtml, formatDate, clampColumns } from "../core/site.js";
import { renderRichText } from "../shared/rich-text.js";
import { isVideoPost, renderVideoFrame, videoStillUrl } from "../shared/video.js";
import { renderManageBar } from "../shared/ui.js";

// 목록: 카드 그리드 (영상 글 표지는 유튜브 정지 화면)
export function renderThreadList(posts, board, opts = {}) {
  if (!posts.length) return '<div class="notice">아직 등록된 타래가 없습니다.</div>';
  const columns = clampColumns(board.options?.galleryColumns, 3, 4);

  return `
    <div class="thread-list" style="--thread-columns:${columns}" aria-label="타래 목록">
      ${posts.map((post) => {
        const url = `view.html?id=${encodeURIComponent(post.id)}&bo=${encodeURIComponent(board.id)}`;
        const title = escapeHtml(post.title || "(제목 없음)");
        const coverImage = isVideoPost(post) ? videoStillUrl(post.thumb) : post.thumb;
        const coverFallback = isVideoPost(post) ? "VIDEO" : "THREAD";
        const adminBar = renderManageBar(post, board, {
          selectable: opts.selectable === true,
          canManage: Boolean(opts.showManage && post.editable),
          label: formatDate(post.createdAt)
        });
        return `
          <article class="thread-card" data-post-id="${post.id}">
            ${adminBar}
            <a class="thread-card-link" href="${url}">
              <div class="thread-card-cover">
                ${post.isSecret
                  ? '<div class="thread-card-placeholder">🔒</div>'
                  : coverImage
                    ? `<img src="${escapeHtml(coverImage)}" alt="${title}" loading="lazy">`
                    : `<div class="thread-card-placeholder">${coverFallback}</div>`}
              </div>
              <div class="thread-card-body">
                <span class="thread-card-category">${escapeHtml(board.title || board.id)}</span>
                <strong class="thread-card-title">${post.isSecret ? "🔒 " : ""}${title}</strong>
              </div>
            </a>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

// 상세: 좌측 패널(제목·썸네일) + 우측 본문 스크롤 — view.js가 main 영역을 바꾼다
export function renderThreadDetail(post, board, { listUrl, toolsHtml }) {
  const title = escapeHtml(post.title || "(제목 없음)");
  const showThumb = board.options?.detailThumb !== false;
  const position = threadCommentPosition(board);

  const imagesHtml = Array.isArray(post.images) && post.images.length
    ? `<div class="thread-view-images">${post.images.map((url) => `<img src="${escapeHtml(url)}" alt="" loading="lazy">`).join("")}</div>`
    : "";

  return `
    <section class="thread-view">
      <div class="thread-view-side">
        <span class="thread-view-category">${escapeHtml(board.title || board.id)}</span>
        <h2 class="thread-view-title">${title}</h2>
        ${toolsHtml ? `<div class="thread-view-tools">${toolsHtml}</div>` : ""}
        ${showThumb && post.thumb
          ? (isVideoPost(post)
            ? renderVideoFrame(post.thumb, "thread-view-thumb")
            : `<img class="thread-view-thumb" src="${escapeHtml(post.thumb)}" alt="${title}">`)
          : ""}
      </div>
      <div class="thread-view-body">
        <div class="thread-view-scroll">
          <div class="view-body thread-view-content">${renderRichText(post.body, { boardId: post.boardId || board.id, allowIframes: true })}</div>
          ${imagesHtml}
        </div>
      </div>
    </section>
    <div class="thread-view-actions">
      ${position === "bottom" ? '<button type="button" class="btn thread-post-btn" data-thread-comment-toggle aria-expanded="false">글쓰기</button>' : ""}
      <a class="btn thread-list-btn" href="${escapeHtml(listUrl)}">목록</a>
    </div>
    <div class="thread-comments-wrap" id="threadCommentsWrap">
      <div id="threadComments"></div>
    </div>
  `;
}

// 댓글 배치 — bottom: 목록은 본문 스크롤 안, 아래는 등록 폼만(글쓰기로 토글) / left: 좌측 패널 아래
export function bindThreadDetail(root, board) {
  const position = threadCommentPosition(board);
  const wrap = root.querySelector("#threadCommentsWrap");
  const commentsEl = root.querySelector("#threadComments");
  if (!wrap || !commentsEl) return;

  if (position === "left") {
    const side = root.querySelector(".thread-view-side");
    if (side) {
      wrap.classList.add("thread-side-comments");
      side.appendChild(wrap);
    }
    return;
  }

  // 댓글을 다시 그릴 때마다 목록을 본문 스크롤 영역으로 옮긴다
  wrap.classList.add("hidden", "thread-bottom-comments");
  const scroll = root.querySelector(".thread-view-scroll");
  const inlineHost = document.createElement("div");
  inlineHost.className = "thread-inline-comments";
  scroll?.appendChild(inlineHost);

  const relocate = () => {
    const list = commentsEl.querySelector(".comments-list");
    if (list) inlineHost.replaceChildren(list);
  };
  new MutationObserver(relocate).observe(commentsEl, { childList: true });
  relocate();

  const toggle = root.querySelector("[data-thread-comment-toggle]");
  toggle?.addEventListener("click", () => {
    const opened = !wrap.classList.toggle("hidden");
    toggle.setAttribute("aria-expanded", opened ? "true" : "false");
    toggle.classList.toggle("is-active", opened);
    if (opened) {
      const formBody = wrap.querySelector(".comment-form-body");
      if (formBody?.classList.contains("hidden")) {
        wrap.querySelector("[data-comment-form-toggle]")?.click();
      }
      wrap.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
}

function threadCommentPosition(board) {
  return board.options?.commentPosition === "left" ? "left" : "bottom";
}
