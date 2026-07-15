import { getAuthSnapshot, isGuestUnlocked } from "./state.js";
import { db } from "./firebase.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getSiteTitle, loadSiteMainSettings, readCachedSiteTitle, renderTopNav } from "../shared/boards-render.js";
import { applyDesignSettings, readCachedDesign, writeCachedDesign, writeCachedHeaderFont } from "../shared/design.js";

const HEADER_FONT_LINK_ID = "archiveHeaderFontLink";
const BOOTSTRAP_FLAG = "archive_bootstrapped_v1";
let appliedSiteTitleAsDocumentTitle = false;

// 첫 실행 게이트: 첫 관리자 등록 전(미설치)이면 공개 페이지 → /setup.html
// 판정 순서:
//  1) site_settings/main 존재 → 이미 운영 중(옛 규칙에서도 공개 읽기) → 통과
//  2) main 없음 + bootstrap 표식 존재 → 마법사 직후(홈 설정 전) → 통과
//  3) 둘 다 없음(읽기 성공) → 미설치 → /setup.html
//  4) 읽기 오류 → 미설치/미설정 프로젝트로 간주 → /setup.html
//     (운영 사이트의 main은 옛 규칙에서도 공개 읽기라 이 경로로 오지 않음 → 안전)
function cacheBootstrapped() {
  try { localStorage.setItem(BOOTSTRAP_FLAG, "1"); } catch (_error) { /* ignore */ }
}
function goToSetup() {
  if (!location.pathname.endsWith("/setup.html")) location.replace("setup.html");
  return false;
}
async function ensureBootstrapped() {
  try {
    if (localStorage.getItem(BOOTSTRAP_FLAG) === "1") return true;
  } catch (_error) {
    // localStorage 불가 시 아래에서 서버 확인
  }
  try {
    const mainSnap = await getDoc(doc(db, "site_settings", "main"));
    if (mainSnap.exists()) { cacheBootstrapped(); return true; }

    const bootSnap = await getDoc(doc(db, "site_settings", "bootstrap"));
    if (bootSnap.exists()) { cacheBootstrapped(); return true; }

    return goToSetup();
  } catch (_error) {
    // main조차 읽지 못함 = 규칙 미배포/잠금(갓 만든 프로젝트) 또는 잘못된 설정
    // → 설정 마법사로 유도 (연결 진단 안내 표시)
    return goToSetup();
  }
}

const yearEl = document.getElementById("year");
if (yearEl) yearEl.textContent = new Date().getFullYear();

document.getElementById("quickSearchBtn")?.addEventListener("click", () => {
  const tag = (document.getElementById("quickTag")?.value || "").trim();
  if (!tag) return;
  location.href = `search.html?tag=${encodeURIComponent(tag)}`;
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
  writeCachedHeaderFont(fontName);
  if (!fontName) {
    document.body?.style.removeProperty("--header-font");
    // font-boot.js(첫 페인트용)가 html에 남긴 인라인 변수도 함께 제거
    document.documentElement.style.removeProperty("--header-font");
    removeHeaderFontLink();
    return;
  }

  const link = ensureHeaderFontLink();
  const href = buildGoogleFontUrl(fontName);
  if (link.getAttribute("href") !== href) {
    link.setAttribute("href", href);
  }
  document.body?.style.setProperty("--header-font", `"${escapeCssString(fontName)}", var(--font-kr), sans-serif`);
  document.documentElement.style.removeProperty("--header-font");
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
