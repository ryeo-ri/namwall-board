// 홈 — 히어로(소개 텍스트 + 대표 이미지) · 최근 업데이트 · 최근 태그 (원본 레이아웃)
// 로그인·관리자 진입은 헤더의 pill(login/admin)로 일원화 — 빠른 메뉴 카드는 제거함.
import { runQuery } from "../core/naru-client.js";
import { renderHeader, escapeHtml, formatDate, formatResponsiveWidth } from "../core/site.js";
import { sanitizeHTML } from "../shared/sanitizer.js";

async function init() {
  const boot = await renderHeader();

  renderHomeIntro(boot);
  await Promise.all([
    loadRecentUpdates(boot),
    loadRecentTags()
  ]);
  bindQuickSearch();
}

/* ── 히어로: 소개 텍스트 칼럼(옵션) + 대표 이미지(여러 장 중 랜덤) ── */
function renderHomeIntro(boot) {
  const container = document.getElementById("homeIntro");
  if (!container) return;
  const settings = boot.settings || {};

  const showText = settings.homeShowText === "1";
  const images = parseJson(settings.homeImages, []).filter((item) => item && item.url);
  const image = images.length ? images[Math.floor(Math.random() * images.length)] : null;
  const heroStyle = createHomeHeroStyle(settings);
  const imageAlt = settings.title || "홈 소개 이미지";

  applyHomeIntroWidth(container, settings, showText);
  applyHomeHeaderWidth(settings);
  container.classList.toggle("home-intro-image-only", !showText);
  container.classList.toggle("home-intro-with-copy", showText);
  container.innerHTML = `
    <section class="home-hero ${showText ? "home-hero-with-copy" : "home-hero-image-only"}" ${heroStyle ? `style="${heroStyle}"` : ""}>
      ${showText ? renderHomeCopy(settings) : ""}
      ${image ? `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(imageAlt)}" class="home-hero-image">` : `<div class="home-hero-placeholder"></div>`}
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

function applyHomeIntroWidth(container, settings, showText) {
  const copyWidth = showText ? Number(normalizePixelValue(settings.homeIntroWidth)) || 250 : 0;
  const width = Number(normalizePixelValue(settings.homeImageWidth));
  if (!container) return;
  if (!showText && (!Number.isFinite(width) || width <= 0)) {
    container.style.removeProperty("--home-intro-width");
    container.style.removeProperty("--home-copy-column");
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
  if (width) document.body.style.setProperty("--home-header-width", width);
  else document.body.style.removeProperty("--home-header-width");
}

function normalizePixelValue(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const number = Number(raw);
  if (!Number.isFinite(number)) return "";
  return String(Math.max(120, Math.min(2400, Math.round(number))));
}

/* ── 최근 업데이트 (원본: 날짜 + 제목/게시판명, LOG 글은 게시판명) ── */
async function loadRecentUpdates(boot) {
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

/* ── 최근 태그 ── */
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

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value || "");
    return parsed ?? fallback;
  } catch (_error) {
    return fallback;
  }
}

init();
