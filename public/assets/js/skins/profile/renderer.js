import { getPostCoverMedia, renderPostVideoFrame } from "../../shared/post-cover.js";
import { getPostSkinData } from "../registry.js";

export function renderProfileList(posts, board = {}, options = {}) {
  if (!Array.isArray(posts) || !posts.length) {
    return '<div class="notice">아직 프로필이 없습니다.</div>';
  }

  return `
    <div class="profile-list" aria-label="캐릭터 프로필 목록">
      ${posts.map((post) => renderProfileCard(post, board, options)).join("")}
    </div>
  `;
}

export function renderProfileView(post = {}, board = {}, options = {}) {
  if (!post?.id) {
    return {
      imageHtml: "",
      contentHtml: '<div class="notice">프로필 정보를 찾을 수 없습니다.</div>',
      sourceText: ""
    };
  }

  if (post.isSecret && options.secretUnlocked === false) {
    return {
      imageHtml: "",
      contentHtml: '<div class="notice">비밀번호가 일치하지 않아 내용을 표시할 수 없습니다.</div>',
      sourceText: ""
    };
  }

  const profile = normalizeProfile(post);
  const title = profile.nameKo || post.title || "(이름 없음)";
  const titleHtml = escapeHtml(title);
  const boardUrl = `/board.html?bo=${encodeURIComponent(post.boardId || board?.id || "board")}`;
  const mediaHtml = renderProfileMedia(post, title, "profile-hero-media");
  const headshotHtml = renderProfileHeadshot(profile.headImage, title, "profile-hero-headshot");
  const oneLine = renderTextBlock(profile.oneLine || post.contentText || "");
  const basicFacts = [
    renderFact("나이", profile.meta.age),
    renderFact("성별", profile.meta.gender),
    renderFact("키", profile.meta.height)
  ].filter(Boolean).join("");
  const detailPanels = [
    renderTextPanel("외형", profile.appearance),
    renderTextPanel("성격", profile.personality),
    renderTextPanel("기타", profile.etc)
  ].filter(Boolean).join("");
  const tagsHtml = renderTags(post.tags || []);

  return {
    imageHtml: `
      <section class="profile-hero card profile-view-hero">
        <div class="profile-hero-main">
          <div class="profile-hero-visual">
            <div class="profile-file-label">PROFILE BACKUP</div>
            ${mediaHtml || '<div class="profile-media-placeholder">전신 이미지가 없습니다.</div>'}
            ${headshotHtml}
          </div>
          <div class="profile-copy">
            <a class="profile-name-link" href="${boardUrl}">
              <span class="profile-panel-label">캐릭터 이름</span>
              <span class="profile-panel-title">${titleHtml}</span>
              ${profile.nameEn ? `<span class="profile-name-en">${escapeHtml(profile.nameEn)}</span>` : ""}
            </a>
            <div class="profile-view-quote">
              <div class="profile-panel-label">캐릭터 한마디</div>
              <div class="profile-quote-text">${oneLine || "한마디가 없습니다."}</div>
            </div>
            <div class="profile-meta-row">
              ${renderMetaChip("AGE", profile.meta.age)}
              ${renderMetaChip("GENDER", profile.meta.gender)}
              ${renderMetaChip("HEIGHT", profile.meta.height)}
            </div>
            ${tagsHtml}
          </div>
        </div>
        <div class="profile-hero-side">
          <div class="profile-panel profile-identity-panel">
            <span class="profile-panel-label">IDENTITY</span>
            <span class="profile-panel-title">${titleHtml}</span>
            ${profile.nameEn ? `<span class="profile-name-en">${escapeHtml(profile.nameEn)}</span>` : ""}
            <div class="profile-facts profile-view-facts">
              ${basicFacts || '<div class="profile-muted">기본 정보가 없습니다.</div>'}
            </div>
          </div>
        </div>
      </section>
    `,
    contentHtml: detailPanels ? `
      <div class="profile-facts profile-view-sections">
        ${detailPanels}
      </div>
    ` : '<div class="notice">상세 정보가 아직 없습니다.</div>',
    sourceText: getPostSkinData(post).source ? `출처: ${getPostSkinData(post).source}` : ""
  };
}

function renderProfileCard(post, board, options) {
  const profile = normalizeProfile(post);
  const title = profile.nameKo || post.title || "(이름 없음)";
  const titleHtml = escapeHtml(title);
  const date = formatDate(post.createdAt);
  const boardUrl = `/view.html?id=${encodeURIComponent(post.id)}&bo=${encodeURIComponent(post.boardId || board?.id || "board")}`;
  const mediaHtml = renderProfileMedia(post, title, "profile-card-media");
  const headshotHtml = renderProfileHeadshot(profile.headImage, title, "profile-card-headshot");
  const oneLine = renderTextBlock(profile.oneLine || post.contentText || "");
  const facts = [
    renderFact("외형", profile.appearance),
    renderFact("성격", profile.personality),
    renderFact("기타", profile.etc)
  ].filter(Boolean).join("");

  return `
    <article class="card profile-card" data-post-id="${escapeHtml(String(post.id || ""))}">
      <div class="profile-card-spine">CHARACTER FILE</div>
      <div class="profile-card-grid">
        <div class="profile-card-visual">
          <div class="profile-file-label">BACKUP</div>
          ${mediaHtml || '<div class="profile-media-placeholder">전신 이미지가 없습니다.</div>'}
          ${headshotHtml}
        </div>
        <div class="profile-card-body">
          <div class="profile-card-top">
            <span class="profile-card-date">${escapeHtml(date)}</span>
          </div>
          <div class="profile-card-head">
            <div class="profile-card-head-copy">
              <span class="profile-panel-label">CHARACTER</span>
              <a class="profile-card-title" href="${boardUrl}">${titleHtml}</a>
              ${profile.nameEn ? `<div class="profile-name-en">${escapeHtml(profile.nameEn)}</div>` : ""}
            </div>
          </div>
          ${oneLine ? `<div class="profile-card-quote"><span class="profile-quote-mark">"</span>${oneLine}</div>` : ""}
          <div class="profile-meta-row profile-card-meta">
            ${renderMetaChip("AGE", profile.meta.age)}
            ${renderMetaChip("GENDER", profile.meta.gender)}
            ${renderMetaChip("HEIGHT", profile.meta.height)}
          </div>
          ${facts ? `<div class="profile-facts profile-card-facts">${facts}</div>` : ""}
          ${renderTags(post.tags || [])}
        </div>
      </div>
    </article>
  `;
}

function normalizeProfile(post = {}) {
  const skinData = getPostSkinData(post);
  const profile = skinData.profile || post.profile || {};
  const meta = profile.meta || {};
  const title = profile.nameKo || post.title || "";
  return {
    nameKo: String(title || "").trim(),
    nameEn: String(profile.nameEn || "").trim(),
    fullBodyImage: String(profile.fullBodyImage || post.imageUrl || post.thumbnailAttachment?.url || "").trim(),
    headImage: String(profile.headImage || "").trim(),
    oneLine: toPlainText(profile.oneLine || post.contentText || post.contentHtml || post.commentHtml || ""),
    meta: {
      age: String(meta.age || profile.age || "").trim(),
      gender: String(meta.gender || profile.gender || "").trim(),
      height: String(meta.height || profile.height || "").trim()
    },
    appearance: String(profile.appearance || "").trim(),
    personality: String(profile.personality || "").trim(),
    etc: String(profile.etc || "").trim()
  };
}

function renderProfileMedia(post, title, className = "") {
  const cover = getPostCoverMedia(post);
  const profile = getPostSkinData(post).profile || {};
  const alt = escapeHtml(`${title} 전신 이미지`);
  const extraClass = className ? ` ${className}` : "";

  if (cover.mode === "video" && cover.embedHtml) {
    return `
      <div class="profile-media-video${extraClass}">
        ${renderPostVideoFrame(cover.embedHtml, "profile-media-video-frame")}
      </div>
    `;
  }

  const imageUrl = cover.imageUrl || cover.previewUrl || profile.fullBodyImage || "";
  if (!imageUrl) return "";

  return `
    <button
      type="button"
      class="profile-media-button${extraClass}"
      data-lightbox-image="${escapeHtml(imageUrl)}"
      onclick="openLightbox('${escapeJsString(imageUrl)}')"
      aria-label="${escapeHtml(`${title} 전신 이미지 보기`)}"
    >
      <img src="${escapeHtml(imageUrl)}" alt="${alt}" loading="lazy" class="profile-media-image">
    </button>
  `;
}

function renderProfileHeadshot(imageUrl, title, className = "") {
  const extraClass = className ? ` ${className}` : "";
  const fallback = renderFallbackInitials(title);

  if (!imageUrl) {
    return `<div class="profile-avatar${extraClass}">${fallback}</div>`;
  }

  return `
    <div class="profile-avatar${extraClass}">
      <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(`${title} 두상`)}" loading="lazy">
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

function renderFact(label, value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return `
    <div class="profile-fact">
      <span class="profile-panel-label">${escapeHtml(label)}</span>
      <div class="profile-panel-title">${renderTextBlock(text)}</div>
    </div>
  `;
}

function renderTextPanel(label, value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return `
    <div class="profile-panel">
      <span class="profile-panel-label">${escapeHtml(label)}</span>
      <div class="profile-panel-title">${renderTextBlock(text)}</div>
    </div>
  `;
}

function renderTags(tags) {
  const list = Array.isArray(tags) ? tags.map((tag) => String(tag || "").trim()).filter(Boolean) : [];
  if (!list.length) return "";
  return `
    <div class="profile-card-tags">
      ${list.map((tag) => `<a class="tag" href="/search.html?tag=${encodeURIComponent(tag)}">${escapeHtml(tag)}</a>`).join("")}
    </div>
  `;
}

function renderTextBlock(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return escapeHtml(text).replace(/\r?\n/g, "<br>");
}

function renderFallbackInitials(value) {
  const letters = Array.from(String(value || "").trim()).filter(Boolean);
  if (!letters.length) return "PR";
  return escapeHtml(letters.slice(0, 2).join(""));
}

function formatDate(createdAt) {
  const value = createdAt?.toDate ? createdAt.toDate() : (createdAt ? new Date(createdAt) : new Date());
  return Number.isNaN(value.getTime()) ? "" : value.toLocaleDateString("ko-KR");
}

function toPlainText(value) {
  const text = String(value || "").replace(/<br\s*\/?>/gi, "\n");
  const temp = document.createElement("div");
  temp.innerHTML = text;
  return temp.textContent?.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim() || "";
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = String(text || "");
  return div.innerHTML;
}

function escapeJsString(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
}
