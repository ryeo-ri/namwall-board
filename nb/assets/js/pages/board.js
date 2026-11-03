// 게시판 — 스킨별 목록 (BOARD / GUESTBOOK / GALLERY / THREAD / LOG / SCRIPT / PROFILE)
import { runQuery, naruErrorMessage } from "../core/naru-client.js";
import { renderHeader, getBoardById, applyBoardWidth, escapeHtml, peekCachedBoards } from "../core/site.js";
import { normalizeSkinType, renderBoardList, renderGuestbook, bindGuestbook } from "../shared/skins.js";
import { renderGalleryList, bindGallery } from "../skins/gallery.js";
import { renderThreadList } from "../skins/thread.js";
import { renderLogFeed, bindLogFeed } from "../skins/log.js";

const DEFAULT_PAGE_SIZE = 20;
const LOG_PAGE_SIZE = 10;

// LOG 스킨 관리자 모드 — 켜면 각 글에 수정·삭제 버튼 표시 (원본 ADMIN 토글)
let logAdminMode = false;

async function init() {
  const params = new URLSearchParams(location.search);
  const boardId = params.get("bo") || "";
  const listEl = document.getElementById("boardContent");
  const titleEl = document.getElementById("boardTitle");
  const descriptionEl = document.getElementById("boardDescription");
  const writeBtn = document.getElementById("writeBtn");

  // 캐시된 게시판 설정이 있으면 목록 쿼리를 헤더 렌더(boot)와 병렬로 미리 던진다
  const cachedBoard = getBoardById(peekCachedBoards(), boardId);
  const prefetch = cachedBoard ? {
    skinType: normalizeSkinType(cachedBoard),
    promise: listQuery(cachedBoard, normalizeSkinType(cachedBoard), 0).catch(() => null)
  } : null;

  const boot = await renderHeader();
  const board = getBoardById(boot.boards, boardId);
  if (!board) {
    // 비공개 게시판은 boot 목록에 없으므로 비관리자에게는 '없음'으로 보인다.
    if (listEl) listEl.innerHTML = '<div class="notice">게시판을 찾을 수 없습니다.</div>';
    return;
  }

  const skinType = normalizeSkinType(board);
  applyBoardWidth(board, skinType);
  if (titleEl) titleEl.textContent = board.title || board.id;
  if (descriptionEl) descriptionEl.textContent = board.description || "";
  document.title = `${board.title || board.id}`;

  const canWrite = boot.owner || (board.memberWrite && boot.me);
  if (writeBtn && canWrite && skinType !== "GUESTBOOK") {
    writeBtn.href = `write.html?bo=${encodeURIComponent(board.id)}`;
    writeBtn.hidden = false;
    writeBtn.classList.remove("hidden");
  }

  // LOG: 관리자에게 ADMIN 토글 버튼 — 켜면 수정·삭제 버튼이 나타난다
  if (skinType === "LOG" && boot.owner) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "btn";
    toggle.id = "logAdminToggleBtn";
    toggle.textContent = "ADMIN";
    toggle.addEventListener("click", async () => {
      logAdminMode = !logAdminMode;
      toggle.textContent = logAdminMode ? "관리자종료" : "ADMIN";
      toggle.classList.toggle("primary", logAdminMode);
      await renderList(board, skinType, listEl, boot);
    });
    writeBtn?.parentElement?.prepend(toggle);
  }

  // 미리 던진 쿼리는 스킨이 캐시와 같을 때만 사용 (게시판 설정이 바뀐 경우 대비)
  await renderList(board, skinType, listEl, boot, 0, [],
    prefetch && prefetch.skinType === skinType ? prefetch.promise : null);
}

function pageSizeFor(board, skinType) {
  if (board.pageSize > 0) return Math.min(board.pageSize, 50);
  return skinType === "LOG" ? LOG_PAGE_SIZE : DEFAULT_PAGE_SIZE;
}

// 스킨에 맞는 목록 쿼리 — 첫 화면 병렬 프리페치와 renderList가 같은 인자를 쓰도록 공용화
function listQuery(board, skinType, before) {
  if (skinType === "GUESTBOOK") {
    return runQuery("board:guestbook", {
      board: board.id, size: pageSizeFor(board, skinType), ...(before ? { before } : {})
    });
  }
  return runQuery("board:posts", {
    board: board.id,
    size: pageSizeFor(board, skinType),
    ...(skinType === "LOG" ? { withBody: true } : {}),
    ...(before ? { before } : {})
  });
}

async function renderList(board, skinType, listEl, boot, before = 0, accumulated = [], prefetched = null) {
  if (!listEl) return;
  try {
    if (skinType === "GUESTBOOK") {
      const { entries, more } = (prefetched ? await prefetched : null)
        || await listQuery(board, skinType, before);
      const all = [...accumulated, ...entries];
      listEl.innerHTML = renderGuestbook(all, board, boot);
      bindGuestbook(listEl, board, boot, () => renderList(board, skinType, listEl, boot));
      if (more && all.length) appendMore(listEl, () => renderList(board, skinType, listEl, boot, all[all.length - 1].id, all));
      return;
    }

    const { posts, more } = (prefetched ? await prefetched : null)
      || await listQuery(board, skinType, before);
    const all = [...accumulated, ...posts];
    const reload = () => renderList(board, skinType, listEl, boot);

    if (skinType === "LOG") {
      // 관리자는 ADMIN 토글이 켜졌을 때만 수정·삭제 노출, 일반 작성자는 자기 글에 항상 노출
      const showManage = boot.owner ? logAdminMode : true;
      listEl.innerHTML = renderLogFeed(all, board, { showManage });
      bindLogFeed(listEl, board, all, reload, { showManage });
    } else if (skinType === "GALLERY") {
      listEl.innerHTML = renderGalleryList(all, board);
      bindGallery(listEl, board);
    } else if (skinType === "THREAD") {
      listEl.innerHTML = renderThreadList(all, board);
    } else if (skinType === "SCRIPT") {
      const { renderScriptList } = await import("../skins/script.js");
      listEl.innerHTML = renderScriptList(all, board);
    } else if (skinType === "PROFILE") {
      const { renderProfileList } = await import("../skins/profile.js");
      listEl.innerHTML = renderProfileList(all, board);
    } else {
      listEl.innerHTML = renderBoardList(all, board);
    }
    if (more && all.length) appendMore(listEl, () => renderList(board, skinType, listEl, boot, all[all.length - 1].id, all));
  } catch (error) {
    listEl.innerHTML = `<div class="notice">${escapeHtml(naruErrorMessage(error, "목록을 불러오지 못했습니다."))}</div>`;
  }
}

function appendMore(listEl, onMore) {
  const wrap = document.createElement("div");
  wrap.className = "pagination";
  wrap.innerHTML = '<div class="pagination-list"><button type="button" class="pagination-btn board-more">더 보기 <span class="pagination-arrow">↓</span></button></div>';
  wrap.querySelector("button").addEventListener("click", onMore);
  listEl.appendChild(wrap);
}

init();
