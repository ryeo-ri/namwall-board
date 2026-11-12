// NAMWALL Edition Copyright (c) 2026 NAMWALL — MPL-2.0 (https://mozilla.org/MPL/2.0/)
// 게시판 — 스킨별 목록 (BOARD / GUESTBOOK / GALLERY / THREAD / LOG / SCRIPT / PROFILE / BOOKMARK)
import { runQuery, runMutate, naruErrorMessage } from "../core/naru-client.js";
import { renderHeader, getBoardById, applyBoardWidth, escapeHtml, peekCachedBoards, normalizeSkinType } from "../core/site.js";
import { renderBoardList, renderGuestbook, bindGuestbook } from "../shared/skins.js";
import { renderGalleryList, bindGallery } from "../skins/gallery.js";
import { renderThreadList } from "../skins/thread.js";
import { renderLogFeed, bindLogFeed } from "../skins/log.js";

const DEFAULT_PAGE_SIZE = 10;
const PAGER_MAX_VISIBLE = 10; // 페이지 번호는 최대 10개 (원본 Firebase판과 같음)
const BOOKMARK_BATCH = 50; // 배너는 서버 한 번 상한(50)씩 끝까지 받아 전부 보여 준다
const BOOKMARK_MAX_PAGES = 20;

// 관리자 ADMIN 토글을 쓰는 스킨 — 켜면 글마다 수정·삭제와 선택 체크박스, 상단에 선택삭제·전체삭제
const ADMIN_TOGGLE_SKINS = ["LOG", "GALLERY", "THREAD", "BOARD", "SCRIPT", "BOOKMARK"];
let adminMode = false;
let activeCategory = ""; // ?cat=
let currentPage = 1; // ?page=
let renderSeq = 0;
const pagers = []; // 목록 위·아래 페이지 번호

async function init() {
  const params = new URLSearchParams(location.search);
  const boardId = params.get("bo") || "";
  activeCategory = (params.get("cat") || "").trim();
  currentPage = readPageParam();
  // ?log=N (LOG) — 처음 열 때 그 로그가 있는 페이지를 연다
  const logNo = Math.floor(Number(params.get("log"))) || 0;
  const firstExtra = (skinType) => (skinType === "LOG" && logNo > 0 ? { logNo } : {});
  const listEl = document.getElementById("boardContent");
  const writeBtn = document.getElementById("writeBtn");

  // 캐시된 게시판 설정이 있으면 목록 쿼리를 헤더 렌더와 병렬로 미리 보낸다
  const cachedBoard = getBoardById(peekCachedBoards(), boardId);
  const cachedSkin = cachedBoard ? normalizeSkinType(cachedBoard) : "";
  const prefetch = cachedBoard ? {
    skinType: cachedSkin,
    category: activeCategory,
    size: pageSizeFor(cachedBoard),
    promise: listQuery(cachedBoard, cachedSkin, cachedSkin === "BOOKMARK" ? 1 : currentPage, firstExtra(cachedSkin)).catch(() => null)
  } : null;

  const boot = await renderHeader();
  const board = getBoardById(boot.boards, boardId);
  if (!board) {
    if (listEl) listEl.innerHTML = '<div class="notice">게시판을 찾을 수 없습니다.</div>';
    return;
  }

  const skinType = normalizeSkinType(board);
  if (skinType === "BOOKMARK") currentPage = 1; // 배너는 페이지 없이 전부
  applyBoardWidth(board);
  document.getElementById("boardTitle").textContent = board.title || board.id;
  document.getElementById("boardDescription").textContent = board.description || "";
  document.title = board.title || board.id;
  const refresh = () => renderList(board, skinType, listEl, boot);
  bindPostDelete(listEl, refresh);

  // 페이지 이동 — 주소에 ?page=를 남겨 뒤로 가기·새로고침에도 같은 페이지
  const goToPage = async (page) => {
    if (!Number.isFinite(page) || page < 1 || page === currentPage) return;
    currentPage = page;
    history.pushState(null, "", pageUrl(page, { dropLog: true }));
    await refresh();
    window.scrollTo(0, 0);
  };
  window.addEventListener("popstate", () => {
    currentPage = readPageParam();
    refresh();
  });

  // 분류 칩 (설정에 없는 ?cat=은 무시하고 전체를 보여준다)
  const categories = Array.isArray(board.options?.categories) ? board.options.categories : [];
  if (!categories.includes(activeCategory)) activeCategory = "";
  if (categories.length && listEl?.parentElement) {
    const chipLink = (label, cat) => {
      const href = `board.html?bo=${encodeURIComponent(board.id)}${cat ? `&cat=${encodeURIComponent(cat)}` : ""}`;
      return `<a class="tag${cat === activeCategory ? " is-active" : ""}" href="${href}">${escapeHtml(label)}</a>`;
    };
    const chips = document.createElement("div");
    chips.className = "board-category-chips";
    chips.innerHTML = [chipLink("전체", ""), ...categories.map((cat) => chipLink(cat, cat))].join("");
    listEl.parentElement.insertBefore(chips, listEl);
  }

  const canWrite = boot.owner || (board.memberWrite && boot.me);
  const isBookmark = skinType === "BOOKMARK";
  const adminLabel = isBookmark ? "배너관리" : "ADMIN";
  if (writeBtn && canWrite && skinType !== "GUESTBOOK") {
    if (isBookmark) writeBtn.textContent = "배너등록";
    writeBtn.href = `write.html?bo=${encodeURIComponent(board.id)}`;
    writeBtn.hidden = false;
    writeBtn.classList.remove("hidden");
  }

  if (ADMIN_TOGGLE_SKINS.includes(skinType) && boot.owner) {
    const makeButton = (tag, text) => {
      const el = document.createElement(tag);
      if (tag === "button") el.type = "button";
      el.className = "btn hidden";
      el.textContent = text;
      return el;
    };
    const toggle = makeButton("button", adminLabel);
    toggle.classList.remove("hidden");
    toggle.id = "logAdminToggleBtn";
    const selectDeleteBtn = makeButton("button", "선택삭제");
    const deleteAllBtn = makeButton("button", "전체삭제");
    const boardEditBtn = makeButton("a", "게시판수정");
    boardEditBtn.href = `admin.html?board=${encodeURIComponent(board.id)}#boards`;

    toggle.addEventListener("click", async () => {
      adminMode = !adminMode;
      toggle.textContent = adminMode ? "관리자종료" : adminLabel;
      toggle.classList.toggle("primary", adminMode);
      [selectDeleteBtn, deleteAllBtn, boardEditBtn].forEach((el) => el.classList.toggle("hidden", !adminMode));
      await refresh();
    });

    selectDeleteBtn.addEventListener("click", async () => {
      const ids = [...listEl.querySelectorAll("[data-post-select]:checked")]
        .map((input) => Number(input.dataset.postSelect))
        .filter(Boolean);
      if (!ids.length) return window.alert("삭제할 글을 먼저 체크하세요.");
      if (!window.confirm(`선택한 ${ids.length}개 글을 삭제할까요? 되돌릴 수 없습니다.`)) return;
      selectDeleteBtn.disabled = true;
      try {
        for (let i = 0; i < ids.length; i += 50) {
          await runMutate("post:removeMany", { ids: ids.slice(i, i + 50) });
        }
      } catch (error) {
        window.alert(naruErrorMessage(error, "삭제에 실패했습니다."));
      } finally {
        selectDeleteBtn.disabled = false;
        await refresh();
      }
    });

    // 전체삭제 — 분류 칩으로 거른 상태면 그 분류의 글만
    deleteAllBtn.addEventListener("click", async () => {
      const name = board.title || board.id;
      const scope = activeCategory ? `"${name}" 게시판의 [${activeCategory}] 분류 글을` : `"${name}" 게시판의 글을`;
      if (!window.confirm(`${scope} 전부 삭제할까요? 되돌릴 수 없습니다.`)) return;
      if (!window.confirm(`정말로 ${activeCategory ? `[${activeCategory}] 분류의 ` : ""}모든 글과 그 댓글이 삭제됩니다. 계속할까요?`)) return;
      deleteAllBtn.disabled = true;
      deleteAllBtn.textContent = "삭제 중…";
      try {
        await runMutate("post:removeAll", { board: board.id, ...(activeCategory ? { category: activeCategory } : {}) });
      } catch (error) {
        window.alert(naruErrorMessage(error, "전체 삭제 중 오류가 났습니다. 남은 글을 확인하세요."));
      } finally {
        deleteAllBtn.disabled = false;
        deleteAllBtn.textContent = "전체삭제";
        await refresh();
      }
    });

    writeBtn?.parentElement?.prepend(toggle, selectDeleteBtn, deleteAllBtn, boardEditBtn);
  }

  // 북마크: 배너관리·배너등록 버튼은 배너 목록 아래
  const actionsEl = writeBtn?.parentElement;
  if (isBookmark && actionsEl && listEl) {
    actionsEl.classList.add("bookmark-board-actions");
    listEl.after(actionsEl);
  }

  // 페이지 번호 — 게시판 머리(제목 아래)와 목록 바로 아래 두 곳
  // 방명록은 아래에만, 배너(BOOKMARK)는 페이지 없이 전부 보여 준다
  if (listEl && !isBookmark) {
    if (skinType !== "GUESTBOOK") {
      const topPager = createPager(goToPage);
      (document.querySelector(".board-header") || listEl.parentElement).appendChild(topPager);
      pagers.push(topPager);
    }
    const bottomPager = createPager(goToPage);
    listEl.after(bottomPager);
    pagers.push(bottomPager);
  }

  // 미리 보낸 쿼리는 스킨·분류·페이지 크기가 캐시와 같을 때만 쓴다
  const prefetchUsable = prefetch && prefetch.skinType === skinType && prefetch.category === activeCategory
    && prefetch.size === pageSizeFor(board);
  await renderList(board, skinType, listEl, boot, {
    prefetched: prefetchUsable ? prefetch.promise : null,
    extra: firstExtra(skinType)
  });
}

function pageSizeFor(board) {
  if (normalizeSkinType(board) === "BOOKMARK") return BOOKMARK_BATCH;
  return board.pageSize > 0 ? Math.min(board.pageSize, 50) : DEFAULT_PAGE_SIZE;
}

function readPageParam() {
  const page = Math.floor(Number(new URLSearchParams(location.search).get("page")));
  return page > 0 ? page : 1;
}

// 현재 주소에서 page만 바꾼 주소 (1페이지는 뺀다). dropLog: 페이지를 옮기면 ?log= 스크롤 대상도 지운다
function pageUrl(page, { dropLog = false } = {}) {
  const url = new URL(location.href);
  if (page > 1) url.searchParams.set("page", String(page));
  else url.searchParams.delete("page");
  if (dropLog) url.searchParams.delete("log");
  return url.pathname + url.search + url.hash;
}

// extra: { logNo } 그 로그가 있는 페이지 / { skip } 응답 한도로 잘린 페이지의 나머지
function listQuery(board, skinType, page, extra = {}) {
  if (skinType === "GUESTBOOK") {
    return runQuery("board:guestbook", { board: board.id, size: pageSizeFor(board), page });
  }
  return runQuery("board:posts", {
    board: board.id,
    size: pageSizeFor(board),
    page,
    // LOG는 본문, GALLERY는 TEXT 칸과 추가 이미지까지 목록에서 그린다
    ...(skinType === "LOG" || skinType === "GALLERY" ? { withBody: true } : {}),
    ...(activeCategory ? { category: activeCategory } : {}),
    ...extra
  });
}

async function renderList(board, skinType, listEl, boot, { prefetched = null, extra = {} } = {}) {
  if (!listEl) return;
  // 방명록에 새 글을 쓰면 1페이지로 돌아가 바로 보이게
  const reload = async ({ firstPage = false } = {}) => {
    if (firstPage && currentPage !== 1) {
      currentPage = 1;
      history.pushState(null, "", pageUrl(1));
    }
    await renderList(board, skinType, listEl, boot);
  };
  // 페이지를 빠르게 연달아 누르면 마지막 요청만 그린다
  const seq = ++renderSeq;
  try {
    const result = (prefetched ? await prefetched : null) || await listQuery(board, skinType, currentPage, extra);
    let all = skinType === "GUESTBOOK" ? result.entries : result.posts;
    // 본문이 커서 응답 한도에 잘린 페이지(LOG·GALLERY)는 나머지를 이어 받는다
    let partial = Boolean(result.partial);
    while (partial && all.length) {
      const rest = await listQuery(board, skinType, result.page, { skip: all.length });
      if (rest.page !== result.page || !rest.posts.length) break;
      all = all.concat(rest.posts);
      partial = Boolean(rest.partial);
    }
    // 배너(BOOKMARK)는 남은 페이지까지 이어 받아 한 화면에 전부
    if (skinType === "BOOKMARK") {
      const last = Math.min(result.pages || 1, BOOKMARK_MAX_PAGES);
      for (let page = (result.page || 1) + 1; page <= last; page += 1) {
        const next = await listQuery(board, skinType, page);
        if (!next.posts?.length) break;
        all = all.concat(next.posts);
      }
    }
    if (seq !== renderSeq) return;
    // 서버가 페이지를 바로잡았으면(범위 밖·?log=) 주소도 맞춘다
    if (result.page && result.page !== currentPage) {
      currentPage = result.page;
      history.replaceState(null, "", pageUrl(currentPage));
    }

    if (skinType === "GUESTBOOK") {
      listEl.innerHTML = renderGuestbook(all, board, boot);
      bindGuestbook(listEl, board, reload);
    } else {
      // 관리자는 ADMIN 토글이 켜졌을 때만, 작성자는 자기 글에 항상 수정·삭제
      const options = { showManage: boot.owner ? adminMode : true, selectable: Boolean(boot.owner && adminMode) };
      if (skinType === "LOG") {
        listEl.innerHTML = renderLogFeed(all, board, options);
        bindLogFeed(listEl, board, all, options);
      } else if (skinType === "GALLERY") {
        listEl.innerHTML = renderGalleryList(all, board, options);
        bindGallery(listEl, board, options);
      } else if (skinType === "THREAD") {
        listEl.innerHTML = renderThreadList(all, board, options);
      } else if (skinType === "SCRIPT") {
        const { renderScriptList } = await import("../skins/script.js");
        // 카드 그리드라 관리 줄은 관리자 모드에서만 (작성자는 상세 화면에서 수정·삭제)
        listEl.innerHTML = renderScriptList(all, board, { showManage: options.selectable, selectable: options.selectable });
      } else if (skinType === "PROFILE") {
        const { renderProfileList } = await import("../skins/profile.js");
        listEl.innerHTML = renderProfileList(all, board);
      } else if (skinType === "BOOKMARK") {
        const { renderBookmarkList } = await import("../skins/bookmark.js");
        listEl.innerHTML = renderBookmarkList(all, board, options);
      } else {
        listEl.innerHTML = renderBoardList(all, board, options);
      }
    }
    renderPagers(currentPage, result.pages || 1);
  } catch (error) {
    if (seq !== renderSeq) return;
    listEl.innerHTML = `<div class="notice">${escapeHtml(naruErrorMessage(error, "목록을 불러오지 못했습니다."))}</div>`;
  }
}

// [data-del-post] 삭제 — 모든 스킨 공용, 다시 그려도 유지되도록 목록에 한 번만 위임
function bindPostDelete(listEl, reload) {
  listEl?.addEventListener("click", async (event) => {
    const button = event.target instanceof Element ? event.target.closest("[data-del-post]") : null;
    if (!button) return;
    if (!window.confirm("이 글을 삭제할까요? 댓글도 함께 삭제됩니다.")) return;
    button.disabled = true;
    try {
      await runMutate("post:remove", { id: Number(button.dataset.delPost) });
      await reload();
    } catch (error) {
      window.alert(naruErrorMessage(error, "삭제에 실패했습니다."));
      button.disabled = false;
    }
  });
}

// 페이지 번호 막대 — « ‹ 1 2 3 … › » (원본 Firebase판과 같은 모양·동작)
function createPager(onPage) {
  const el = document.createElement("nav");
  el.className = "pagination";
  el.setAttribute("aria-label", "페이지");
  el.hidden = true;
  el.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("[data-page]") : null;
    if (!button || button.disabled) return;
    onPage(Number(button.dataset.page));
  });
  return el;
}

function renderPagers(page, pages) {
  const html = pages > 1 ? pagerHtml(page, pages) : "";
  pagers.forEach((el) => {
    el.innerHTML = html;
    el.hidden = !html;
  });
}

function pagerHtml(page, pages) {
  const arrow = (target, label, symbol, disabled) =>
    `<button type="button" class="pagination-btn pagination-arrow" data-page="${target}" aria-label="${label}"${disabled ? " disabled" : ""}>${symbol}</button>`;
  const numbers = visiblePages(page, pages).map((n) => n === page
    ? `<button type="button" class="pagination-btn is-active" data-page="${n}" aria-current="page">${n}</button>`
    : `<button type="button" class="pagination-btn" data-page="${n}">${n}</button>`);
  return `
    <div class="pagination-list">
      ${arrow(1, "첫 페이지", "&laquo;", page <= 1)}
      ${arrow(page - 1, "이전 페이지", "&lsaquo;", page <= 1)}
      ${numbers.join("")}
      ${arrow(page + 1, "다음 페이지", "&rsaquo;", page >= pages)}
      ${arrow(pages, "마지막 페이지", "&raquo;", page >= pages)}
    </div>
  `;
}

// 현재 페이지를 가운데쯤 두고 최대 PAGER_MAX_VISIBLE개
function visiblePages(page, total) {
  if (total <= PAGER_MAX_VISIBLE) return Array.from({ length: total }, (_, index) => index + 1);
  let start = page - Math.floor(PAGER_MAX_VISIBLE / 2) + 1;
  let end = start + PAGER_MAX_VISIBLE - 1;
  if (start < 1) {
    start = 1;
    end = PAGER_MAX_VISIBLE;
  }
  if (end > total) {
    end = total;
    start = total - PAGER_MAX_VISIBLE + 1;
  }
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

init();
