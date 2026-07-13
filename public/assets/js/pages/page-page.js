import { db } from "../core/firebase.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuthSnapshot } from "../core/state.js";
import { isAdminOnlyBoard, renderAdminOnlyBoardNotice } from "../shared/board-access.js";
import { formatResponsiveWidth, getSiteTitle, loadSiteMainSettings } from "../shared/boards-render.js";
import { getBoardSkinOption, getSkin, resolveBoardSkinType } from "../skins/registry.js";

const params = new URLSearchParams(window.location.search);
const boardId = params.get("bo") || "page";
const contentEl = document.getElementById("pageContent");
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

async function activateInlinePageScripts(root = contentEl) {
  const scripts = Array.from(root?.querySelectorAll("[data-page-run-scripts] script:not([data-page-script-activated])") || []);
  for (const oldScript of scripts) {
    await replaceAndRunPageScript(oldScript);
  }
}

function replaceAndRunPageScript(oldScript) {
  return new Promise((resolve) => {
    const script = document.createElement("script");
    const rawSrc = String(oldScript.getAttribute("src") || "").trim();
    Array.from(oldScript.attributes).forEach((attr) => {
      script.setAttribute(attr.name, attr.value);
    });

    script.dataset.pageScriptActivated = "true";

    if (rawSrc) {
      script.src = normalizePageScriptSrc(rawSrc);
      script.async = false;
      script.defer = false;
      script.removeAttribute("async");
      script.removeAttribute("defer");
      script.addEventListener("load", () => resolve(), { once: true });
      script.addEventListener("error", () => {
        console.warn("Failed to load PAGE script:", script.src);
        resolve();
      }, { once: true });
    } else {
      script.textContent = oldScript.textContent || "";
    }

    oldScript.replaceWith(script);

    if (!rawSrc) {
      resolve();
    }
  });
}

function normalizePageScriptSrc(src) {
  const value = String(src || "").trim();
  if (window.location.protocol === "https:" && value.startsWith("http://")) {
    return `https://${value.slice(7)}`;
  }
  return value;
}

async function loadPage() {
  await loadCurrentSiteTitle();

  try {
    const boardSnap = await getDoc(doc(db, "boards", boardId));
    if (!boardSnap.exists()) {
      setDocumentTitle("페이지 없음");
      renderNotice('<div class="notice">페이지를 찾을 수 없습니다.</div>');
      return;
    }

    const board = { id: boardSnap.id, ...boardSnap.data() };
    if (resolveBoardSkinType(board) !== "PAGE") {
      location.replace(`board.html?bo=${encodeURIComponent(board.id)}`);
      return;
    }

    const auth = await getAuthSnapshot();
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
    const detail = await skin.renderDetail({
      id: `${board.id}-page`,
      title: board.title || board.name || board.id,
      boardId: board.id,
      skinType: "PAGE",
      skinData: {
        page: pageData
      }
    }, board, { secretUnlocked: true, isAdmin: Boolean(auth?.isAdmin) });

    renderNotice(detail.contentHtml || '<div class="notice">표시할 PAGE 내용이 없습니다.</div>');
    await activateInlinePageScripts();
  } catch (error) {
    console.error("Failed to load PAGE:", error);
    setDocumentTitle("오류");
    renderNotice('<div class="notice">PAGE를 불러오지 못했습니다.</div>');
  }
}

loadPage();
