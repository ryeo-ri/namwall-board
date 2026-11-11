// NARU BOARD Copyright (c) 2026 NAMWALL — MPL-2.0 (https://mozilla.org/MPL/2.0/)
// 홈 — 히어로(소개 글 + 대표 이미지) · 최근 업데이트 · 로그인 창 · 검색 · 최근 태그
import { runQuery, signInMember, signOutMember, naruErrorMessage } from "../core/naru-client.js";
import { renderHeader, clearSiteCache, escapeHtml, formatDate, renderSourceLinks, parseHomeImages } from "../core/site.js";
import { sanitizeHTML } from "../shared/sanitizer.js";

async function init() {
  const boot = await renderHeader();

  renderHomeIntro(boot);
  const visible = applyHomeMenuVisibility(boot.settings || {});
  if (visible.login) renderHomeLogin(boot);
  await Promise.all([
    visible.recent ? loadRecentUpdates() : null,
    visible.tags ? loadRecentTags() : null
  ]);
  if (visible.search) bindQuickSearch();
}

// 하단 메뉴 노출 — 설정이 없으면 로그인 창만 꺼져 있고 나머지는 보인다
function applyHomeMenuVisibility(settings) {
  const recent = settings.homeShowRecent !== "0";
  const search = settings.homeShowSearch !== "0";
  const tags = settings.homeShowTags !== "0";
  const login = settings.homeShowLogin === "1";

  document.getElementById("homeRecentCard")?.classList.toggle("hidden", !recent);
  document.getElementById("homeLoginBlock")?.classList.toggle("hidden", !login);
  document.getElementById("homeSearchBlock")?.classList.toggle("hidden", !search);
  document.getElementById("homeTagsBlock")?.classList.toggle("hidden", !tags);
  document.querySelector("#homeTagsBlock .sep")?.classList.toggle("hidden", !search);
  document.getElementById("homeLoginSep")?.classList.toggle("hidden", !(search || tags));

  const asideVisible = search || tags || login;
  document.getElementById("homeAsideCard")?.classList.toggle("hidden", !asideVisible);

  const grid = document.getElementById("homeMenuGrid");
  if (grid) {
    const bothHidden = !recent && !asideVisible;
    grid.classList.toggle("hidden", bothHidden);
    grid.style.gridTemplateColumns = (recent && asideVisible) ? "" : "minmax(0, 1fr)";
  }
  return { recent, search, tags, login };
}

// 로그인 창 — 비로그인: 로그인·관리자 로그인 / 회원: 닉네임·로그아웃(관리자면 관리자 메뉴 추가)
function renderHomeLogin(boot) {
  const body = document.getElementById("homeLoginBody");
  if (!body) return;
  const adminButton = boot.owner
    ? '<a class="btn small" href="admin.html">관리자 메뉴</a>'
    : '<a class="btn small" href="admin.html">관리자 로그인</a>';
  if (boot.me) {
    body.innerHTML = `
      <span class="home-login-name">${escapeHtml(boot.me.nickname || "회원")}</span>
      ${boot.owner ? adminButton : ""}
      <button type="button" class="btn small" id="homeLogoutBtn">로그아웃</button>
    `;
    document.getElementById("homeLogoutBtn")?.addEventListener("click", async () => {
      if (!window.confirm("회원 로그아웃할까요?")) return;
      await signOutMember();
      clearSiteCache();
      location.reload();
    });
    return;
  }
  body.innerHTML = `
    <button type="button" class="btn primary small" id="homeLoginBtn" style="flex:1 1 auto">로그인</button>
    ${adminButton}
  `;
  document.getElementById("homeLoginBtn")?.addEventListener("click", () => {
    signInMember().catch((error) => window.alert(naruErrorMessage(error, "로그인을 시작하지 못했습니다.")));
  });
}

// 히어로: 소개 글 칼럼(옵션) + 대표 이미지(여러 장 중 랜덤)
function renderHomeIntro(boot) {
  const container = document.getElementById("homeIntro");
  if (!container) return;
  const settings = boot.settings || {};

  const showText = settings.homeShowText === "1";
  const images = parseHomeImages(settings.homeImages);
  const image = images.length ? images[Math.floor(Math.random() * images.length)] : null;
  const heroStyle = createHomeHeroStyle(settings);
  const imageAlt = settings.title || "홈 소개 이미지";

  applyHomeIntroWidth(container, settings, showText, Boolean(image));
  container.classList.toggle("home-intro-image-only", !showText);
  container.classList.toggle("home-intro-with-copy", showText);
  // 이미지가 없으면 소개 글이 한 칸을 다 쓰고, 둘 다 없으면 히어로를 그리지 않는다
  if (!showText && !image) {
    container.innerHTML = "";
    return;
  }
  const heroClass = !showText ? "home-hero-image-only" : (image ? "home-hero-with-copy" : "home-hero-copy-only");
  const source = image ? renderSourceLinks(image.source) : "";
  container.innerHTML = `
    <section class="home-hero ${heroClass}" ${heroStyle ? `style="${heroStyle}"` : ""}>
      ${showText ? renderHomeCopy(settings) : ""}
      ${image ? `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(imageAlt)}" class="home-hero-image">` : ""}
      ${source ? `<p class="home-hero-source">${source}</p>` : ""}
    </section>
  `;
}

function renderHomeCopy(settings) {
  const siteTitle = String(settings.title || "NARU BOARD").trim();
  const introHtml = String(settings.intro || "").trim();
  const safeIntro = sanitizeHTML(introHtml, { allowIframes: true });
  return `
    <div class="home-hero-copy">
      ${siteTitle ? `<p class="home-hero-eyebrow">${escapeHtml(siteTitle)}</p>` : ""}
      ${safeIntro ? `<div class="home-hero-intro">${safeIntro}</div>` : ""}
    </div>
  `;
}

// 홈 폭 = 대표 이미지 폭(+ 소개 글 칼럼). 이미지가 없고 최근 업데이트도 꺼져 있으면 소개 글 폭으로 좁힌다
const NARROW_HOME_MIN_WIDTH = 400;
function applyHomeIntroWidth(container, settings, showText, hasImage) {
  const copyWidth = showText ? Number(normalizePixelValue(settings.homeIntroWidth)) || 250 : 0;
  const width = Number(normalizePixelValue(settings.homeImageWidth));
  const recentVisible = settings.homeShowRecent !== "0";
  if (!container) return;
  const useDefaultWidth = hasImage
    ? !showText && (!Number.isFinite(width) || width <= 0)
    : recentVisible;
  if (useDefaultWidth) {
    container.style.removeProperty("--home-intro-width");
    container.style.removeProperty("--home-copy-column");
    document.body?.style.removeProperty("--home-main-width");
    return;
  }

  const heroChromeWidth = showText ? 58 : 0;
  const introWidth = hasImage
    ? (Number.isFinite(width) && width > 0 ? width : 400) + copyWidth + heroChromeWidth
    : Math.max(copyWidth + heroChromeWidth, NARROW_HOME_MIN_WIDTH);
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

function normalizePixelValue(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const number = Number(raw);
  if (!Number.isFinite(number)) return "";
  return String(Math.max(120, Math.min(2400, Math.round(number))));
}

// 최근 업데이트: 날짜 + 제목 (제목 없는 글·LOG 글은 게시판명)
async function loadRecentUpdates() {
  const container = document.getElementById("recentList");
  if (!container) return;
  try {
    const items = await runQuery("board:recent", { size: 5 });
    if (!items.length) {
      container.innerHTML = '<div class="notice small">아직 게시물이 없습니다.</div>';
      return;
    }
    container.innerHTML = `<div class="grid tight">${items.map((item) => {
      const isLog = String(item.skin || "").toUpperCase() === "LOG";
      const rawTitle = String(item.title || "").trim();
      const label = (!isLog && rawTitle) ? rawTitle : (item.boardTitle || item.boardId);
      return `
        <a href="board.html?bo=${encodeURIComponent(item.boardId)}" class="recent-item recent-update-item">
          <span class="recent-update-date">${escapeHtml(formatDate(item.createdAt))}</span>
          <span class="recent-update-board recent-update-title">${escapeHtml(label)}</span>
        </a>
      `;
    }).join("")}</div>`;
  } catch (_error) {
    container.innerHTML = '<div class="notice small">최근 글을 불러오는 중 오류가 발생했습니다.</div>';
  }
}

async function loadRecentTags() {
  const container = document.getElementById("recentTags");
  if (!container) return;
  try {
    const tags = await runQuery("board:recentTags");
    if (!tags.length) {
      container.innerHTML = '<div class="notice small">태그가 없습니다.</div>';
      return;
    }
    container.innerHTML = `<div class="tags-list">${tags
      .map((tag) => `<a href="search.html?tag=${encodeURIComponent(tag)}" class="tag">${escapeHtml(tag)}</a>`)
      .join("")}</div>`;
  } catch (_error) {
    container.innerHTML = '<div class="notice small">최근 태그를 불러오지 못했습니다.</div>';
  }
}

function bindQuickSearch() {
  const input = document.getElementById("quickTag");
  const go = () => {
    const tag = (input?.value || "").trim();
    if (!tag) return;
    location.href = `search.html?tag=${encodeURIComponent(tag)}`;
  };
  document.getElementById("quickSearchBtn")?.addEventListener("click", go);
  input?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") go();
  });
}

init();
