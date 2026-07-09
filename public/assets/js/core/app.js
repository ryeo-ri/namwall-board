import { getAuthSnapshot, isGuestUnlocked } from "./state.js";
import { db } from "./firebase.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getSiteTitle, loadSiteMainSettings, readCachedSiteTitle, renderTopNav } from "../shared/boards-render.js";
import { applyDesignSettings, readCachedDesign, writeCachedDesign } from "../shared/design.js";

const HEADER_FONT_LINK_ID = "archiveHeaderFontLink";
const BOOTSTRAP_FLAG = "archive_bootstrapped_v1";
let appliedSiteTitleAsDocumentTitle = false;

// 첫 실행 게이트: 설정(첫 관리자)이 끝나기 전이면 공개 페이지 → /setup.html
// 안전 원칙: "읽기 성공 + 문서 없음"(확정적 미설정)일 때만 이동한다.
// 연결/규칙 오류 등 불확정 상태에서는 기존 동작을 유지해 운영 중 사이트를 깨지 않는다.
async function ensureBootstrapped() {
  try {
    if (localStorage.getItem(BOOTSTRAP_FLAG) === "1") return true;
  } catch (_error) {
    // localStorage 불가 시 아래에서 서버 확인
  }
  try {
    const snap = await getDoc(doc(db, "site_settings", "bootstrap"));
    if (snap.exists()) {
      try { localStorage.setItem(BOOTSTRAP_FLAG, "1"); } catch (_error) { /* ignore */ }
      return true;
    }
    // 읽기 성공 + 문서 없음 = 아직 설정 전 → 설정 화면으로
    location.replace("/setup.html");
    return false;
  } catch (_error) {
    // 연결 실패/규칙 미배포 등 불확정 → 리다이렉트하지 않고 그대로 진행
    return true;
  }
}

const yearEl = document.getElementById("year");
if (yearEl) yearEl.textContent = new Date().getFullYear();

document.getElementById("quickSearchBtn")?.addEventListener("click", () => {
  const tag = (document.getElementById("quickTag")?.value || "").trim();
  if (!tag) return;
  location.href = `/search.html?tag=${encodeURIComponent(tag)}`;
});

// 설정 완료 확인 후에만 헤더/디자인을 그린다 (미설정이면 setup.html로 이동)
ensureBootstrapped().then((ok) => {
  if (!ok) return;

  const cachedSiteTitle = readCachedSiteTitle();
  if (cachedSiteTitle) {
    applySiteTitle({ siteTitle: cachedSiteTitle });
  }

  // 디자인 설정: 캐시를 먼저 적용해 첫 페인트 깜빡임을 줄인다
  const cachedDesign = readCachedDesign();
  if (cachedDesign) {
    applyDesignSettings(cachedDesign);
  }

  paintTopArea();
});

async function paintTopArea() {
  try {
    const navEl = document.getElementById("topNav");
    const settings = navEl ? await renderTopNav(navEl) : await loadSiteMainSettings();
    applyHeaderFont(settings);
    applySiteTitle(settings);
    applyDesignSettings(settings.design);
    writeCachedDesign(settings.design);

    const pillGuest = document.getElementById("pillGuest");
    if (pillGuest) pillGuest.textContent = `Guest: ${isGuestUnlocked() ? "ON" : "OFF"}`;

    const pillAdmin = document.getElementById("pillAdmin");
    if (pillAdmin) {
      const auth = await getAuthSnapshot();
      pillAdmin.textContent = `Admin: ${auth?.isAdmin ? "ON" : "OFF"}`;
    }
  } catch (error) {
    console.warn("Failed to paint header:", error);
  }
}

function applySiteTitle(settings = {}) {
  const siteTitle = getSiteTitle(settings);
  document.querySelectorAll("#siteTitle, [data-site-title]").forEach((el) => {
    el.textContent = siteTitle;
  });

  if (appliedSiteTitleAsDocumentTitle || shouldReplaceDocumentTitle(document.title)) {
    document.title = siteTitle;
    appliedSiteTitleAsDocumentTitle = true;
  }
}

function shouldReplaceDocumentTitle(title) {
  const normalized = String(title || "").trim();
  return !normalized || normalized === "NAMWALL" || normalized === "Archive";
}

function applyHeaderFont(settings = {}) {
  const fontName = normalizeHeaderFontFamily(settings.headerFontFamily);
  if (!fontName) {
    document.body?.style.removeProperty("--header-font");
    removeHeaderFontLink();
    return;
  }

  const link = ensureHeaderFontLink();
  const href = buildGoogleFontUrl(fontName);
  if (link.getAttribute("href") !== href) {
    link.setAttribute("href", href);
  }
  document.body?.style.setProperty("--header-font", `"${escapeCssString(fontName)}", var(--font-kr), sans-serif`);
}

function normalizeHeaderFontFamily(value) {
  return String(value || "")
    .replace(/^["']+|["']+$/g, "")
    .replace(/[<>{};]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function buildGoogleFontUrl(fontName) {
  const params = new URLSearchParams({
    family: fontName,
    display: "swap"
  });
  return `https://fonts.googleapis.com/css2?${params.toString()}`;
}

function ensureHeaderFontLink() {
  const existing = document.getElementById(HEADER_FONT_LINK_ID);
  if (existing) return existing;

  const link = document.createElement("link");
  link.id = HEADER_FONT_LINK_ID;
  link.rel = "stylesheet";
  document.head.appendChild(link);
  return link;
}

function removeHeaderFontLink() {
  document.getElementById(HEADER_FONT_LINK_ID)?.remove();
}

function escapeCssString(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
