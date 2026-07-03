import { getAuthSnapshot, isGuestUnlocked } from "./state.js";
import { getSiteTitle, loadSiteMainSettings, renderTopNav } from "../shared/boards-render.js";
import { applyDesignSettings, readCachedDesign, writeCachedDesign } from "../shared/design.js";

const HEADER_FONT_LINK_ID = "archiveHeaderFontLink";
let appliedSiteTitleAsDocumentTitle = false;

const yearEl = document.getElementById("year");
if (yearEl) yearEl.textContent = new Date().getFullYear();

const cachedSiteTitle = readCachedSiteTitle();
if (cachedSiteTitle) {
  applySiteTitle({ siteTitle: cachedSiteTitle });
}

// 디자인 설정: 캐시를 먼저 적용해 첫 페인트 깜빡임을 줄인다
const cachedDesign = readCachedDesign();
if (cachedDesign) {
  applyDesignSettings(cachedDesign);
}

document.getElementById("quickSearchBtn")?.addEventListener("click", () => {
  const tag = (document.getElementById("quickTag")?.value || "").trim();
  if (!tag) return;
  location.href = `/search.html?tag=${encodeURIComponent(tag)}`;
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

paintTopArea();

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

function readCachedSiteTitle() {
  try {
    const raw = sessionStorage.getItem("archive_nav_cache_v1");
    if (!raw) return "";
    const parsed = JSON.parse(raw);
    return parsed?.siteTitle || "";
  } catch (_error) {
    return "";
  }
}
