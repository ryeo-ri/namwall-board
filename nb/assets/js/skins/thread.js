// THREAD(타래) 스킨 — 카드형 목록 + 좌(제목·썸네일)/우(본문 스크롤) 분할 상세
// 댓글 위치 옵션(options.commentPosition): bottom(기본, 본문 스크롤에 쌓임) / left(좌측 패널)
import { escapeHtml, formatDate } from "../core/site.js";
import { sanitizeHTML } from "../shared/sanitizer.js";

/* ── 목록: 테두리·라운드 없는 카드 그리드 ── */
export function renderThreadList(posts, board, opts = {}) {
  if (!posts.length) return '<div class="notice">아직 등록된 타래가 없습니다.</div>';
  const columns = clampColumns(board.options?.galleryColumns, 3);

  return `
    <div class="thread-list" style="--thread-columns:${columns}" aria-label="타래 목록">
      ${posts.map((post) => {
        const url = `view.html?id=${encodeURIComponent(post.id)}&bo=${encodeURIComponent(board.id)}`;
        const title = escapeHtml(post.title || "(제목 없음)");
        // 관리자 모드(ADMIN 토글): 카드 위에 체크박스·번호·날짜·수정·삭제 줄 — GALLERY와 같은 형식(투명 배경)
        const canManage = Boolean(opts.showManage && post.editable);
        const adminBar = (opts.selectable || canManage) ? `
          <div class="gallery-delete-topbar">
            <div class="gallery-delete-left">
              ${opts.selectable ? `<label class="gallery-delete-check"><input type="checkbox" data-post-select="${post.id}" aria-label="선택"></label>` : ""}
              <span class="gallery-manage-no">${post.id}</span>
              <span class="gallery-delete-date">${escapeHtml(formatDate(post.createdAt))}</span>
            </div>
            ${canManage ? `
              <div class="gallery-manage-actions">
                <a class="gallery-manage-button gallery-edit-button" href="write.html?id=${encodeURIComponent(post.id)}&bo=${encodeURIComponent(board.id)}" aria-label="게시물 수정">수정</a>
                <button type="button" class="gallery-manage-button gallery-delete-button" data-del-post="${post.id}" aria-label="게시물 삭제">삭제</button>
              </div>
            ` : ""}
          </div>
        ` : "";
        return `
          <article class="thread-card" data-post-id="${post.id}">
            ${adminBar}
            <a class="thread-card-link" href="${url}">
              <div class="thread-card-cover">
                ${post.isSecret
                  ? '<div class="thread-card-placeholder">🔒</div>'
                  : post.thumb
                    ? `<img src="${escapeHtml(post.thumb)}" alt="${title}" loading="lazy">`
                    : '<div class="thread-card-placeholder">THREAD</div>'}
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

/* ── 상세: 좌측 패널 + 우측 본문 스크롤 ──
   view.js가 main 영역을 이 마크업으로 바꾸고 bindThreadDetail을 호출한다. */
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
          ? `<img class="thread-view-thumb" src="${escapeHtml(post.thumb)}" alt="${title}">`
          : ""}
      </div>
      <div class="thread-view-body">
        <div class="thread-view-scroll">
          <div class="view-body thread-view-content">${sanitizeHTML(String(post.body || "").replace(/\n/g, "<br>"), { allowIframes: true })}</div>
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

/* 댓글 배치 — bottom: 목록은 본문 스크롤 안에 쌓이고 아래에는 등록 폼만(글쓰기로 토글)
              left: 댓글 전체를 좌측 패널 아래로 이동 */
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

  // bottom: 댓글 목록을 본문 스크롤 영역으로 옮겨 쌓는다 (댓글 다시 그릴 때마다)
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
      // 댓글 폼이 ▼ 토글로 접혀 있으면 바로 펼친 상태로 보여준다
      const formBody = wrap.querySelector(".comment-form-body");
      if (formBody?.classList.contains("hidden")) {
        wrap.querySelector("[data-comment-form-toggle]")?.click();
      }
      wrap.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
}

export function threadCommentPosition(board) {
  return board.options?.commentPosition === "left" ? "left" : "bottom";
}

function clampColumns(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.min(4, Math.round(number))) : fallback;
}
