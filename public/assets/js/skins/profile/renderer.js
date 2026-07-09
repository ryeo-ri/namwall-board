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
  const mediaHtml = renderProfileMedia(post, title, "profile-hero-media", { preferFullBody: true });
  const oneLine = renderTextBlock(getPostSkinData(post).profile?.oneLine || post.contentText || "");
  const tagChips = (post.tags || [])
    .map((tag) => String(tag || "").trim())
    .filter(Boolean)
    .map((tag) => `<a class="tag" href="/search.html?tag=${encodeURIComponent(tag)}">${escapeHtml(tag)}</a>`)
    .join("");
  const namecardPhoto = profile.headImage
    ? `<button type="button" class="profile-namecard-photo profile-namecard-photo-button" onclick="openLightbox('${escapeJsString(profile.headImage)}')" aria-label="${escapeHtml(`${title} 두상 원본 보기`)}"><img src="${escapeHtml(profile.headImage)}" alt="${escapeHtml(`${title} 두상`)}" loading="lazy"></button>`
    : "";
  const namecardMeta = [
    ["나이", profile.meta.age],
    ["성별", profile.meta.gender],
    ["키", profile.meta.height]
  ].filter((pair) => pair[1])
    .map((pair) => `<div class="profile-namecard-fact"><span class="profile-namecard-key">${pair[0]}</span><span class="profile-namecard-val">${escapeHtml(pair[1])}</span></div>`)
    .join("");
  const extraImagesHtml = renderProfileExtraImages(post);
  const detailPanels = [
    renderTextPanel("외형", profile.appearance),
    renderTextPanel("성격", profile.personality),
    renderTextPanel("기타", profile.etc, { allowHtml: profile.etcIsHtml })
  ].filter(Boolean).join("");

  return {
    imageHtml: `
      <section class="profile-hero card profile-view-hero">
        <div class="profile-hero-main">
          <div class="profile-hero-visual">
            <div class="profile-file-label">PROFILE</div>
            ${mediaHtml || '<div class="profile-media-placeholder">전신 이미지가 없습니다.</div>'}
          </div>
          <div class="profile-copy">
            <div class="profile-namecard">
              ${oneLine ? `<p class="profile-namecard-quote">${oneLine}</p>` : ""}
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
    `,
    contentHtml: detailPanels ? `
      <div class="profile-facts profile-view-sections">
        ${detailPanels}
      </div>
    ` : '<div class="notice">상세 정보가 아직 없습니다.</div>',
    sourceText: getPostSkinData(post).source ? `출처: ${getPostSkinData(post).source}` : ""
  };
}

function isProfileImageAttachment(item) {
  if (!item || !item.url) return false;
  if (String(item.mode || "").toLowerCase() === "video") return false;
  const mime = String(item.mimeType || "").toLowerCase();
  if (mime.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|svg|avif)(\?|#|$)/i.test(String(item.url));
}

function renderProfileExtraImages(post) {
  const attachments = Array.isArray(post?.extraAttachments) ? post.extraAttachments : [];
  const images = attachments.filter(isProfileImageAttachment);
  if (!images.length) return "";

  const thumbs = images.map((item) => {
    const url = String(item.url || "").trim();
    const alt = escapeHtml(item.name || "추가 이미지");
    return `
      <button type="button" class="profile-extra-thumb" onclick="openLightbox('${escapeJsString(url)}')" aria-label="${alt} 원본 보기">
        <img src="${escapeHtml(url)}" alt="${alt}" loading="lazy">
      </button>
    `;
  }).join("");

  return `
    <div class="profile-extra">
      <span class="profile-panel-label">추가 이미지</span>
      <div class="profile-extra-grid">${thumbs}</div>
    </div>
  `;
}

function renderProfileCard(post, board, options) {
  const deleteMode = Boolean(options.deleteMode);
  const selectedPostIds = new Set(options.selectedPostIds || []);
  const profile = normalizeProfile(post);
  const title = profile.nameKo || post.title || "(이름 없음)";
  const titleHtml = escapeHtml(title);
  const boardUrl = `/view.html?id=${encodeURIComponent(post.id)}&bo=${encodeURIComponent(post.boardId || board?.id || "board")}`;
  const mediaHtml = renderProfileCardMedia(post, title);
  const postId = String(post.id || "");
  const safePostId = escapeHtml(postId);
  const isSelected = selectedPostIds.has(postId);
  const nameEnHtml = profile.nameEn ? `<span class="profile-name-en">${escapeHtml(profile.nameEn)}</span>` : "";
  const metaChips = [
    renderMetaChip("AGE", profile.meta.age),
    renderMetaChip("GENDER", profile.meta.gender),
    renderMetaChip("HEIGHT", profile.meta.height)
  ].join("");
  const oneLineHtml = profile.oneLine ? `<p class="profile-card-quote">${escapeHtml(profile.oneLine)}</p>` : "";

  return `
    <article class="card profile-card${deleteMode ? " profile-card-delete-mode" : ""}${isSelected ? " is-delete-selected" : ""}" data-post-id="${safePostId}">
      <a class="profile-card-link" href="${boardUrl}" aria-label="${escapeHtml(`${title} 프로필 보기`)}">
        <div class="profile-card-media">
          ${mediaHtml || '<div class="profile-media-placeholder">대표이미지가 없습니다.</div>'}
        </div>
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
      ${deleteMode ? `
        <label class="profile-delete-check" aria-label="프로필 선택">
          <input type="checkbox" data-board-select="${safePostId}" ${isSelected ? "checked" : ""}>
        </label>
      ` : ""}
    </article>
  `;
}

function renderProfileCardMedia(post, title) {
  const cover = getPostCoverMedia(post);
  const imageUrl = cover.imageUrl || cover.previewUrl || "";
  if (!imageUrl) return "";

  return `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(title)}" loading="lazy" class="profile-media-image">`;
}

function normalizeProfile(post = {}) {
  const skinData = getPostSkinData(post);
  const profile = skinData.profile || post.profile || {};
  const meta = profile.meta || {};
  const title = profile.nameKo || post.title || "";
  return {
    nameKo: String(title || "").trim(),
    nameEn: String(profile.nameEn || "").trim(),
    fullBodyImage: String(profile.fullBodyImage || "").trim(),
    headImage: String(profile.headImage || "").trim(),
    oneLine: toPlainText(profile.oneLine || post.contentText || post.contentHtml || post.commentHtml || ""),
    meta: {
      age: String(meta.age || profile.age || "").trim(),
      gender: String(meta.gender || profile.gender || "").trim(),
      height: String(meta.height || profile.height || "").trim()
    },
    appearance: String(profile.appearance || "").trim(),
    personality: String(profile.personality || "").trim(),
    etc: String(profile.etc || "").trim(),
    etcIsHtml: profile.etcIsHtml === true
  };
}

function renderProfileMedia(post, title, className = "", options = {}) {
  const preferFullBody = options.preferFullBody === true;
  const cover = getPostCoverMedia(post);
  const profile = getPostSkinData(post).profile || {};
  const kind = preferFullBody ? "전신 이미지" : "대표 이미지";
  const alt = escapeHtml(`${title} ${kind}`);
  const extraClass = className ? ` ${className}` : "";

  if (!preferFullBody && cover.mode === "video" && cover.embedHtml) {
    return `
      <div class="profile-media-video${extraClass}">
        ${renderPostVideoFrame(cover.embedHtml, "profile-media-video-frame")}
      </div>
    `;
  }

  const imageUrl = preferFullBody
    ? (profile.fullBodyImage || "")
    : (cover.imageUrl || cover.previewUrl || profile.fullBodyImage || "");
  if (!imageUrl) return "";

  return `
    <button
      type="button"
      class="profile-media-button${extraClass}"
      data-lightbox-image="${escapeHtml(imageUrl)}"
      onclick="openLightbox('${escapeJsString(imageUrl)}')"
      aria-label="${escapeHtml(`${title} ${kind} 보기`)}"
    >
      <img src="${escapeHtml(imageUrl)}" alt="${alt}" loading="lazy" class="profile-media-image">
    </button>
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
  const bodyHtml = options.allowHtml ? text : renderTextBlock(text);
  return `
    <div class="profile-panel">
      <span class="profile-panel-label">${escapeHtml(label)}</span>
      <div class="profile-panel-title">${bodyHtml}</div>
    </div>
  `;
}

function renderTextBlock(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return escapeHtml(text).replace(/\r?\n/g, "<br>");
}

function toPlainText(value) {
  const text = String(value || "").replace(/<br\s*\/?>/gi, "\n");
  if (typeof document === "undefined") {
    return text.replace(/<[^>]*>/g, "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }
  const temp = document.createElement("div");
  temp.innerHTML = text;
  return temp.textContent?.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim() || "";
}

function escapeHtml(text) {
  if (typeof document === "undefined") {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  const div = document.createElement("div");
  div.textContent = String(text || "");
  return div.innerHTML;
}

function escapeJsString(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
}
