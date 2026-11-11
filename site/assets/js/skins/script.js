// NAMWALL Edition Copyright (c) 2026 NAMWALL — MPL-2.0 (https://mozilla.org/MPL/2.0/)
// SCRIPT 스킨(TRPG 플레이 로그) 뷰어 — 목록은 세션 카드, 상세는 세션 정보 + 아카이브 뷰어.
// 아카이브 JSON을 내려받아 메시지를 300개씩 끊어 그린다.
import { escapeHtml, formatDate, clampColumns, getHttpUrl } from "../core/site.js";
import { sanitizeScriptHtml, sanitizeScriptCss, normalizeSpeakerColor, SCRIPT_MESSAGE_KINDS, normalizeScriptMessageKind } from "../shared/script-sanitizer.js";
import { renderManageBar } from "../shared/ui.js";

const CHUNK_SIZE = 300;
const SUPPORTED_ARCHIVE_VERSION = 1;

function getScriptData(post = {}) {
  const script = (post.skinData && typeof post.skinData === "object" ? post.skinData.script : null) || {};
  return {
    system: String(script.system || "").trim(),
    scenario: String(script.scenario || "").trim(),
    gm: String(script.gm || "").trim(),
    players: String(script.players || "").trim(),
    playedAt: String(script.playedAt || "").trim(),
    summary: String(script.summary || "").trim(),
    archiveUrl: String(script.archiveUrl || "").trim()
  };
}

/* ── 목록: 세션 카드 그리드 ── */
// opts.selectable·showManage: 관리자 모드에서 카드 위에 선택·날짜·수정·삭제 줄을 단다
export function renderScriptList(posts, board = {}, opts = {}) {
  if (!Array.isArray(posts) || !posts.length) {
    return '<div class="notice">아직 백업된 플레이 로그가 없습니다.</div>';
  }
  const columns = clampColumns(board?.options?.galleryColumns, 3);
  return `
    <div class="script-list" style="--script-columns:${columns}" aria-label="TRPG 플레이 로그 목록">
      ${posts.map((post) => renderScriptCard(post, board, opts)).join("")}
    </div>
  `;
}

function renderScriptCard(post, board, opts = {}) {
  const script = getScriptData(post);
  const imageUrl = String(post.thumb || "").trim();
  const title = post.title || script.scenario || "제목 없는 세션";
  const href = `view.html?id=${encodeURIComponent(post.id)}&bo=${encodeURIComponent(board?.id || "")}`;
  const facts = [script.system, script.scenario, formatScriptDate(script.playedAt)].filter(Boolean);

  // 관리자 줄은 카드 링크 밖에 둬야 체크·삭제가 상세로 넘어가지 않는다
  const adminBar = renderManageBar(post, board, {
    selectable: opts.selectable === true,
    canManage: Boolean(opts.showManage && post.editable),
    label: formatDate(post.createdAt)
  });

  return `
    <article class="card script-card">${adminBar}
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
      <div class="script-tabs hidden" data-script-tabs role="group" aria-label="표시할 탭"></div>
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
    const allMessages = archive.messages.filter((message) => !isHiddenScriptMessage(message));
    let messages = allMessages;   // 지금 켜진 탭의 메시지
    const assets = archive.assets;
    const speakerAvatars = archive.speakerAvatars || {};
    const narratorSpeakers = new Set(archive.narratorSpeakers || []);
    let rendered = 0;
    let speakerFlowOpen = false;
    let speakerKey = "";          // 바로 앞 코코포리아 대사의 탭+화자
    let autoLoadArmed = true;
    let isAppending = false;
    let observer = null;

    applyScriptArchiveCss(shell, archive.css);

    const updateLoadControls = () => {
      const hasMore = rendered < messages.length;
      moreButton.classList.toggle("hidden", !hasMore);
      sentinel?.classList.toggle("hidden", !hasMore);
      if (hasMore) observer?.observe(sentinel);
      else observer?.disconnect();
    };
    const appendChunk = () => {
      if (isAppending || rendered >= messages.length) return;
      isAppending = true;
      const fragment = document.createDocumentFragment();
      messages.slice(rendered, rendered + CHUNK_SIZE).forEach((message) => {
        const node = createScriptMessageNode(message, assets, { speakerAvatars, narratorSpeakers });
        // 탭을 꺼서 맞닿게 된 같은 화자의 대사는 이름표를 한 번만 보여준다.
        const key = node.dataset.kind === "general" && node.classList.contains("ccfolia-message") && message.speaker
          ? `${message.channel}\n${message.speaker}`
          : "";
        if (key && key === speakerKey) node.querySelectorAll(".by, .avatar").forEach((label) => label.remove());
        speakerKey = key;
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
    bindScriptTabs(shell.querySelector("[data-script-tabs]"), allMessages, archive.tabs, (hiddenTabs) => {
      // 가리지 않고 처음부터 다시 그린다 — 이어 말하기·여백이 보이는 메시지끼리 맞물리도록.
      messages = allMessages.filter((message) => !hiddenTabs.has(getScriptTab(message)));
      messagesEl.replaceChildren();
      rendered = 0;
      speakerFlowOpen = false;
      speakerKey = "";
      isAppending = false;
      autoLoadArmed = true;
      observer?.disconnect();   // 다시 관찰을 걸어 현재 위치 기준으로 이어 불러오게 한다
      appendChunk();
    });
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

/* ── 탭 줄: 코코포리아 로그에 탭이 둘 이상일 때만 — 눌러서 켜고 끈다 ── */
const SCRIPT_TAB_LABELS = { main: "메인", other: "잡담", info: "정보" };

function getScriptTab(message) {
  return String(message?.channel || "").replace(/^\[|\]$/g, "").trim();
}

function bindScriptTabs(tabsEl, messages, order, onChange) {
  // 아카이브에 적힌 탭 순서를 먼저 깔고, 없으면 나온 순서대로.
  const counts = new Map((Array.isArray(order) ? order : []).map((tab) => [String(tab), 0]));
  messages.forEach((message) => {
    const tab = getScriptTab(message);
    if (tab) counts.set(tab, (counts.get(tab) || 0) + 1);
  });
  counts.forEach((count, tab) => { if (!count) counts.delete(tab); });
  if (!tabsEl || counts.size < 2) return;

  const hiddenTabs = new Set();
  tabsEl.innerHTML = Array.from(counts, ([tab, count]) => `
    <button type="button" class="script-tab is-on" data-tab="${escapeHtml(tab)}" aria-pressed="true">
      ${escapeHtml(SCRIPT_TAB_LABELS[tab.toLowerCase()] || tab)} <span>${count.toLocaleString("ko-KR")}</span>
    </button>`).join("");
  tabsEl.classList.remove("hidden");
  tabsEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-tab]");
    if (!button) return;
    const tab = button.dataset.tab;
    const isOn = hiddenTabs.has(tab);
    if (!isOn && hiddenTabs.size >= counts.size - 1) return;   // 마지막 하나는 끄지 않는다
    if (isOn) hiddenTabs.delete(tab);
    else hiddenTabs.add(tab);
    button.classList.toggle("is-on", isOn);
    button.setAttribute("aria-pressed", String(isOn));
    onChange(hiddenTabs);
  });
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

export function normalizeScriptSpeakerAvatars(value, assetCount) {
  const output = Object.create(null);
  if (!value || typeof value !== "object" || Array.isArray(value)) return output;
  Object.entries(value).forEach(([speaker, rawIndex]) => {
    const name = String(speaker || "").trim().slice(0, 120);
    if (!name || !Number.isInteger(rawIndex) || rawIndex < 0 || rawIndex >= assetCount) return;
    output[name] = rawIndex;
  });
  return output;
}

export function normalizeScriptNarratorSpeakers(value) {
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

/* ── 메시지 DOM ── */
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
  // 잡담 탭은 연하게, 메인이 아닌 나머지 탭(정보·비밀 탭)은 이름표 옆에 탭 이름을 단다.
  const tab = getScriptTab(message);
  const isChatTab = /^(?:other|잡담|雑談)$/i.test(tab);
  const tabLabel = isChatTab || /^(?:main|메인|メイン)?$/i.test(tab) ? "" : SCRIPT_TAB_LABELS[tab.toLowerCase()] || tab;
  if (isChatTab) node.classList.add("ccfolia-chat");
  node.dataset.kind = normalizeScriptMessageKind(message?.kind);
  node.innerHTML = sanitizeScriptHtml(message?.html);
  decorateRollOutcomes(node);
  const speaker = cleanSpeakerName(message?.speaker || node.querySelector(".by")?.textContent);

  node.querySelectorAll(".by").forEach((by) => {
    const name = cleanSpeakerName(by.textContent);
    if (name) {
      by.textContent = name;
      if (tabLabel) by.dataset.tab = tabLabel;
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
    if (!getHttpUrl(url)) {
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

// 판정 결과 등급 — 문구로 먼저 판별하고, 문구가 낯설면 Roll20 CoC 시트가 결과 칸에 칠하는 배경색으로 판별.
// 좁은 것부터: '대실패'가 '실패'에, '대성공'·'극단적 성공'이 '성공'에 먼저 걸리지 않게.
const ROLL_OUTCOMES = [
  { level: "fumble", text: /대실패|펌블|fumble|고장|malfunction|ファンブル|致命的失敗/i, color: "red" },
  { level: "fail", text: /실패|fail|失敗/i, color: "crimson" },
  { level: "critical", text: /대성공|크리티컬|critical|決定的成功|クリティカル/i, color: "lime" },
  { level: "extreme", text: /극단적\s*성공|extreme|イクストリーム|極限/i, color: "lightgreen" },
  { level: "hard", text: /어려운\s*성공|hard|ハード|困難/i, color: "green" },
  { level: "success", text: /성공|success|成功/i, color: "darkgreen" }
];

// 판정표(롤 템플릿)의 결과 칸: 시트는 배경색만 칠해 글자가 묻히므로 등급 배지로 다시 그린다.
// 결과가 하나뿐인 표는 왼쪽에 성공(초록)·실패(빨강) 띠를 두르고, 단순한 표면 두세 줄로 접는다.
function decorateRollOutcomes(node) {
  node.querySelectorAll('[class*="sheet-rolltemplate-"]').forEach((template) => {
    const levels = [];
    template.querySelectorAll("tr").forEach((row) => {
      const cells = row.querySelectorAll("td, th");
      if (cells.length < 2) return;
      const cell = cells[cells.length - 1];
      const text = cell.textContent.replace(/\s+/g, " ").trim();
      const color = cell.style.backgroundColor.toLowerCase();
      const isResultRow = /판정|결과|result|結果/i.test(cells[0].textContent)
        || ROLL_OUTCOMES.some((outcome) => outcome.color === color);
      if (!isResultRow || !text || text.length > 24) return;
      const outcome = ROLL_OUTCOMES.find((item) => item.text.test(text))
        || ROLL_OUTCOMES.find((item) => item.color === color);
      if (!outcome) return;

      row.style.removeProperty("background");
      row.style.removeProperty("background-color");
      cell.style.removeProperty("background");
      cell.style.removeProperty("background-color");
      cell.classList.add("script-roll-result");
      cell.dataset.rollOutcome = outcome.level;
      const badge = document.createElement("span");
      badge.className = "script-roll-badge";
      badge.textContent = text;
      cell.replaceChildren(badge);
      levels.push(outcome.level);
    });
    if (levels.length !== 1) return;
    template.dataset.rollOutcome = levels[0];
    collapseRollTemplate(template);
  });
}

const ROLL_LABEL = /굴림|roll|ロール|出目|ダイス/i;

// '라벨: 값' 줄 몇 개뿐인 판정표는 카드로 접는다: 결과 앞 줄 → 굴림 값+결과 띠 → 결과 뒤 줄(피해 등).
// 결과가 여러 개이거나 칸 구성이 다른 표(보너스 주사위·광기 표 등)는 그대로 둔다.
function collapseRollTemplate(template) {
  const tables = template.querySelectorAll("table");
  if (tables.length !== 1) return;
  const rows = Array.from(tables[0].rows);
  if (!rows.length || rows.length > 8 || rows.some((row) => row.cells.length !== 2)) return;

  const head = document.createElement("div");
  head.className = "script-roll-head";
  const result = document.createElement("div");
  result.className = "script-roll-result";
  const foot = document.createElement("div");
  foot.className = "script-roll-foot";
  const outcome = document.createElement("span");
  outcome.className = "script-roll-outcome";
  let rollField = null;
  let afterResult = false;
  const caption = tables[0].caption;
  if (caption?.textContent.trim()) {
    const name = document.createElement("span");
    name.className = "script-roll-name";
    name.append(...caption.childNodes);
    head.append(name);
  }
  rows.forEach((row) => {
    const [labelCell, valueCell] = row.cells;
    if (valueCell.classList.contains("script-roll-result")) {
      outcome.textContent = valueCell.textContent;
      afterResult = true;
      return;
    }
    const field = document.createElement("span");
    field.className = "script-roll-field";
    const label = labelCell.textContent.replace(/\s+/g, " ").replace(/\s*[:：]\s*$/, "").trim();
    if (label) {
      const labelEl = document.createElement("span");
      labelEl.className = "script-roll-label";
      labelEl.textContent = label;
      field.append(labelEl);
    }
    const value = document.createElement("span");
    value.className = "script-roll-value";
    value.append(...valueCell.childNodes);
    field.append(value);
    // 굴림 값은 결과 띠 안으로 — 숫자와 성패를 한 칸에서 같이 읽도록
    if (!rollField && !afterResult && ROLL_LABEL.test(label)) rollField = field;
    else (afterResult ? foot : head).append(field);
  });
  if (rollField) result.append(rollField);
  result.append(outcome);
  template.classList.add("script-roll-inline");
  tables[0].replaceWith(...[head, result, foot].filter((part) => part === result || part.childNodes.length));
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

function cleanSpeakerName(value) {
  return String(value || "").replace(/\s*[:：]\s*$/, "").trim();
}

function isNarratorSpeaker(speaker, value) {
  if (!speaker) return false;
  if (value instanceof Set) return value.has(speaker);
  return Array.isArray(value) && value.includes(speaker);
}

function applyNarratorPresentation(node) {
  node.querySelectorAll(".spacer, .avatar, .by, .tstamp").forEach((element) => element.remove());
  Array.from(node.classList).forEach((className) => {
    if (SCRIPT_MESSAGE_KINDS.includes(className) || className.startsWith("ccfolia-roll")) {
      node.classList.remove(className);
    }
  });
  node.classList.add("desc", "ccfolia-narrator");
  node.dataset.kind = "desc";
}

function injectSpeakerAvatar(node, message, assets, options) {
  const by = node.querySelector(".by");
  if (!by || node.querySelector(".avatar img")) return;
  const speaker = cleanSpeakerName(message?.speaker || by.textContent);
  if (!speaker) return;

  const mappedIndex = options?.speakerAvatars?.[speaker];
  const previewUrl = String(options?.speakerAvatarUrl || "");
  const hasPreview = previewUrl.startsWith("blob:");
  const hasMappedAsset = Number.isInteger(mappedIndex)
    && mappedIndex >= 0
    && mappedIndex < assets.length;
  if (!hasPreview && !hasMappedAsset) return;

  const avatar = document.createElement("span");
  avatar.className = "avatar script-speaker-avatar";
  avatar.setAttribute("aria-hidden", "true");
  const image = document.createElement("img");
  image.alt = "";
  image.loading = "lazy";
  image.decoding = "async";
  if (hasPreview) image.src = previewUrl;
  else image.dataset.scriptAsset = String(mappedIndex);
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
  const css = sanitizeScriptCss(rawCss);
  if (!shell || !css) return;

  shell.querySelector("style[data-script-archive-style]")?.remove();
  const style = document.createElement("style");
  style.dataset.scriptArchiveStyle = "";
  style.textContent = css;
  shell.prepend(style);
}

function cleanClassName(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "");
}

function formatScriptDate(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const date = new Date(`${text}T00:00:00`);
  return Number.isNaN(date.getTime()) ? text : date.toLocaleDateString("ko-KR");
}
