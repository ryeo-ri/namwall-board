// 사이트 공통 — 부트스트랩(설정·게시판·내 프로필) 로드(세션 캐시), 헤더(내비·pills) 렌더
import {
  naru, runQuery, runMutate, getAdminSession, getMemberSession,
  signInMember, signOutMember, naruErrorMessage, sessionHint, clearSessionHint
} from "./naru-client.js";
import { applyDesignSettings, applyHeaderFont, parseDesignJson } from "../shared/design.js";

const CACHE_PREFIX = "naru_board_boot_v3";
const CACHE_TTL_MS = 5 * 60 * 1000;

let bootPromise = null;
let currentSettings = {}; // 마지막 boot의 설정 — ownerDisplayName 등에서 참조

// 관리자 글·댓글에 표시할 이름 (설정 ownerName, 기본 "관리자")
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
      // 지난 페이지에서 비로그인으로 확인됐으면 세션 왕복을 기다리지 않는다.
      // (뒤늦게 로그인이 확인되면 아래 scheduleSessionRecheck가 새로 그린다)
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

      const empty = { settings: {}, boards: [], me: null, owner: false };
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
        return empty; // 실패는 캐시하지 않음
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

// 세션 구분 없이, 캐시된 boot 중 가장 최근 것의 게시판 목록을 동기적으로 읽는다.
// 목록 쿼리를 헤더 렌더와 병렬로 미리 던질 때 게시판 설정(스킨·페이지 크기)을 알아내는 용도.
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

/* ── 헤더: 사이트 제목 + 게시판 메뉴(제목 이미지 지원) + 상태 pill ── */
export async function renderHeader() {
  const titleEl = document.getElementById("siteTitle");
  const navEl = document.getElementById("topNav");
  const boot = await loadBoot();
  const { settings, boards } = boot;

  if (titleEl) titleEl.textContent = settings.title || "NARU BOARD";
  if (settings.title) document.title = document.title.includes(settings.title)
    ? document.title
    : `${document.title} - ${settings.title}`;

  // 디자인 설정(색·폰트) 적용 — 사용자 페이지에만
  applyDesignSettings(parseDesignJson(settings.design));
  applyHeaderFont(settings.headerFontFamily || "");

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

  renderPills(boot);

  // 로그인 복귀 직후 세션 확립이 페이지 로드보다 늦는 경우 보정:
  // 비로그인으로 그려졌다면 잠시 후 한 번 더 확인하고, 세션이 생겼으면 새로 그린다.
  if (!boot.me && !boot.owner) scheduleSessionRecheck();
  return boot;
}

let sessionRechecked = false;
function scheduleSessionRecheck() {
  if (sessionRechecked) return;
  sessionRechecked = true;
  setTimeout(async () => {
    try {
      const member = await naru.members.session();
      if (member) {
        clearSiteCache();
        location.reload();
      }
    } catch (_error) { /* ignore */ }
  }, 800);
}

// 원본 Guest/Admin pill 자리 — 로그인/로그아웃 토글: 비로그인 = login, 로그인 = "닉네임 · logout"
function renderPills(boot) {
  const memberPill = document.getElementById("pillMember");
  const adminPill = document.getElementById("pillAdmin");

  if (memberPill) {
    if (boot.me) {
      memberPill.textContent = `${boot.me.nickname || "member"} · logout`;
      memberPill.title = "클릭해서 로그아웃";
      memberPill.onclick = async () => {
        if (!window.confirm("회원 로그아웃할까요?")) return;
        await signOutMember();
        clearSiteCache();
        location.reload();
      };
    } else {
      memberPill.textContent = "login";
      memberPill.title = "클릭해서 나루 계정으로 로그인";
      memberPill.onclick = () => {
        signInMember().catch((error) => window.alert(naruErrorMessage(error, "로그인을 시작하지 못했습니다.")));
      };
    }
  }
  if (adminPill) {
    adminPill.textContent = "admin";
    adminPill.title = "관리자 페이지로 이동";
    adminPill.onclick = () => { location.href = "admin.html"; };
  }
}

// 닉네임 등록(최초 1회) — 글·댓글을 쓰려면 필요하다.
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

// 게시판 가로(boardWidth) 적용 — 원본 규칙: 100 이하는 %, 그 이상은 px
export function formatResponsiveWidth(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "";
  return n <= 100 ? `${Math.round(n)}%` : `${Math.round(n)}px`;
}

export function applyBoardWidth(board, skinType = "") {
  const mainEl = document.querySelector("body.site-page main.container");
  if (!mainEl) return;
  const fallback = skinType === "BOARD" ? 800 : "";
  const width = formatResponsiveWidth(board?.options?.boardWidth ?? fallback);
  if (width) mainEl.style.setProperty("--board-page-w", width);
  else mainEl.style.removeProperty("--board-page-w");
  mainEl.style.setProperty("--board-page-extra-w", skinType === "LOG" ? "40px" : "0px");
}

export function getBoardById(boards, boardId) {
  const target = String(boardId || "").toLowerCase();
  return boards.find((board) => String(board.id).toLowerCase() === target) || null;
}

export function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

export function formatDate(value) {
  const date = toDate(value);
  if (!date) return "";
  return date.toLocaleDateString("ko-KR");
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

// 서비스 워커 등록 — 정적 파일을 캐시해 페이지 이동 시 재다운로드를 없앤다.
// (나루가 정적 파일을 max-age=0으로 내려줘서 매 페이지마다 전부 다시 받는 문제 보완)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => { /* 미지원·실패 시 그냥 네트워크 사용 */ });
  });
}
