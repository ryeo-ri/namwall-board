import { db } from "../core/firebase.js";
import { formatResponsiveWidth, loadBoardTitleMap, loadSiteMainSettings } from "../shared/boards-render.js";
import { sanitizeHTML } from "../shared/html-sanitizer-v2.js";
import { collection, doc, getDoc, getDocs, limit, orderBy, query, where } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuthSnapshot, isGuestUnlocked, logoutAdmin, verifyGuestCode } from "../core/state.js";
import { isProfilePost } from "../skins/registry.js";

let homeSettingsCache = null;
let homeSettingsPromise = null;
const recentPostsCache = new Map();
const recentPostsPromise = new Map();
async function getHomeSettings() {
  if (homeSettingsCache) return homeSettingsCache;
  if (!homeSettingsPromise) {
    homeSettingsPromise = loadSiteMainSettings()
      .then((settings) => {
        homeSettingsCache = settings;
        return settings;
      })
      .finally(() => {
        homeSettingsPromise = null;
      });
  }
  return homeSettingsPromise;
}

export async function initializeHomePage() {
  try {
    const [settings, auth] = await Promise.all([
      getHomeSettings(),
      getAuthSnapshot()
    ]);
    const settingsSnapshot = await getDoc(doc(db, "site_settings", "main"));
    const homeIsPublic = settingsSnapshot.exists()
      ? settingsSnapshot.data()?.homeIsPublic !== false
      : true;

    if (!homeIsPublic && !auth?.isAdmin && !isGuestUnlocked()) {
      renderHomeAccessGate(settings);
      return;
    }

    document.body?.classList.remove("home-access-pending", "home-access-locked");
    await Promise.all([
      loadHomeIntro(),
      renderQuickMenu(),
      loadRecentUpdates(),
      loadRecentTags()
    ]);
  } catch (error) {
    console.error("홈페이지 접근 확인 실패:", error);
    renderHomeAccessError();
  }
}

function renderHomeAccessGate(settings = {}) {
  const main = document.querySelector("body.home-page > main.container");
  if (!main) return;

  document.body?.classList.remove("home-access-pending");
  document.body?.classList.add("home-access-locked");
  main.innerHTML = `
    <section class="home-access-gate" aria-labelledby="homeAccessTitle">
      <h1 id="homeAccessTitle">${escapeHtml(settings.siteTitle || "NAMWALL")}</h1>
      <p class="home-access-gate-copy">비공개 홈페이지입니다. 게스트 코드를 입력해 주세요.</p>
      <div class="field-group">
        <div class="formRow">
          <input id="homeGuestCodeInput" type="password" placeholder="게스트 코드" autocomplete="current-password">
          <button type="button" class="btn primary" id="homeGuestLoginBtn">확인</button>
        </div>
        <div class="notice small hidden mt-sm" id="homeGuestMsg" aria-live="polite"></div>
      </div>
      <a class="home-access-admin-link" href="admin/login.html">관리자 로그인</a>
    </section>
  `;

  const guestBtn = document.getElementById("homeGuestLoginBtn");
  const guestInput = document.getElementById("homeGuestCodeInput");
  guestBtn?.addEventListener("click", submitGuestCode);
  guestInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") submitGuestCode();
  });
  requestAnimationFrame(() => guestInput?.focus());
}

function renderHomeAccessError() {
  const main = document.querySelector("body.home-page > main.container");
  if (!main) return;

  document.body?.classList.remove("home-access-pending");
  document.body?.classList.add("home-access-locked");
  main.innerHTML = `
    <section class="home-access-gate" aria-labelledby="homeAccessErrorTitle">
      <h1 id="homeAccessErrorTitle">NAMWALL</h1>
      <p class="home-access-gate-copy">홈페이지 공개 여부를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.</p>
      <button type="button" class="btn" id="homeAccessRetryBtn">다시 시도</button>
    </section>
  `;
  document.getElementById("homeAccessRetryBtn")?.addEventListener("click", () => location.reload());
}

export async function loadHomeIntro() {
  const container = document.getElementById("homeIntro");
  if (!container) return;

  try {
    const settings = await getHomeSettings();
    applyHomeHeaderWidth(settings);
    const image = pickRandomHomeImage(settings.homeImages);
    const heroStyle = createHomeHeroStyle(settings);
    const showText = settings.homeShowText === true;
    const imageAlt = settings.siteTitle || "홈 소개 이미지";

    applyHomeIntroWidth(container, settings, showText);
    container.classList.toggle("home-intro-image-only", !showText);
    container.classList.toggle("home-intro-with-copy", showText);
    container.innerHTML = `
      <section class="home-hero ${showText ? "home-hero-with-copy" : "home-hero-image-only"}" ${heroStyle ? `style="${heroStyle}"` : ""}>
        ${showText ? renderHomeCopy(settings) : ""}
        ${image ? `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(imageAlt)}" class="home-hero-image">` : `<div class="home-hero-placeholder"></div>`}
      </section>
    `;
    cacheHomeIntroHeight(container);
  } catch (error) {
    console.error("홈 소개 로드 실패:", error);
    applyHomeHeaderWidth({});
    applyHomeIntroWidth(container, {}, false);
    container.classList.add("home-intro-image-only");
    container.classList.remove("home-intro-with-copy");
    container.innerHTML = `
      <section class="home-hero home-hero-image-only">
        <div class="home-hero-placeholder"></div>
      </section>
    `;
  }
}

function cacheHomeIntroHeight(container) {
  if (!container) return;
  requestAnimationFrame(() => {
    try {
      const height = Math.round(container.getBoundingClientRect().height);
      if (height > 0) localStorage.setItem("archive_home_intro_h_v1", `${height}px`);
    } catch (_error) {
      // ignore
    }
  });
}

export async function renderQuickMenu() {
  const container = document.getElementById("quickMenu");
  if (!container) return;

  const auth = await getAuthSnapshot();
  const settings = await getHomeSettings();
  applyHomeHeaderWidth(settings);
  const guestUnlocked = isGuestUnlocked();

  if (auth.isAdmin) {
    container.innerHTML = `
      <a class="btn primary" href="admin/index.html">관리자 대시보드</a>
      <button type="button" class="btn" id="homeAdminLogoutBtn">관리자 로그아웃</button>
    `;
    document.getElementById("homeAdminLogoutBtn")?.addEventListener("click", async () => {
      await logoutAdmin();
      await syncHomeStatus();
      await renderQuickMenu();
    });
    await syncHomeStatus();
    return;
  }

  if (guestUnlocked) {
    container.innerHTML = `
      <button type="button" class="btn" id="homeGuestStatusBtn" disabled aria-disabled="true">게스트 접속중</button>
      <a class="btn" href="admin/login.html">관리자 로그인</a>
    `;
    await syncHomeStatus();
    return;
  }

  container.innerHTML = `
    <div class="field-group">
      <div class="formRow">
        <input id="homeGuestCodeInput" type="password" placeholder="게스트 로그인">
        <button type="button" class="btn" id="homeGuestLoginBtn">확인</button>
      </div>
      <div class="notice small hidden mt-sm" id="homeGuestMsg"></div>
    </div>
    <a class="btn" href="admin/login.html">관리자 로그인</a>
  `;

  const guestBtn = document.getElementById("homeGuestLoginBtn");
  const guestInput = document.getElementById("homeGuestCodeInput");
  if (guestBtn) {
    guestBtn.addEventListener("click", submitGuestCode);
    guestInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") submitGuestCode();
    });
  }

  await syncHomeStatus();
}

async function submitGuestCode() {
  const input = document.getElementById("homeGuestCodeInput");
  const button = document.getElementById("homeGuestLoginBtn");
  const code = (input?.value || "").trim();

  if (!code) {
    showGuestMessage("게스트 코드를 입력하세요.", true);
    input?.focus();
    return;
  }

  if (button) {
    button.disabled = true;
    button.textContent = "확인 중";
  }

  const result = await verifyGuestCode(code);
  if (!result.ok) {
    showGuestMessage(result.reason || "게스트 코드 확인 실패", true);
    if (button) {
      button.disabled = false;
      button.textContent = "확인";
    }
    return;
  }

  showGuestMessage("게스트 코드 확인 완료");
  if (document.body?.classList.contains("home-access-locked")) {
    location.reload();
    return;
  }
  await syncHomeStatus();
  await renderQuickMenu();
}

function showGuestMessage(text, isError = false) {
  const msgEl = document.getElementById("homeGuestMsg");
  if (!msgEl) return;
  msgEl.classList.remove("hidden");
  msgEl.textContent = text;
  msgEl.style.borderColor = isError ? "rgba(220,38,38,.45)" : "rgba(15,23,42,.18)";
}

function renderHomeCopy(settings) {
  const siteTitle = String(settings.siteTitle || "NAMWALL").trim();
  const introHtml = String(settings.homeIntroHtml || "").trim();
  const safeIntro = sanitizeHTML(introHtml);

  return `
    <div class="home-hero-copy">
      ${siteTitle ? `<p class="home-hero-eyebrow">${escapeHtml(siteTitle)}</p>` : ""}
      ${safeIntro ? `<div class="home-hero-intro">${safeIntro}</div>` : ""}
    </div>
  `;
}

function applyHomeIntroWidth(container, settings, showText) {
  const copyWidth = showText ? Number(normalizePixelValue(settings.homeIntroWidth)) || 250 : 0;
  const width = Number(normalizePixelValue(settings.homeImageWidth));
  if (!container) return;
  if (!showText && (!Number.isFinite(width) || width <= 0)) {
    container?.style.removeProperty("--home-intro-width");
    container?.style.removeProperty("--home-copy-column");
    document.body?.style.removeProperty("--home-main-width");
    return;
  }

  const imageAreaWidth = Number.isFinite(width) && width > 0 ? width : 400;
  const heroChromeWidth = showText ? 58 : 0;
  const introWidth = imageAreaWidth + copyWidth + heroChromeWidth;
  container.style.setProperty("--home-intro-width", `${introWidth}px`);
  if (showText) {
    container.style.setProperty("--home-copy-column", `${copyWidth}px`);
  } else {
    container.style.removeProperty("--home-copy-column");
  }
  document.body?.style.setProperty("--home-main-width", `calc(${introWidth}px + (2 * var(--site-page-pad-x)))`);
}

function createHomeHeroStyle(settings) {
  const introWidth = normalizePixelValue(settings.homeIntroWidth);
  const width = normalizePixelValue(settings.homeImageWidth);
  const height = normalizePixelValue(settings.homeImageHeight);
  const rules = [];

  if (introWidth) rules.push(`--home-copy-column:${introWidth}px`);
  if (width) rules.push(`--home-image-width:${width}px`);
  rules.push(`--home-image-column:${width ? `minmax(0, ${width}px)` : "minmax(0, 1.1fr)"}`);
  rules.push(`--home-image-height:${height ? `${height}px` : "var(--home-hero-min-height)"}`);
  rules.push(`--home-hero-min-height:${height ? `${height}px` : "72vh"}`);
  rules.push(`--home-hero-max-height:${height ? "none" : "82vh"}`);
  return rules.join(";");
}

function applyHomeHeaderWidth(settings) {
  const width = formatResponsiveWidth(settings?.homeHeaderWidth);
  if (!document.body) return;
  if (width) {
    document.body.style.setProperty("--home-header-width", width);
  } else {
    document.body.style.removeProperty("--home-header-width");
  }
}

async function syncHomeStatus() {
  const pillGuest = document.getElementById("pillGuest");
  const pillAdmin = document.getElementById("pillAdmin");
  const auth = await getAuthSnapshot();

  if (pillGuest) pillGuest.textContent = `Guest: ${isGuestUnlocked() ? "ON" : "OFF"}`;
  if (pillAdmin) pillAdmin.textContent = `Admin: ${auth?.isAdmin ? "ON" : "OFF"}`;
}

function normalizePixelValue(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const number = Number(raw);
  if (!Number.isFinite(number)) return "";
  return String(Math.max(120, Math.min(2400, Math.round(number))));
}

export async function loadRecentUpdates() {
  try {
    const container = document.getElementById("recentList");
    if (!container) return;

    const auth = await getAuthSnapshot();
    const posts = await getRecentHomePosts(auth.isAdmin);
    const visiblePosts = posts.slice(0, 5);

    if (visiblePosts.length === 0) {
      container.innerHTML = '<div class="notice small">아직 게시물이 없습니다.</div>';
      return;
    }

    const boardTitleMap = await loadBoardTitleMap();
    const postsHTML = visiblePosts.map((post) => {
      const boardId = getPostBoardId(post);
      const boardName = boardTitleMap.get(boardId.toLowerCase()) || boardId || "게시판";
      const dateSource = getRecentDateValue(post);
      const dateStr = dateSource ? dateSource.toLocaleDateString("ko-KR") : "";
      const boardUrl = `board.html?bo=${encodeURIComponent(boardId || "board")}`;

      // 제목이 있으면 제목, 없으면 게시판 메뉴명. LOG는 제목이 자동 번호라 게시판명 유지.
      const rawTitle = String(post.title || "").trim();
      const isLogPost = String(post.skinType || "").trim().toUpperCase() === "LOG";
      const label = (!isLogPost && rawTitle) ? rawTitle : boardName;

      return `
        <a href="${boardUrl}" class="recent-item recent-update-item">
          <span class="recent-update-date">${escapeHtml(dateStr)}</span>
          <span class="recent-update-board">${escapeHtml(label)}</span>
        </a>
      `;
    }).join("");

    container.innerHTML = `<div class="grid tight">${postsHTML}</div>`;
  } catch (error) {
    console.error("최근 업데이트 로드 실패:", error);
    const container = document.getElementById("recentList");
    if (container) {
      container.innerHTML = '<div class="notice small">최근 글을 불러오는 중 오류가 발생했습니다.</div>';
    }
  }
}

export async function loadRecentTags() {
  try {
    const container = document.getElementById("recentTags");
    if (!container) return;

    const auth = await getAuthSnapshot();
    const posts = await getRecentHomePosts(auth.isAdmin);
    const tagCounts = new Map();
    posts.forEach((post) => {
      normalizePostTags(post.tags).forEach((tag) => {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      });
    });

    const topTags = [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag]) => tag);

    if (topTags.length === 0) {
      container.innerHTML = '<div class="notice small">태그가 없습니다.</div>';
      return;
    }

    const tagsHTML = topTags
      .map((tag) => `<a href="search.html?tag=${encodeURIComponent(tag)}" class="tag">${escapeHtml(tag)}</a>`)
      .join("");

    container.innerHTML = `<div class="tags-list">${tagsHTML}</div>`;
  } catch (error) {
    console.error("최근 태그 로드 실패:", error);
    const container = document.getElementById("recentTags");
    if (container) {
      container.innerHTML = '<div class="notice small">최근 태그를 불러오지 못했습니다.</div>';
    }
  }
}

function normalizePostTags(value) {
  const tags = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  return tags
    .map((tag) => String(tag || "").trim())
    .filter(Boolean);
}

function pickRandomHomeImage(images) {
  const list = Array.isArray(images)
    ? images.filter((item) => item && typeof item.url === "string" && item.url.trim())
    : [];
  if (!list.length) return null;
  const index = Math.floor(Math.random() * list.length);
  return list[index];
}

function getRecentDateValue(post) {
  const value = post?.updatedAt?.toDate ? post.updatedAt.toDate() : post?.updatedAt ? new Date(post.updatedAt) : null;
  if (value && !Number.isNaN(value.getTime())) return value;
  const createdAt = post?.createdAt?.toDate ? post.createdAt.toDate() : new Date(post?.createdAt || 0);
  return Number.isNaN(createdAt.getTime()) ? null : createdAt;
}

function getPostBoardId(post) {
  const candidates = [
    post?.boardId,
    post?.board,
    post?.bo,
    post?.board_id,
    post?.boardRef,
    post?.boardPath
  ];
  const raw = candidates.find((value) => String(value || "").trim());
  return String(raw || "").trim();
}

async function getRecentHomePosts(isAdmin) {
  const cacheKey = isAdmin ? "admin" : "public";
  if (recentPostsCache.has(cacheKey)) return recentPostsCache.get(cacheKey);
  if (recentPostsPromise.has(cacheKey)) return recentPostsPromise.get(cacheKey);

  const promise = (async () => {
    const postsCollection = collection(db, "posts");
    let snapshot;
    if (isAdmin) {
      snapshot = await getDocs(query(postsCollection, orderBy("updatedAt", "desc"), limit(30)));
    } else {
      try {
        snapshot = await getDocs(query(
          postsCollection,
          where("isPublic", "==", true),
          orderBy("updatedAt", "desc"),
          limit(30)
        ));
      } catch (error) {
        if (!isMissingIndexError(error)) throw error;
        console.warn("최근 글 복합 인덱스가 준비되지 않아 공개 글 조회로 대체합니다.", error);
        snapshot = await getDocs(query(postsCollection, where("isPublic", "==", true)));
      }
    }

    const posts = snapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .filter((post) => (isAdmin || post.isPublic !== false) && !isProfilePost(post))
      .sort((a, b) => getRecentPostTime(b) - getRecentPostTime(a))
      .slice(0, 30);
    recentPostsCache.set(cacheKey, posts);
    return posts;
  })().finally(() => {
    recentPostsPromise.delete(cacheKey);
  });

  recentPostsPromise.set(cacheKey, promise);
  return promise;
}

function isMissingIndexError(error) {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  return code.includes("failed-precondition") || message.includes("index");
}

function getRecentPostTime(post) {
  return getRecentDateValue(post)?.getTime() || 0;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = String(text ?? "");
  return div.innerHTML;
}
