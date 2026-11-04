// 게시판 — 스킨별 목록 (BOARD / GUESTBOOK / GALLERY / THREAD / LOG / SCRIPT / PROFILE)
import { runQuery, runMutate, naruErrorMessage } from "../core/naru-client.js";
import { renderHeader, getBoardById, applyBoardWidth, escapeHtml, peekCachedBoards } from "../core/site.js";
import { normalizeSkinType, renderBoardList, renderGuestbook, bindGuestbook } from "../shared/skins.js";
import { renderGalleryList, bindGallery } from "../skins/gallery.js";
import { renderThreadList } from "../skins/thread.js";
import { renderLogFeed, bindLogFeed } from "../skins/log.js";

// 페이지당 게시물 수 — 전 스킨 공통 기본 10 (게시판 설정 pageSize로 변경 가능)
const DEFAULT_PAGE_SIZE = 10;

// 목록 스킨 관리자 모드 — 켜면 각 글에 수정·삭제와 선택 체크박스 표시 (원본 ADMIN 토글)
// GUESTBOOK(항목별 D 버튼)·SCRIPT·PROFILE은 제외
const ADMIN_TOGGLE_SKINS = ["LOG", "GALLERY", "THREAD", "BOARD"];
let adminMode = false;
let activeCategory = ""; // 분류 칩으로 고른 분류 (URL ?cat=)

async function init() {
  const params = new URLSearchParams(location.search);
  const boardId = params.get("bo") || "";
  activeCategory = (params.get("cat") || "").trim();
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

  // 분류 칩: 게시판에 분류가 설정돼 있으면 목록 위에 표시 — 클릭하면 그 분류 글만 본다
  const categories = Array.isArray(board.options?.categories) ? board.options.categories : [];
  if (categories.length && listEl) {
    const chipLink = (label, cat) => {
      const href = `board.html?bo=${encodeURIComponent(board.id)}${cat ? `&cat=${encodeURIComponent(cat)}` : ""}`;
      return `<a class="tag${cat === activeCategory ? " is-active" : ""}" href="${href}">${escapeHtml(label)}</a>`;
    };
    const chips = document.createElement("div");
    chips.className = "board-category-chips";
    chips.innerHTML = [chipLink("전체", ""), ...categories.map((cat) => chipLink(cat, cat))].join("");
    listEl.parentElement?.insertBefore(chips, listEl);
  }

  const canWrite = boot.owner || (board.memberWrite && boot.me);
  if (writeBtn && canWrite && skinType !== "GUESTBOOK") {
    writeBtn.href = `write.html?bo=${encodeURIComponent(board.id)}`;
    writeBtn.hidden = false;
    writeBtn.classList.remove("hidden");
  }

  // 목록 스킨: 관리자에게 ADMIN 토글 버튼 — 켜면 글마다 수정·삭제와 선택 체크박스,
  // 상단에 선택삭제·전체삭제 버튼이 나타난다
  if (ADMIN_TOGGLE_SKINS.includes(skinType) && boot.owner) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "btn";
    toggle.id = "logAdminToggleBtn";
    toggle.textContent = "ADMIN";

    const selectDeleteBtn = document.createElement("button");
    selectDeleteBtn.type = "button";
    selectDeleteBtn.className = "btn hidden";
    selectDeleteBtn.textContent = "선택삭제";

    const deleteAllBtn = document.createElement("button");
    deleteAllBtn.type = "button";
    deleteAllBtn.className = "btn hidden";
    deleteAllBtn.textContent = "전체삭제";

    toggle.addEventListener("click", async () => {
      adminMode = !adminMode;
      toggle.textContent = adminMode ? "관리자종료" : "ADMIN";
      toggle.classList.toggle("primary", adminMode);
      selectDeleteBtn.classList.toggle("hidden", !adminMode);
      deleteAllBtn.classList.toggle("hidden", !adminMode);
      await renderList(board, skinType, listEl, boot);
    });

    // 선택삭제: 체크된 글만 지운다 (스킨별 체크박스 모두 수집)
    selectDeleteBtn.addEventListener("click", async () => {
      const ids = [...listEl.querySelectorAll(".log-select-check:checked, [data-gallery-select]:checked, [data-post-select]:checked")]
        .map((input) => Number(input.dataset.logSelect || input.dataset.gallerySelect || input.dataset.postSelect))
        .filter(Boolean);
      if (!ids.length) return window.alert("삭제할 글을 먼저 체크하세요.");
      if (!window.confirm(`선택한 ${ids.length}개 글을 삭제할까요? 되돌릴 수 없습니다.`)) return;
      selectDeleteBtn.disabled = true;
      try {
        for (const id of ids) await runMutate("post:remove", { id });
        await renderList(board, skinType, listEl, boot);
      } catch (error) {
        window.alert(naruErrorMessage(error, "삭제에 실패했습니다."));
        await renderList(board, skinType, listEl, boot);
      } finally {
        selectDeleteBtn.disabled = false;
      }
    });

    // 전체삭제: 이 게시판의 모든 글을 페이지 단위로 받아 하나씩 지운다 (일괄 삭제 API 없음)
    deleteAllBtn.addEventListener("click", async () => {
      if (!window.confirm(`"${board.title || board.id}" 게시판의 글을 전부 삭제할까요? 되돌릴 수 없습니다.`)) return;
      if (!window.confirm("정말로 모든 글과 그 댓글이 삭제됩니다. 계속할까요?")) return;
      deleteAllBtn.disabled = true;
      deleteAllBtn.textContent = "삭제 중…";
      try {
        for (;;) {
          const { posts } = await runQuery("board:posts", { board: board.id, size: 50 });
          if (!posts.length) break;
          for (const post of posts) await runMutate("post:remove", { id: post.id });
        }
      } catch (error) {
        window.alert(naruErrorMessage(error, "전체 삭제 중 오류가 났습니다. 남은 글을 확인하세요."));
      } finally {
        deleteAllBtn.disabled = false;
        deleteAllBtn.textContent = "전체삭제";
        await renderList(board, skinType, listEl, boot);
      }
    });

    writeBtn?.parentElement?.prepend(toggle, selectDeleteBtn, deleteAllBtn);
  }

  // 미리 던진 쿼리는 스킨이 캐시와 같을 때만 사용 (게시판 설정이 바뀐 경우 대비)
  await renderList(board, skinType, listEl, boot, 0, [],
    prefetch && prefetch.skinType === skinType ? prefetch.promise : null);
}

function pageSizeFor(board) {
  if (board.pageSize > 0) return Math.min(board.pageSize, 50);
  return DEFAULT_PAGE_SIZE;
}

// 스킨에 맞는 목록 쿼리 — 첫 화면 병렬 프리페치와 renderList가 같은 인자를 쓰도록 공용화
function listQuery(board, skinType, before) {
  if (skinType === "GUESTBOOK") {
    return runQuery("board:guestbook", {
      board: board.id, size: pageSizeFor(board), ...(before ? { before } : {})
    });
  }
  return runQuery("board:posts", {
    board: board.id,
    size: pageSizeFor(board),
    // LOG는 본문까지, GALLERY는 추가 이미지(attachments)까지 목록에서 그린다
    ...(skinType === "LOG" || skinType === "GALLERY" ? { withBody: true } : {}),
    ...(activeCategory ? { category: activeCategory } : {}),
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

    // 관리자는 ADMIN 토글이 켜졌을 때만 수정·삭제 노출, 일반 작성자는 자기 글에 항상 노출
    const showManage = boot.owner ? adminMode : true;
    const selectable = Boolean(boot.owner && adminMode); // 선택삭제 체크박스
    if (skinType === "LOG") {
      listEl.innerHTML = renderLogFeed(all, board, { showManage, selectable });
      bindLogFeed(listEl, board, all, reload, { showManage, selectable });
    } else if (skinType === "GALLERY") {
      listEl.innerHTML = renderGalleryList(all, board, { showManage, selectable });
      bindGallery(listEl, board, reload, { showManage, selectable });
    } else if (skinType === "THREAD") {
      listEl.innerHTML = renderThreadList(all, board, { showManage, selectable });
      bindPostDelete(listEl, reload);
    } else if (skinType === "SCRIPT") {
      const { renderScriptList } = await import("../skins/script.js");
      listEl.innerHTML = renderScriptList(all, board);
    } else if (skinType === "PROFILE") {
      const { renderProfileList } = await import("../skins/profile.js");
      listEl.innerHTML = renderProfileList(all, board);
    } else {
      listEl.innerHTML = renderBoardList(all, board, { showManage, selectable });
      bindPostDelete(listEl, reload);
    }
    if (more && all.length) appendMore(listEl, () => renderList(board, skinType, listEl, boot, all[all.length - 1].id, all));
  } catch (error) {
    listEl.innerHTML = `<div class="notice">${escapeHtml(naruErrorMessage(error, "목록을 불러오지 못했습니다."))}</div>`;
  }
}

// BOARD·THREAD 목록의 삭제 버튼 — LOG·GALLERY는 각 스킨의 bind가 처리한다
function bindPostDelete(listEl, reload) {
  listEl.querySelectorAll("[data-del-post]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!window.confirm("이 글을 삭제할까요? 댓글도 함께 삭제됩니다.")) return;
      try {
        await runMutate("post:remove", { id: Number(btn.dataset.delPost) });
        await reload();
      } catch (error) {
        window.alert(naruErrorMessage(error, "삭제에 실패했습니다."));
      }
    });
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
