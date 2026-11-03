// SCRIPT 스킨 — TRPG 플레이 로그 (원본 namwall script 스킨 이식: 뷰어 쪽)
// 목록 = 세션 카드 그리드, 상세 = 세션 정보(hero) + 아카이브 뷰어.
// 아카이브(JSON, 나루 미디어에 저장)를 내려받아 메시지를 300개씩 끊어 그린다.
import { escapeHtml } from "../core/site.js";

const CHUNK_SIZE = 300;
const SUPPORTED_ARCHIVE_VERSION = 1;
const MESSAGE_KINDS = ["general", "whisper", "desc", "emote", "rollresult", "rolltemplate"];

export function getScriptData(post = {}) {
  const script = (post.skinData && typeof post.skinData === "object" ? post.skinData.script : null) || {};
  return {
    system: String(script.system || "").trim(),
    scenario: String(script.scenario || "").trim(),
    gm: String(script.gm || "").trim(),
    players: String(script.players || "").trim(),
    playedAt: String(script.playedAt || "").trim(),
    summary: String(script.summary || "").trim(),
    archiveUrl: String(script.archiveUrl || "").trim(),
    messageCount: Number(script.messageCount) || 0,
    assetCount: Number(script.assetCount) || 0,
    archivedAssetCount: Number(script.archivedAssetCount) || 0,
    archiveBytes: Number(script.archiveBytes) || 0,
    sourceType: String(script.sourceType || "").trim(),
    sourceFileName: String(script.sourceFileName || "").trim()
  };
}

/* ── 목록: 세션 카드 그리드 ── */
export function renderScriptList(posts, board = {}) {
  if (!Array.isArray(posts) || !posts.length) {
    return '<div class="notice">아직 백업된 플레이 로그가 없습니다.</div>';
  }
  const columns = clampNumber(board?.options?.galleryColumns, 1, 6, 3);
  return `
    <div class="script-list" style="--script-columns:${columns}" aria-label="TRPG 플레이 로그 목록">
      ${posts.map((post) => renderScriptCard(post, board)).join("")}
    </div>
  `;
}

function renderScriptCard(post, board) {
  const script = getScriptData(post);
  const imageUrl = String(post.thumb || "").trim();
  const title = post.title || script.scenario || "제목 없는 세션";
  const href = `view.html?id=${encodeURIComponent(post.id)}&bo=${encodeURIComponent(board?.id || "")}`;
  const facts = [script.system, script.scenario, formatScriptDate(script.playedAt)].filter(Boolean);

  return `
    <article class="card script-card">
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
    </article>
  `;
}

/* ── 상세: 세션 정보(hero) ── */
export function renderScriptHero(post = {}) {
  const script = getScriptData(post);
  const title = post.title || script.scenario || "제목 없는 세션";
  const imageUrl = String(post.thumb || "").trim();
  const facts = [
    ["RULE", script.system],
    ["SCENARIO", script.scenario],
    ["DATE", formatScriptDate(script.playedAt)],
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

/* ── 상세: 아카이브 뷰어 셸 ── */
export function renderScriptReader(post = {}) {
  const script = getScriptData(post);
  if (!script.archiveUrl) {
    return '<div class="notice">연결된 플레이 로그 파일이 없습니다.</div>';
  }
  return `
    <section class="script-reader" data-script-reader>
      <div class="script-reader-status" data-script-status>
        <span class="loading-indicator" role="status"><span class="sr-only">플레이 로그를 불러오는 중</span></span>
      </div>
      <div class="script-messages" data-script-messages></div>
      <button type="button" class="btn script-load-more hidden" data-script-more>더 보기</button>
      <div class="script-reader-sentinel hidden" data-script-sentinel aria-hidden="true"></div>
    </section>
  `;
}

export async function bindScriptViewer(container, post) {
  const shell = container?.querySelector("[data-script-reader]");
  if (!shell) return;

  const script = getScriptData(post);
  const statusEl = shell.querySelector("[data-script-status]");
  const messagesEl = shell.querySelector("[data-script-messages]");
  const moreButton = shell.querySelector("[data-script-more]");
  const sentinel = shell.querySelector("[data-script-sentinel]");

  try {
    const archive = await loadScriptArchive(script.archiveUrl);
    const messages = archive.messages.filter((message) => !isHiddenScriptMessage(message));
    const assets = archive.assets;
    const speakerAvatars = archive.speakerAvatars || {};
    const narratorSpeakers = new Set(archive.narratorSpeakers || []);
    let rendered = 0;
    let speakerFlowOpen = false;
    let autoLoadArmed = true;
    let isAppending = false;
    let observer = null;

    applyScriptArchiveCss(shell, archive.css);

    const updateLoadControls = () => {
      const hasMore = rendered < messages.length;
      moreButton.classList.toggle("hidden", !hasMore);
      sentinel?.classList.toggle("hidden", !hasMore);
      if (!hasMore) observer?.disconnect();
    };
    const appendChunk = () => {
      if (isAppending || rendered >= messages.length) return;
      isAppending = true;
      const fragment = document.createDocumentFragment();
      messages.slice(rendered, rendered + CHUNK_SIZE).forEach((message) => {
        const node = createScriptMessageNode(message, assets, { speakerAvatars, narratorSpeakers });
        speakerFlowOpen = decorateScriptMessageFlow(node, speakerFlowOpen);
        fragment.appendChild(node);
      });
      messagesEl.appendChild(fragment);
      rendered = Math.min(rendered + CHUNK_SIZE, messages.length);
      updateLoadControls();
      requestAnimationFrame(() => {
        isAppending = false;
      });
    };

    if (!messages.length) {
      statusEl.textContent = "저장된 플레이 로그가 없습니다.";
      moreButton.classList.add("hidden");
      sentinel?.classList.add("hidden");
      return;
    }

    statusEl.classList.add("hidden");
    moreButton.addEventListener("click", () => {
      autoLoadArmed = false;
      appendChunk();
    });
    appendChunk();
    if (sentinel && "IntersectionObserver" in window && rendered < messages.length) {
      observer = new IntersectionObserver(([entry]) => {
        if (!entry?.isIntersecting) {
          autoLoadArmed = true;
          return;
        }
        if (!autoLoadArmed || isAppending) return;
        autoLoadArmed = false;
        appendChunk();
      }, { rootMargin: "600px 0px", threshold: 0 });
      observer.observe(sentinel);
    }
  } catch (error) {
    console.error("SCRIPT archive load failed:", error);
    statusEl.classList.remove("hidden");
    statusEl.textContent = "플레이 로그를 불러오지 못했습니다. 저장된 파일 주소를 확인해주세요.";
    moreButton.classList.add("hidden");
    sentinel?.classList.add("hidden");
  }
}

/* ── 아카이브 로드: JSON(+gzip 대비) — 나루 미디어 URL에서 fetch ── */
export async function loadScriptArchive(url, options = {}) {
  const archiveUrl = String(url || "").trim();
  if (!archiveUrl) throw new Error("플레이 로그 파일 주소가 없습니다.");

  const response = await fetch(archiveUrl, { cache: options.cache || "default" });
  if (!response.ok) throw new Error(`Archive request failed: ${response.status}`);

  const bytes = new Uint8Array(await response.arrayBuffer());
  const isGzipPayload = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  let text = "";
  if (isGzipPayload) {
    if (typeof DecompressionStream !== "function") {
      throw new Error("이 브라우저는 압축된 플레이 로그를 열 수 없습니다.");
    }
    text = await new Response(
      new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))
    ).text();
  } else {
    text = new TextDecoder().decode(bytes);
  }

  const archive = JSON.parse(text);
  if (Number(archive?.version) !== SUPPORTED_ARCHIVE_VERSION || !Array.isArray(archive?.messages)) {
    throw new Error("지원하지 않는 SCRIPT 아카이브 형식입니다.");
  }

  const assets = Array.isArray(archive.assets) ? archive.assets.slice() : [];
  return {
    ...archive,
    version: SUPPORTED_ARCHIVE_VERSION,
    css: String(archive.css || ""),
    assets,
    speakerAvatars: normalizeScriptSpeakerAvatars(archive.speakerAvatars, assets.length),
    narratorSpeakers: normalizeScriptNarratorSpeakers(archive.narratorSpeakers),
    messages: archive.messages.slice()
  };
}

function normalizeScriptSpeakerAvatars(value, assetCount) {
  const output = Object.create(null);
  if (!value || typeof value !== "object" || Array.isArray(value)) return output;
  Object.entries(value).forEach(([speaker, rawIndex]) => {
    const name = String(speaker || "").trim().slice(0, 120);
    if (!name || !Number.isInteger(rawIndex) || rawIndex < 0 || rawIndex >= assetCount) return;
    output[name] = rawIndex;
  });
  return output;
}

function normalizeScriptNarratorSpeakers(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const output = [];
  value.forEach((speaker) => {
    const name = String(speaker || "").trim().slice(0, 120);
    if (!name || seen.has(name) || output.length >= 500) return;
    seen.add(name);
    output.push(name);
  });
  return output;
}

/* ── 메시지 DOM (원본 message-dom.js 뷰어 부분) ── */
export function isHiddenScriptMessage(message) {
  if (Array.isArray(message?.classes) && message.classes.includes("hidden-message")) return true;
  return String(message?.text || "").trim() === "This message has been hidden.";
}

export function createScriptMessageNode(message, assets = [], options = {}) {
  const node = document.createElement("article");
  const classes = Array.isArray(message?.classes)
    ? message.classes.map(cleanClassName).filter(Boolean)
    : [];
  node.className = ["script-message", ...classes].join(" ");
  node.dataset.kind = normalizeScriptMessageKind(message?.kind);
  node.innerHTML = String(message?.html || "");
  const speaker = String(message?.speaker || node.querySelector(".by")?.textContent || "")
    .replace(/\s*[:：]\s*$/, "")
    .trim();

  node.querySelectorAll(".by").forEach((by) => {
    const name = String(by.textContent || "").replace(/\s*[:：]\s*$/, "").trim();
    if (name) {
      by.textContent = name;
      applySpeakerColor(by, message?.speakerColor);
    }
    else by.remove();
  });

  if (isNarratorSpeaker(speaker, options?.narratorSpeakers)) {
    applyNarratorPresentation(node);
  } else {
    injectSpeakerAvatar(node, message, assets, options);
  }

  node.querySelectorAll("img[data-script-asset]").forEach((image) => {
    const index = Number(image.dataset.scriptAsset);
    const url = assets[index];
    if (!isSafeAssetUrl(url)) {
      image.remove();
      return;
    }
    image.loading = "lazy";
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => {
      const avatar = image.closest(".avatar");
      image.remove();
      if (avatar && !avatar.querySelector("img")) avatar.remove();
      if (!node.querySelector(".avatar img")) node.classList.add("script-message-no-avatar");
    }, { once: true });
    image.src = url;
  });

  node.querySelectorAll(".avatar").forEach((avatar) => {
    if (!avatar.querySelector("img")) avatar.remove();
  });
  if (!node.querySelector(".avatar img")) node.classList.add("script-message-no-avatar");
  return node;
}

function applySpeakerColor(by, messageColor) {
  if (!by.classList.contains("ccfolia-speaker")) return;
  const color = normalizeSpeakerColor(
    messageColor
      || by.style.getPropertyValue("--script-speaker-color")
      || by.style.borderColor
      || by.style.borderLeftColor
  );
  if (color) by.style.setProperty("--script-speaker-color", color);
  by.style.removeProperty("border-color");
  by.style.removeProperty("border-left-color");
}

function normalizeSpeakerColor(value) {
  const color = String(value || "").trim();
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return color;
  if (/^rgba?\([\d\s,.%]+\)$/i.test(color)) return color;
  return "";
}

function isNarratorSpeaker(speaker, value) {
  if (!speaker) return false;
  if (value instanceof Set) return value.has(speaker);
  return Array.isArray(value) && value.includes(speaker);
}

function applyNarratorPresentation(node) {
  node.querySelectorAll(".spacer, .avatar, .by, .tstamp").forEach((element) => element.remove());
  Array.from(node.classList).forEach((className) => {
    if (MESSAGE_KINDS.includes(className) || className.startsWith("ccfolia-roll")) {
      node.classList.remove(className);
    }
  });
  node.classList.add("desc", "ccfolia-narrator");
  node.dataset.kind = "desc";
}

function injectSpeakerAvatar(node, message, assets, options) {
  const by = node.querySelector(".by");
  if (!by || node.querySelector(".avatar img")) return;
  const speaker = String(message?.speaker || by.textContent || "").replace(/\s*[:：]\s*$/, "").trim();
  if (!speaker) return;

  const mappedIndex = options?.speakerAvatars?.[speaker];
  const hasMappedAsset = Number.isInteger(mappedIndex)
    && mappedIndex >= 0
    && mappedIndex < assets.length;
  if (!hasMappedAsset) return;

  const avatar = document.createElement("span");
  avatar.className = "avatar script-speaker-avatar";
  avatar.setAttribute("aria-hidden", "true");
  const image = document.createElement("img");
  image.alt = "";
  image.loading = "lazy";
  image.decoding = "async";
  image.dataset.scriptAsset = String(mappedIndex);
  avatar.appendChild(image);
  by.before(avatar);
}

export function decorateScriptMessageFlow(node, speakerFlowOpen) {
  const isGeneral = node.dataset.kind === "general";
  const startsSpeakerFlow = isGeneral && Boolean(node.querySelector(".spacer, .by, .avatar"));
  const continuesSpeakerFlow = isGeneral && !startsSpeakerFlow && speakerFlowOpen;

  if (startsSpeakerFlow) node.classList.add("script-message-speaker-start");
  else if (continuesSpeakerFlow) node.classList.add("script-message-continuation");
  else node.classList.add("script-message-standalone");

  return isGeneral && (startsSpeakerFlow || continuesSpeakerFlow);
}

export function applyScriptArchiveCss(shell, rawCss) {
  const css = String(rawCss || "").trim();
  if (!shell || !css || css.length > 160 * 1024) return;
  if (/@import|url\s*\(|expression\s*\(|javascript:|behavior\s*:|<\/style/i.test(css)) return;
  const rules = Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g));
  if (!rules.length || rules.some((match) => (
    String(match[1] || "").split(",").some((selector) => !selector.trim().startsWith(".script-reader "))
  ))) return;

  shell.querySelector("style[data-script-archive-style]")?.remove();
  const style = document.createElement("style");
  style.dataset.scriptArchiveStyle = "";
  style.textContent = css;
  shell.prepend(style);
}

function normalizeScriptMessageKind(value) {
  const kind = String(value || "general").trim().toLowerCase();
  return MESSAGE_KINDS.includes(kind) ? kind : "general";
}

function cleanClassName(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "");
}

function isSafeAssetUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_error) {
    return false;
  }
}

function formatScriptDate(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const date = new Date(`${text}T00:00:00`);
  return Number.isNaN(date.getTime()) ? text : date.toLocaleDateString("ko-KR");
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
}
