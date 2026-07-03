import { db } from "../core/firebase.js";
import { collection, doc, getDoc, getDocs } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { isBoardMenuVisible, resolveBoardSkinType } from "../skins/registry.js";
import { normalizeDesignSettings } from "./design.js";

const NAV_CACHE_KEY = "archive_nav_cache_v2";
const SITE_SETTINGS_CACHE_KEY = "archive_site_settings_cache_v3";
const BOARD_SNAPSHOT_CACHE_KEY = "archive_board_snapshot_cache_v1";
const NAV_CACHE_TTL_MS = 5 * 60 * 1000;
const DATA_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_SITE_TITLE = "NAMWALL";
const PREFETCHED = new Set();
let siteSettingsCache = null;
let siteSettingsPromise = null;
let boardSnapshotCache = null;
let boardSnapshotPromise = null;

export function getSiteTitle(settings = {}) {
  const title = String(settings?.siteTitle || "").trim();
  return title || DEFAULT_SITE_TITLE;
}

export async function loadSiteMainSettings() {
  if (siteSettingsCache) return siteSettingsCache;
  if (siteSettingsPromise) return siteSettingsPromise;

  siteSettingsPromise = (async () => {
    const cached = readTimedJsonCache(SITE_SETTINGS_CACHE_KEY, DATA_CACHE_TTL_MS);
    if (cached) {
      siteSettingsCache = cached;
      return cached;
    }

    const ref = doc(db, "site_settings", "main");
    const snap = await getDoc(ref);
    const settings = snap.exists()
      ? normalizeSiteMainSettings(snap.data() || {})
      : {
          siteTitle: DEFAULT_SITE_TITLE,
          homeIntroHtml: "",
          homeIntroWidth: "",
          homeTitle: "",
          homeLead: "",
          homeBody: "",
          homeShowText: false,
          homeHeaderWidth: "",
          headerFontFamily: "",
          homeImageWidth: "",
          homeImageHeight: "",
          homeImages: [],
          design: normalizeDesignSettings({})
        };

    siteSettingsCache = settings;
    writeTimedJsonCache(SITE_SETTINGS_CACHE_KEY, settings);
    return settings;
  })().finally(() => {
    siteSettingsPromise = null;
  });

  return siteSettingsPromise;
}

export function invalidateSiteMainSettingsCache() {
  siteSettingsCache = null;
  siteSettingsPromise = null;
  try {
    sessionStorage.removeItem(SITE_SETTINGS_CACHE_KEY);
  } catch (_error) {
    // ignore
  }
}

export function invalidateBoardSnapshotCache() {
  boardSnapshotCache = null;
  boardSnapshotPromise = null;
  try {
    sessionStorage.removeItem(BOARD_SNAPSHOT_CACHE_KEY);
  } catch (_error) {
    // ignore
  }
}

export function invalidateTopNavCache() {
  try {
    sessionStorage.removeItem(NAV_CACHE_KEY);
  } catch (_error) {
    // ignore
  }
}

export function invalidateNavigationCaches() {
  invalidateTopNavCache();
  invalidateBoardSnapshotCache();
}

export async function loadBoardTitleMap() {
  const boards = await loadBoardSnapshot();
  return boards.reduce((map, board) => {
    map.set(String(board.id || "").toLowerCase(), board.title || board.name || board.id || "");
    return map;
  }, new Map());
}

export function formatResponsiveWidth(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "";
  return n <= 100 ? `${Math.round(n)}%` : `${Math.round(n)}px`;
}

function buildLegacyHomeIntroHtml(data = {}) {
  const title = String(data.homeTitle || "").trim();
  const lead = String(data.homeLead || "").trim();
  const body = String(data.homeBody || "").trim();
  const parts = [];

  if (title) {
    parts.push(`<p><strong>${escapeHtml(title)}</strong></p>`);
  }

  if (lead) {
    parts.push(`<p>${escapeHtml(lead)}</p>`);
  }

  if (body) {
    body
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        parts.push(`<p>${escapeHtml(line)}</p>`);
      });
  }

  return parts.join("");
}

export async function renderTopNav(navEl) {
  if (!navEl) return;

  const cached = readNavCache();
  if (cached?.html) {
    navEl.innerHTML = cached.html;
    attachMenuPrefetch(navEl);
    prefetchTopLinksOnIdle(navEl, 3);
  }

  const settings = await loadSiteMainSettings();
  const boards = await loadBoardSnapshot({ forceRefresh: true });
  const menuBoards = boards
    .filter((board) => isBoardMenuVisible(board))
    .sort((a, b) => {
      const ao = Number.isFinite(Number(a.menuOrder)) ? Number(a.menuOrder) : 99999;
      const bo = Number.isFinite(Number(b.menuOrder)) ? Number(b.menuOrder) : 99999;
      if (ao !== bo) return ao - bo;
      return (a.title || a.id || "").localeCompare((b.title || b.id || ""), "ko");
    });

  const html = menuBoards
    .map((board) => `<a href="${escapeHtml(getBoardMenuHref(board))}">${escapeHtml(board.title || board.id)}</a>`)
    .join("");

  writeNavCache({ html, siteTitle: settings.siteTitle });
  navEl.innerHTML = html;
  attachMenuPrefetch(navEl);
  prefetchTopLinksOnIdle(navEl, 3);

  return settings;
}

function getBoardMenuHref(board = {}) {
  const boardId = encodeURIComponent(board.id || "");
  return resolveBoardSkinType(board) === "PAGE"
    ? `/page.html?bo=${boardId}`
    : `/board.html?bo=${boardId}`;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}

function readNavCache() {
  try {
    const raw = sessionStorage.getItem(NAV_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.ts || Date.now() - parsed.ts > NAV_CACHE_TTL_MS) return null;
    return parsed;
  } catch (_error) {
    return null;
  }
}

function writeNavCache(payload) {
  try {
    sessionStorage.setItem(NAV_CACHE_KEY, JSON.stringify({ ...payload, ts: Date.now() }));
  } catch (_error) {
    // ignore
  }
}

async function loadBoardSnapshot({ forceRefresh = false } = {}) {
  if (!forceRefresh && boardSnapshotCache) return boardSnapshotCache;
  if (!forceRefresh && boardSnapshotPromise) return boardSnapshotPromise;

  boardSnapshotPromise = (async () => {
    const cached = forceRefresh ? null : readTimedJsonCache(BOARD_SNAPSHOT_CACHE_KEY, DATA_CACHE_TTL_MS);
    if (cached) {
      boardSnapshotCache = cached;
      return cached;
    }

    const snap = await getDocs(collection(db, "boards"));
    const boards = snap.docs.map((item) => ({ id: item.id, ...item.data() }));
    boardSnapshotCache = boards;
    writeTimedJsonCache(BOARD_SNAPSHOT_CACHE_KEY, boards);
    return boards;
  })().finally(() => {
    boardSnapshotPromise = null;
  });

  return boardSnapshotPromise;
}

function attachMenuPrefetch(navEl) {
  const links = navEl.querySelectorAll("a[href]");
  links.forEach((link) => {
    const handler = () => prefetchHref(link.getAttribute("href") || "");
    link.addEventListener("mouseenter", handler, { passive: true });
    link.addEventListener("focus", handler, { passive: true });
    link.addEventListener("touchstart", handler, { passive: true, once: true });
  });
}

function prefetchTopLinksOnIdle(navEl, count = 3) {
  const urls = Array.from(navEl.querySelectorAll("a[href]"))
    .map((a) => a.getAttribute("href") || "")
    .slice(0, count);

  const run = () => urls.forEach((href) => prefetchHref(href));
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(run, { timeout: 1200 });
  } else {
    setTimeout(run, 300);
  }
}

function prefetchHref(href) {
  const normalized = normalizePrefetchUrl(href);
  if (!normalized || PREFETCHED.has(normalized)) return;
  PREFETCHED.add(normalized);

  const link = document.createElement("link");
  link.rel = "prefetch";
  link.href = normalized;
  link.as = "document";
  document.head.appendChild(link);
}

function normalizePrefetchUrl(href) {
  try {
    const url = new URL(href, window.location.origin);
    if (url.origin !== window.location.origin) return "";
    return `${url.pathname}${url.search}`;
  } catch (_error) {
    return "";
  }
}

function normalizeSiteMainSettings(data = {}) {
  const hasHomeIntroHtml = Object.prototype.hasOwnProperty.call(data, "homeIntroHtml");
  return {
    siteTitle: getSiteTitle(data),
    homeIntroHtml: hasHomeIntroHtml ? String(data.homeIntroHtml || "") : buildLegacyHomeIntroHtml(data),
    homeIntroWidth: data.homeIntroWidth || "",
    homeTitle: data.homeTitle || "",
    homeLead: data.homeLead || "",
    homeBody: data.homeBody || "",
    homeShowText: data.homeShowText === true,
    homeHeaderWidth: data.homeHeaderWidth || "",
    headerFontFamily: normalizeFontFamilyValue(data.headerFontFamily),
    homeImageWidth: data.homeImageWidth || "",
    homeImageHeight: data.homeImageHeight || "",
    homeImages: Array.isArray(data.homeImages) ? data.homeImages : [],
    design: normalizeDesignSettings(data.design)
  };
}

function normalizeFontFamilyValue(value) {
  return String(value || "")
    .replace(/[<>{};]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function readTimedJsonCache(key, ttlMs) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.ts || Date.now() - parsed.ts > ttlMs) return null;
    return parsed.value ?? null;
  } catch (_error) {
    return null;
  }
}

function writeTimedJsonCache(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), value }));
  } catch (_error) {
    // ignore
  }
}
