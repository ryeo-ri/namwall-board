import { db } from "../core/firebase.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuthSnapshot } from "../core/state.js";
import { isAdminOnlyBoard, renderAdminOnlyBoardNotice } from "../shared/board-access.js";
import { formatResponsiveWidth, getSiteTitle, loadSiteMainSettings } from "../shared/boards-render.js";
import { getBoardSkinOption, getSkin, resolveBoardSkinType } from "../skins/registry.js";
import { navigatePublic } from "../core/spa-navigation.js";

let params = new URLSearchParams();
let boardId = "page";
let contentEl = null;
let currentSiteTitle = getSiteTitle();

async function loadCurrentSiteTitle() {
  try {
    currentSiteTitle = getSiteTitle(await loadSiteMainSettings());
  } catch (error) {
    console.warn("Failed to load site title:", error);
    currentSiteTitle = getSiteTitle();
  }
}

function setDocumentTitle(title) {
  document.title = `${title} - ${currentSiteTitle}`;
}

function applyPageWidth(board = {}) {
  const mainEl = document.querySelector("body.site-page main.container");
  if (!mainEl) return;
  const width = formatResponsiveWidth(getBoardSkinOption(board, "boardWidth", 900));
  if (width) {
    mainEl.style.setProperty("--board-page-w", width);
  } else {
    mainEl.style.removeProperty("--board-page-w");
  }
  mainEl.style.setProperty("--board-page-extra-w", "0px");
}

function renderNotice(html) {
  if (contentEl) contentEl.innerHTML = html;
}

async function loadPage(context = {}) {
  await loadCurrentSiteTitle();
  if (isInactive(context)) return;

  try {
    const boardSnap = await getDoc(doc(db, "boards", boardId));
    if (isInactive(context)) return;
    if (!boardSnap.exists()) {
      setDocumentTitle("페이지 없음");
      renderNotice('<div class="notice">페이지를 찾을 수 없습니다.</div>');
      return;
    }

    const board = { id: boardSnap.id, ...boardSnap.data() };
    if (resolveBoardSkinType(board) !== "PAGE") {
      navigatePublic(`board.html?bo=${encodeURIComponent(board.id)}`, { replace: true });
      return;
    }

    const auth = await getAuthSnapshot();
    if (isInactive(context)) return;
    if (isAdminOnlyBoard(board) && !auth?.isAdmin) {
      document.querySelector("main.container")?.classList.add("access-denied-shell");
      renderNotice(renderAdminOnlyBoardNotice(board.title || board.name || board.id));
      setDocumentTitle("관리자 전용 페이지입니다.");
      return;
    }

    applyPageWidth(board);
    setDocumentTitle(board.title || board.name || board.id);

    const pageData = board.pageData && typeof board.pageData === "object" ? board.pageData : null;
    if (!pageData?.html && !pageData?.iframeUrl) {
      const adminLink = auth?.isAdmin
        ? `<div class="actionRow" style="margin-top:8px;"><a class="btn primary" href="admin/boards.html?boardId=${encodeURIComponent(board.id)}">페이지 작성</a></div>`
        : "";
      renderNotice(`
        <div class="notice page-empty-notice">
          <div>연결된 PAGE가 아직 없습니다.</div>
          ${adminLink}
        </div>
      `);
      return;
    }

    const skin = await getSkin(board);
    if (isInactive(context)) return;
    const detail = await skin.renderDetail({
      id: `${board.id}-page`,
      title: board.title || board.name || board.id,
      boardId: board.id,
      skinType: "PAGE",
      skinData: {
        page: pageData
      }
    }, board, { secretUnlocked: true, isAdmin: Boolean(auth?.isAdmin) });
    if (isInactive(context)) return;

    renderNotice(detail.contentHtml || '<div class="notice">표시할 PAGE 내용이 없습니다.</div>');
  } catch (error) {
    console.error("Failed to load PAGE:", error);
    setDocumentTitle("오류");
    renderNotice('<div class="notice">PAGE를 불러오지 못했습니다.</div>');
  }
}

export async function initializePagePage(context = {}) {
  params = new URLSearchParams(window.location.search);
  boardId = params.get("bo") || "page";
  contentEl = document.getElementById("pageContent");
  currentSiteTitle = getSiteTitle();
  await loadPage(context);
}

export function cleanupPagePage() {
  contentEl = null;
}

function isInactive(context = {}) {
  return Boolean(context.signal?.aborted || (context.isActive && !context.isActive()));
}
