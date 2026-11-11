// NARU BOARD Copyright (c) 2026 NAMWALL — MPL-2.0 (https://mozilla.org/MPL/2.0/)
// 사이트 공통 — 부트스트랩(설정·게시판·내 프로필, 세션 캐시), 헤더, 공용 포맷 함수
import {
  naru, runQuery, runMutate, getAdminSession, getMemberSession,
  naruErrorMessage, sessionHint, clearSessionHint
} from "./naru-client.js";
import { applyDesignSettings, applyHeaderFont, applyOwnerFiles, parseDesignJson } from "../shared/design.js";

const CACHE_PREFIX = "naru_board_boot_v3";
const CACHE_TTL_MS = 5 * 60 * 1000;

let bootPromise = null;
let currentSettings = {};

// 관리자 글·댓글에 표시할 이름
export function ownerDisplayName() {
  return String(currentSettings.ownerName || "").trim() || "관리자";
}

function readCache(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { at, value } = JSON.parse(raw);
    return Date.now() - at < CACHE_TTL_MS ? value : null;
  } catch (_error) {
    return null;
  }
}

function writeCache(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), value }));
  } catch (_error) { /* ignore */ }
}

function normalizeBoard(row) {
  let options = {};
  try {
    const parsed = JSON.parse(row.options || "{}");
    if (parsed && typeof parsed === "object") options = parsed;
  } catch (_error) { /* ignore */ }
  return {
    id: String(row.id),
    title: row.title || "",
    description: row.description || "",
    titleImageUrl: row.title_image || "",
    skinType: String(row.skin || "BOARD").toUpperCase(),
    menuOrder: Number(row.menu_order) || 0,
    pageSize: Number(row.page_size) || 0,
    menuVisible: row.menu_visible !== 0,
    isPublic: row.is_public !== 0,
    memberWrite: row.member_write === 1,
    options
  };
}

// 설정·게시판·내 프로필을 한 번의 쿼리로 (로그인 상태별로 캐시 분리)
export function loadBoot() {
  if (!bootPromise) {
    bootPromise = (async () => {
      // 비로그인으로 확인된 방문자는 세션 왕복을 기다리지 않는다 (틀렸으면 scheduleSessionRecheck가 보정)
      let admin = null;
      let member = null;
      if (sessionHint() !== "anon") {
        [admin, member] = await Promise.all([getAdminSession(), getMemberSession()]);
      }
      const cacheKey = `${CACHE_PREFIX}_${admin ? "o" : ""}${member ? member.id : ""}`;
      const cached = readCache(cacheKey);
      if (cached) {
        currentSettings = cached.settings || {};
        return cached;
      }

      try {
        const result = await runQuery("site:boot");
        const value = {
          settings: result?.settings || {},
          boards: (result?.boards || []).map(normalizeBoard),
          me: result?.me || null,
          owner: result?.owner === true
        };
        writeCache(cacheKey, value);
        currentSettings = value.settings;
        return value;
      } catch (error) {
        console.warn("사이트 정보를 불러오지 못했습니다.", error);
        return { settings: {}, boards: [], me: null, owner: false, failed: true };
      }
    })();
  }
  return bootPromise;
}

export function clearSiteCache() {
  try {
    Object.keys(sessionStorage)
      .filter((key) => key.startsWith(CACHE_PREFIX))
      .forEach((key) => sessionStorage.removeItem(key));
  } catch (_error) { /* ignore */ }
  clearSessionHint();
  bootPromise = null;
}

// 캐시된 boot 중 가장 최근 것의 게시판 목록 — 목록 쿼리를 헤더 렌더와 병렬로 미리 보낼 때 쓴다
export function peekCachedBoards() {
  try {
    let best = null;
    for (const key of Object.keys(sessionStorage)) {
      if (!key.startsWith(CACHE_PREFIX)) continue;
      const { at, value } = JSON.parse(sessionStorage.getItem(key) || "");
      if (Date.now() - at < CACHE_TTL_MS && (!best || at > best.at)) best = { at, value };
    }
    return best?.value?.boards || [];
  } catch (_error) {
    return [];
  }
}

// 헤더: 사이트 제목 + 게시판 메뉴(제목 이미지 지원)
export async function renderHeader() {
  const titleEl = document.getElementById("siteTitle");
  const navEl = document.getElementById("topNav");
  const boot = await loadBoot();
  const { settings, boards } = boot;

  if (titleEl) titleEl.textContent = settings.title || "NARU BOARD";
  if (settings.title && !document.title.includes(settings.title)) {
    document.title = `${document.title} - ${settings.title}`;
  }

  applyDesignSettings(parseDesignJson(settings.design));
  applyHeaderFont(settings.headerFontFamily || "");
  applyOwnerFiles(settings.ownerFiles === "1");

  const headerContainer = document.querySelector(".header .container");
  if (headerContainer) {
    const headerWidth = formatResponsiveWidth(settings.homeHeaderWidth);
    headerContainer.style.width = headerWidth ? `min(${headerWidth}, 100%)` : "";
  }

  if (navEl) {
    navEl.innerHTML = boards
      .filter((board) => board.menuVisible)
      .map((board) => {
        const label = board.titleImageUrl
          ? `<img src="${escapeHtml(board.titleImageUrl)}" alt="${escapeHtml(board.title || board.id)}" class="nav-title-image">`
          : escapeHtml(board.title || board.id);
        return `<a href="board.html?bo=${encodeURIComponent(board.id)}">${label}</a>`;
      })
      .join("");
  }

  // 로그인 복귀 직후 세션이 늦게 잡히는 경우: 잠시 뒤 다시 확인해 로그인돼 있으면 새로 그린다
  if (!boot.me && !boot.owner && !boot.failed) scheduleSessionRecheck();
  return boot;
}

const RECHECK_KEY = "naru_board_session_recheck";
let sessionRechecked = false;
function scheduleSessionRecheck() {
  if (sessionRechecked) return;
  sessionRechecked = true;
  setTimeout(async () => {
    try {
      const member = await naru.members.session();
      if (!member) return;
      // 새로고침이 반복되지 않게 30초에 한 번만
      const last = Number(sessionStorage.getItem(RECHECK_KEY)) || 0;
      if (Date.now() - last < 30000) return;
      sessionStorage.setItem(RECHECK_KEY, String(Date.now()));
      clearSiteCache();
      location.reload();
    } catch (_error) { /* ignore */ }
  }, 800);
}

// 닉네임 등록(최초 1회) — 회원이 글·댓글을 쓰려면 필요하다
export async function promptNickname(message = "사용할 닉네임을 입력하세요. (한글·영문·숫자 2~20자)") {
  const nickname = window.prompt(message);
  if (nickname === null) return false;
  try {
    await runMutate("account:register", { nickname: nickname.trim() });
    clearSiteCache();
    location.reload();
    return true;
  } catch (error) {
    if (error?.details?.unique === "nickname") {
      window.alert("이미 사용 중인 닉네임입니다.");
    } else {
      window.alert(naruErrorMessage(error, "닉네임 등록에 실패했습니다."));
    }
    return false;
  }
}

// 폭 값: 100 이하는 %, 그 이상은 px
export function formatResponsiveWidth(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "";
  return n <= 100 ? `${Math.round(n)}%` : `${Math.round(n)}px`;
}

// 게시판 가로(옵션 boardWidth) — 없으면 모든 스킨이 기본 폭(--max-w, 800px)
export function applyBoardWidth(board) {
  const mainEl = document.querySelector("body.site-page main.container");
  if (!mainEl) return;
  const width = formatResponsiveWidth(board?.options?.boardWidth);
  if (width) mainEl.style.setProperty("--board-page-w", width);
  else mainEl.style.removeProperty("--board-page-w");
}

export function normalizeSkinType(board) {
  return String(board?.skinType || "BOARD").trim().toUpperCase();
}

export function getBoardById(boards, boardId) {
  const target = String(boardId || "").toLowerCase();
  return boards.find((board) => String(board.id).toLowerCase() === target) || null;
}

export function escapeHtml(value) {
  const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(value ?? "").replace(/[&<>"']/g, (character) => entities[character]);
}

// http(s) 주소만 통과시킨다 — 그 외에는 ""
export function getHttpUrl(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

// 출처 표시 — [라벨]URL은 라벨 링크로(여러 개 가능), URL만 있으면 '링크', 그 외는 텍스트 그대로
export function renderSourceLinks(rawSource) {
  const source = String(rawSource || "").trim();
  if (!source) return "";

  const linkPattern = /\[([^\]\r\n]+)\](https?:\/\/[^\s[\]]+)/gi;
  let content = "";
  let lastIndex = 0;
  let match;

  while ((match = linkPattern.exec(source)) !== null) {
    content += escapeHtml(source.slice(lastIndex, match.index));
    // URL 끝에 붙은 문장부호는 링크에서 뺀다
    const rawUrl = match[2].replace(/[.,;:!?]+$/, "");
    const url = getHttpUrl(rawUrl);
    content += url
      ? sourceLink(url, match[1].trim()) + escapeHtml(match[2].slice(rawUrl.length))
      : escapeHtml(match[0]);
    lastIndex = linkPattern.lastIndex;
  }

  if (lastIndex > 0) return content + escapeHtml(source.slice(lastIndex));
  // new URL은 경로의 공백을 허용하므로 공백이 섞이면 URL로 보지 않는다
  const url = /\s/.test(source) ? "" : getHttpUrl(source);
  return url ? sourceLink(url, "링크") : `<span>${escapeHtml(source)}</span>`;
}

function sourceLink(url, label) {
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="text-decoration: underline;">${escapeHtml(label)}</a>`;
}

// 한 줄 칸 수(게시판 옵션 galleryColumns) — 1~max 정수
export function clampColumns(value, fallback, max = 6) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.min(max, Math.round(number))) : fallback;
}

export function formatDate(value) {
  const date = toDate(value);
  return date ? date.toLocaleDateString("ko-KR") : "";
}

export function formatDateTime(value) {
  const date = toDate(value);
  if (!date) return "";
  return `${date.toLocaleDateString("ko-KR")} ${date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`;
}

function toDate(value) {
  if (value == null || value === "") return null;
  const date = new Date(typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// 홈 대표 이미지 설정(homeImages JSON) → [{ url, source }]
export function parseHomeImages(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed)
      ? parsed.filter((item) => item && item.url).map((item) => ({ url: item.url, source: String(item.source || "") }))
      : [];
  } catch (_error) {
    return [];
  }
}

// 서비스 워커: 정적 파일 캐시 (나루는 정적 파일을 max-age=0으로 내려준다)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
