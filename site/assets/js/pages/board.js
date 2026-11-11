// NARU BOARD Copyright (c) 2026 NAMWALL — MPL-2.0 (https://mozilla.org/MPL/2.0/)
// 게시판 — 스킨별 목록 (BOARD / GUESTBOOK / GALLERY / THREAD / LOG / SCRIPT / PROFILE / BOOKMARK)
import { runQuery, runMutate, naruErrorMessage } from "../core/naru-client.js";
import { renderHeader, getBoardById, applyBoardWidth, escapeHtml, peekCachedBoards, normalizeSkinType } from "../core/site.js";
import { renderBoardList, renderGuestbook, bindGuestbook } from "../shared/skins.js";
import { renderGalleryList, bindGallery } from "../skins/gallery.js";
import { renderThreadList } from "../skins/thread.js";
import { renderLogFeed, bindLogFeed } from "../skins/log.js";

const DEFAULT_PAGE_SIZE = 10;

// 관리자 ADMIN 토글을 쓰는 스킨 — 켜면 글마다 수정·삭제와 선택 체크박스, 상단에 선택삭제·전체삭제
const ADMIN_TOGGLE_SKINS = ["LOG", "GALLERY", "THREAD", "BOARD", "SCRIPT", "BOOKMARK"];
let adminMode = false;
let activeCategory = ""; // ?cat=

async function init() {
  const params = new URLSearchParams(location.search);
  const boardId = params.get("bo") || "";
  activeCategory = (params.get("cat") || "").trim();
  const listEl = document.getElementById("boardContent");
  const writeBtn = document.getElementById("writeBtn");

  // 캐시된 게시판 설정이 있으면 목록 쿼리를 헤더 렌더와 병렬로 미리 보낸다
  const cachedBoard = getBoardById(peekCachedBoards(), boardId);
  const prefetch = cachedBoard ? {
    skinType: normalizeSkinType(cachedBoard),
    category: activeCategory,
    promise: listQuery(cachedBoard, normalizeSkinType(cachedBoard), 0).catch(() => null)
  } : null;

  const boot = await renderHeader();
  const board = getBoardById(boot.boards, boardId);
  if (!board) {
    if (listEl) listEl.innerHTML = '<div class="notice">게시판을 찾을 수 없습니다.</div>';
    return;
  }

  const skinType = normalizeSkinType(board);
  applyBoardWidth(board);
  document.getElementById("boardTitle").textContent = board.title || board.id;
  document.getElementById("boardDescription").textContent = board.description || "";
  document.title = board.title || board.id;
  const refresh = () => renderList(board, skinType, listEl, boot);
  bindPostDelete(listEl, refresh);

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

  // 미리 보낸 쿼리는 스킨·분류가 캐시와 같을 때만 쓴다
  const prefetchUsable = prefetch && prefetch.skinType === skinType && prefetch.category === activeCategory;
  await renderList(board, skinType, listEl, boot, 0, [], prefetchUsable ? prefetch.promise : null);
}

function pageSizeFor(board) {
  return board.pageSize > 0 ? Math.min(board.pageSize, 50) : DEFAULT_PAGE_SIZE;
}

function listQuery(board, skinType, before) {
  if (skinType === "GUESTBOOK") {
    return runQuery("board:guestbook", {
      board: board.id, size: pageSizeFor(board), ...(before ? { before } : {})
    });
  }
  return runQuery("board:posts", {
    board: board.id,
    size: pageSizeFor(board),
    // LOG는 본문, GALLERY는 TEXT 칸과 추가 이미지까지 목록에서 그린다
    ...(skinType === "LOG" || skinType === "GALLERY" ? { withBody: true } : {}),
    ...(activeCategory ? { category: activeCategory } : {}),
    ...(before ? { before } : {})
  });
}

async function renderList(board, skinType, listEl, boot, before = 0, accumulated = [], prefetched = null) {
  if (!listEl) return;
  const reload = () => renderList(board, skinType, listEl, boot);
  try {
    const result = (prefetched ? await prefetched : null) || await listQuery(board, skinType, before);
    const all = [...accumulated, ...(skinType === "GUESTBOOK" ? result.entries : result.posts)];

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
    if (result.more && all.length) appendMore(listEl, () => renderList(board, skinType, listEl, boot, all[all.length - 1].id, all));
  } catch (error) {
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

function appendMore(listEl, onMore) {
  const wrap = document.createElement("div");
  wrap.className = "pagination";
  wrap.innerHTML = '<div class="pagination-list"><button type="button" class="pagination-btn board-more">더 보기 <span class="pagination-arrow">↓</span></button></div>';
  wrap.querySelector("button").addEventListener("click", onMore);
  listEl.appendChild(wrap);
}

init();
