// NARU BOARD Copyright (c) 2026 NAMWALL — MPL-2.0 (https://mozilla.org/MPL/2.0/)
// PROFILE 스킨 — 캐릭터 프로필
// 목록 = 호버 오버레이 카드, 상세 = 전신 이미지 + 네임카드 + 외형/성격/기타 패널
import { escapeHtml, clampColumns } from "../core/site.js";
import { sanitizeHTML } from "../shared/sanitizer.js";

function getProfileData(post = {}) {
  const profile = (post.skinData && typeof post.skinData === "object" ? post.skinData.profile : null) || {};
  const meta = profile.meta && typeof profile.meta === "object" ? profile.meta : {};
  return {
    nameKo: String(post.title || "").trim(),
    nameEn: String(profile.nameEn || "").trim(),
    fullBodyImage: String(profile.fullBodyImage || "").trim(),
    headImage: String(profile.headImage || "").trim(),
    oneLine: String(profile.oneLine || "").trim(),
    meta: {
      age: String(meta.age || "").trim(),
      gender: String(meta.gender || "").trim(),
      height: String(meta.height || "").trim()
    },
    appearance: String(profile.appearance || "").trim(),
    personality: String(profile.personality || "").trim(),
    etc: String(profile.etc || "").trim(),
    etcIsHtml: profile.etcIsHtml === true
  };
}

// 목록: 카드 그리드 (호버하면 한마디·메타 표시)
export function renderProfileList(posts, board = {}) {
  if (!Array.isArray(posts) || !posts.length) {
    return '<div class="notice">아직 프로필이 없습니다.</div>';
  }
  const columns = clampColumns(board?.options?.galleryColumns, 4);
  return `
    <div class="profile-list" style="--profile-columns:${columns}" aria-label="캐릭터 프로필 목록">
      ${posts.map((post) => renderProfileCard(post, board)).join("")}
    </div>
  `;
}

function renderProfileCard(post, board) {
  const profile = getProfileData(post);
  const title = profile.nameKo || "(이름 없음)";
  const titleHtml = escapeHtml(title);
  const url = `view.html?id=${encodeURIComponent(post.id)}&bo=${encodeURIComponent(board?.id || "")}`;
  const cover = String(post.thumb || "").trim();
  const mediaHtml = cover
    ? `<img src="${escapeHtml(cover)}" alt="${titleHtml}" loading="lazy" class="profile-media-image">`
    : '<div class="profile-media-placeholder">대표이미지가 없습니다.</div>';
  const nameEnHtml = profile.nameEn ? `<span class="profile-name-en">${escapeHtml(profile.nameEn)}</span>` : "";
  const metaChips = [
    renderMetaChip("AGE", profile.meta.age),
    renderMetaChip("GENDER", profile.meta.gender),
    renderMetaChip("HEIGHT", profile.meta.height)
  ].join("");
  const oneLineHtml = profile.oneLine ? `<p class="profile-card-quote">${escapeHtml(profile.oneLine)}</p>` : "";

  return `
    <article class="card profile-card" data-post-id="${post.id}">
      <a class="profile-card-link" href="${url}" aria-label="${escapeHtml(`${title} 프로필 보기`)}">
        <div class="profile-card-media">${mediaHtml}</div>
        <div class="profile-card-namebar">
          <span class="profile-card-name">${titleHtml}</span>
          ${nameEnHtml}
        </div>
        <div class="profile-card-overlay">
          ${oneLineHtml}
          <span class="profile-card-name">${titleHtml}</span>
          ${nameEnHtml}
          ${metaChips ? `<div class="profile-meta-row profile-card-meta">${metaChips}</div>` : ""}
        </div>
      </a>
    </article>
  `;
}

// 상세: 전신 이미지 + 네임카드 (viewImage 자리)
export function renderProfileHero(post = {}) {
  const profile = getProfileData(post);
  const title = profile.nameKo || "(이름 없음)";
  const titleHtml = escapeHtml(title);

  const fullBody = profile.fullBodyImage || String(post.thumb || "").trim();
  const mediaHtml = fullBody
    ? `
      <button
        type="button"
        class="profile-media-button profile-hero-media"
        data-lightbox-image="${escapeHtml(fullBody)}"
        aria-label="${escapeHtml(`${title} 전신 이미지 보기`)}"
      >
        <img src="${escapeHtml(fullBody)}" alt="${escapeHtml(`${title} 전신 이미지`)}" loading="lazy" class="profile-media-image">
      </button>
    `
    : '<div class="profile-media-placeholder">전신 이미지가 없습니다.</div>';

  const namecardPhoto = profile.headImage
    ? `<button type="button" class="profile-namecard-photo profile-namecard-photo-button" data-lightbox-image="${escapeHtml(profile.headImage)}" aria-label="${escapeHtml(`${title} 두상 원본 보기`)}"><img src="${escapeHtml(profile.headImage)}" alt="${escapeHtml(`${title} 두상`)}" loading="lazy"></button>`
    : "";
  const namecardMeta = [
    ["나이", profile.meta.age],
    ["성별", profile.meta.gender],
    ["키", profile.meta.height]
  ].filter((pair) => pair[1])
    .map((pair) => `<div class="profile-namecard-fact"><span class="profile-namecard-key">${pair[0]}</span><span class="profile-namecard-val">${escapeHtml(pair[1])}</span></div>`)
    .join("");
  const tagChips = (post.tags || [])
    .map((tag) => String(tag || "").trim())
    .filter(Boolean)
    .map((tag) => `<a class="tag" href="search.html?tag=${encodeURIComponent(tag)}">${escapeHtml(tag)}</a>`)
    .join("");
  const extraImagesHtml = renderProfileExtraImages(post);

  return `
    <section class="profile-hero card profile-view-hero">
      <div class="profile-hero-main">
        <div class="profile-hero-visual">
          <div class="profile-file-label">PROFILE</div>
          ${mediaHtml}
        </div>
        <div class="profile-copy">
          <div class="profile-namecard">
            ${profile.oneLine ? `<p class="profile-namecard-quote">${escapeHtml(profile.oneLine).replace(/\r?\n/g, "<br>")}</p>` : ""}
            <div class="profile-namecard-main${profile.headImage ? "" : " profile-namecard-main-no-photo"}">
              ${namecardPhoto}
              <div class="profile-namecard-body">
                <span class="profile-namecard-name">${titleHtml}</span>
                ${profile.nameEn ? `<span class="profile-name-en">${escapeHtml(profile.nameEn)}</span>` : ""}
                ${namecardMeta ? `<div class="profile-namecard-meta">${namecardMeta}</div>` : ""}
              </div>
            </div>
            ${tagChips ? `<div class="profile-namecard-tags">${tagChips}</div>` : ""}
          </div>
          ${extraImagesHtml}
        </div>
      </div>
    </section>
  `;
}

// 상세: 외형/성격/기타 패널 (viewContent 자리)
export function renderProfilePanels(post = {}) {
  const profile = getProfileData(post);
  const panels = [
    renderTextPanel("외형", profile.appearance),
    renderTextPanel("성격", profile.personality),
    renderTextPanel("기타", profile.etc, { allowHtml: profile.etcIsHtml })
  ].filter(Boolean).join("");
  return panels
    ? `<div class="profile-facts profile-view-sections">${panels}</div>`
    : '<div class="notice">상세 정보가 아직 없습니다.</div>';
}

// 추가 이미지 썸네일 그리드
function renderProfileExtraImages(post) {
  const images = (Array.isArray(post.images) ? post.images : []).filter(Boolean);
  if (!images.length) return "";
  const thumbs = images.map((url, index) => `
    <button type="button" class="profile-extra-thumb" data-lightbox-image="${escapeHtml(url)}" aria-label="추가 이미지 ${index + 1} 원본 보기">
      <img src="${escapeHtml(url)}" alt="추가 이미지 ${index + 1}" loading="lazy">
    </button>
  `).join("");
  return `
    <div class="profile-extra">
      <span class="profile-panel-label">추가 이미지</span>
      <div class="profile-extra-grid">${thumbs}</div>
    </div>
  `;
}

function renderMetaChip(label, value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return `
    <span class="profile-chip">
      <span class="profile-chip-label">${escapeHtml(label)}</span>
      <span>${escapeHtml(text)}</span>
    </span>
  `;
}

function renderTextPanel(label, value, options = {}) {
  const text = String(value || "").trim();
  if (!text) return "";
  const bodyHtml = options.allowHtml
    ? sanitizeHTML(text, { allowIframes: true })
    : escapeHtml(text).replace(/\r?\n/g, "<br>");
  return `
    <div class="profile-panel">
      <span class="profile-panel-label">${escapeHtml(label)}</span>
      <div class="profile-panel-title">${bodyHtml}</div>
    </div>
  `;
}
