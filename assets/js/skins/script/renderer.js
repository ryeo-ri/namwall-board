import { getBoardSkinOption, getPostSkinData } from "../registry.js";

export function renderScriptList(posts, board = {}, options = {}) {
  if (!Array.isArray(posts) || !posts.length) {
    return '<div class="notice">아직 백업된 플레이 로그가 없습니다.</div>';
  }

  const columns = clampNumber(getBoardSkinOption(board, "galleryColumns", 3), 1, 6, 3);
  return `
    <div class="script-list" style="--script-columns:${columns}" aria-label="TRPG 플레이 로그 목록">
      ${posts.map((post) => renderScriptCard(post, board, options)).join("")}
    </div>
  `;
}

export function renderScriptDetail(post = {}) {
  const script = normalizeScriptData(post);
  if (!script.archiveUrl) {
    return {
      imageHtml: renderSessionHero(post, script),
      contentHtml: '<div class="notice">연결된 플레이 로그 파일이 없습니다.</div>',
      sourceText: "",
      hideTags: false
    };
  }

  return {
    imageHtml: renderSessionHero(post, script),
    contentHtml: `
      <section class="script-reader" data-script-reader>
        <div class="script-reader-status" data-script-status>
          <span class="loading-indicator" role="status"><span class="sr-only">플레이 로그를 불러오는 중</span></span>
        </div>
        <div class="script-messages" data-script-messages></div>
        <button type="button" class="btn script-load-more hidden" data-script-more>더 보기</button>
        <div class="script-reader-sentinel hidden" data-script-sentinel aria-hidden="true"></div>
      </section>
    `,
    sourceText: "",
    hideTags: false
  };
}

function renderScriptCard(post, board, options) {
  const script = normalizeScriptData(post);
  const imageUrl = getSessionImageUrl(post);
  const deleteMode = Boolean(options.deleteMode);
  const selectedIds = new Set(options.selectedPostIds || []);
  const postId = String(post.id || "");
  const selected = selectedIds.has(postId);
  const title = post.title || script.scenario || "제목 없는 세션";
  const href = `view.html?id=${encodeURIComponent(postId)}&bo=${encodeURIComponent(post.boardId || board?.id || "script")}`;
  const facts = [script.system, script.scenario, formatDate(script.playedAt)].filter(Boolean);

  return `
    <article class="card script-card${deleteMode ? " is-delete-mode" : ""}${selected ? " is-delete-selected" : ""}" data-post-id="${escapeHtml(postId)}">
      <a class="script-card-link" href="${href}">
        <div class="script-card-cover">
          ${imageUrl
            ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(title)}" loading="lazy" decoding="async">`
            : '<div class="script-card-placeholder">SESSION LOG</div>'}
        </div>
        <div class="script-card-body">
          <div class="script-card-facts">${facts.map((fact) => `<span>${escapeHtml(fact)}</span>`).join("")}</div>
          <strong class="script-card-title">${escapeHtml(title)}</strong>
          ${script.players ? `<span class="script-card-players">${escapeHtml(script.players)}</span>` : ""}
        </div>
      </a>
      ${deleteMode ? `
        <label class="script-delete-check" aria-label="플레이 로그 선택">
          <input type="checkbox" data-board-select="${escapeHtml(postId)}" ${selected ? "checked" : ""}>
        </label>
      ` : ""}
    </article>
  `;
}

function renderSessionHero(post, script) {
  const title = post.title || script.scenario || "제목 없는 세션";
  const imageUrl = getSessionImageUrl(post);
  const facts = [
    ["RULE", script.system],
    ["SCENARIO", script.scenario],
    ["DATE", formatDate(script.playedAt)],
    ["GM / KP", script.gm],
    ["PL / PC", script.players]
  ].filter((entry) => entry[1]);
  return `
    <section class="script-session-hero">
      <div class="script-session-cover">
        ${imageUrl
          ? `
            <button
              type="button"
              class="script-session-image-button"
              data-lightbox-image="${escapeHtml(imageUrl)}"
              onclick="openLightbox(this.dataset.lightboxImage)"
              aria-label="${escapeHtml(`${title} 세션 이미지 원본 보기`)}"
            >
              <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(title)}" decoding="async">
            </button>
          `
          : '<div class="script-card-placeholder">SESSION LOG</div>'}
      </div>
      <div class="script-session-info">
        <span class="script-session-kicker">TRPG PLAY ARCHIVE</span>
        <div class="script-session-facts">
          ${facts.map(([label, value]) => `
            <div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>
          `).join("")}
        </div>
        ${script.summary ? `<p class="script-session-summary">${escapeHtml(script.summary).replace(/\r?\n/g, "<br>")}</p>` : ""}
      </div>
    </section>
  `;
}

function getSessionImageUrl(post = {}) {
  return String(post.thumbnailAttachment?.url || post.imageUrl || "").trim();
}

export function normalizeScriptData(post = {}) {
  const script = getPostSkinData(post).script || {};
  return {
    system: String(script.system || "").trim(),
    scenario: String(script.scenario || "").trim(),
    gm: String(script.gm || "").trim(),
    players: String(script.players || "").trim(),
    playedAt: String(script.playedAt || "").trim(),
    summary: String(script.summary || "").trim(),
    archiveUrl: String(script.archiveUrl || "").trim(),
    archiveEncoding: script.archiveEncoding === "gzip" ? "gzip" : "identity",
    messageCount: Number(script.messageCount) || 0,
    archivedAssetCount: Number(script.archivedAssetCount) || 0,
    archiveBytes: Number(script.archiveBytes) || 0
  };
}

function formatDate(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const date = new Date(`${text}T00:00:00`);
  return Number.isNaN(date.getTime()) ? text : date.toLocaleDateString("ko-KR");
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value || "");
  return div.innerHTML;
}
