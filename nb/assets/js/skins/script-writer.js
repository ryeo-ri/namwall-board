// SCRIPT 스킨 — 글쓰기 쪽 (원본 namwall archive-processor + writer 이식)
// Roll20/코코포리아 로그 HTML → 메시지 아카이브(JSON)로 정리해 나루 미디어에 올린다.
// 로그 속 이미지는 원본 형식 그대로 함께 백업한다(선택).
// 나루 미디어는 코드로 파일을 지울 수 없으므로, 로그를 교체하면 이전 파일은
// 미디어 라이브러리에 남는다(소유자가 제어판에서 정리).

const MAX_SOURCE_BYTES = 100 * 1024 * 1024;
const MAX_ARCHIVE_CSS_BYTES = 160 * 1024;
const BLOCKED_TAGS = "script,style,iframe,object,embed,form,input,button,textarea,select,link,meta,base,audio,video,canvas,svg,math,template,slot";
const ALLOWED_STYLE_PREFIXES = [
  "align", "aspect-ratio", "background", "border", "box", "clear", "color", "column", "cursor",
  "display", "float", "flex", "font", "gap", "grid", "height", "inset", "isolation", "justify",
  "left", "letter-spacing", "line-height", "list", "margin", "max-height", "max-width", "min-height",
  "min-width", "object", "opacity", "order", "overflow", "padding", "position", "right", "table-layout",
  "text", "top", "transform", "vertical-align", "visibility", "white-space", "width", "word-break",
  "overflow-wrap", "z-index"
];
const SOURCE_TYPES = new Set(["auto", "roll20", "ccfolia"]);
const MEMBER_UPLOAD_LIMIT = 30; // 회원 미디어 업로드: 시간당 30개

let selectedFile = null;
let processedSource = null;
let processedSourceMode = "";
let analysisToken = 0;

/* ── 글쓰기 폼 바인딩 — write.html의 #scriptFields 안에서 동작 ── */
export function bindScriptWriter(container, existingScript = null) {
  if (!container) return;

  const fileInput = container.querySelector("[data-script-file-input]");
  const selectButton = container.querySelector("[data-script-file-select]");
  const dropzone = container.querySelector("[data-script-dropzone]");
  const sourceModeSelect = container.querySelector("[data-script-source-mode]");

  if (existingScript?.archiveUrl) {
    const existingSourceType = normalizeSourceMode(existingScript.sourceType);
    if (sourceModeSelect && existingSourceType !== "auto") {
      sourceModeSelect.value = existingSourceType;
      sourceModeSelect.dataset.autoResolved = "true";
    }
    renderImportResult(container, existingScript);
    setStatus(container, `저장된 로그 ${formatCount(existingScript.messageCount)}개 · 새 파일을 선택하면 교체됩니다.`);
  }

  if (container.dataset.scriptBound === "1") return;
  container.dataset.scriptBound = "1";

  selectButton?.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("change", () => selectSourceFile(fileInput.files?.[0], container));
  sourceModeSelect?.addEventListener("change", () => {
    sourceModeSelect.dataset.autoResolved = "false";
    processedSource = null;
    processedSourceMode = "";
    updateImageBackupOption(container, null);
    if (selectedFile) analyzeSourceFile(selectedFile, container);
  });
  dropzone?.addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    fileInput?.click();
  });
  dropzone?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    fileInput?.click();
  });
  dropzone?.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropzone.classList.add("is-dragover");
  });
  dropzone?.addEventListener("dragleave", () => dropzone.classList.remove("is-dragover"));
  dropzone?.addEventListener("drop", (event) => {
    event.preventDefault();
    dropzone.classList.remove("is-dragover");
    selectSourceFile(event.dataTransfer?.files?.[0], container);
  });
}

/* ── 저장 직전: 아카이브 업로드 → script 필드값 반환 ──
   새 파일이 없으면 기존 값을 그대로 돌려준다(수정 모드). */
export async function prepareScriptArchive({ container, uploader, existingScript = null }) {
  if (!selectedFile) {
    if (existingScript?.archiveUrl) return { ...existingScript };
    throw new Error("플레이 로그 HTML 파일을 선택하세요.");
  }
  if (!uploader?.media?.upload) throw new Error("업로드 권한이 없습니다. 로그인 상태를 확인하세요.");

  const sourceMode = getSourceMode(container);
  if (!processedSource || processedSourceMode !== sourceMode) {
    setStatus(container, "로그를 정리하는 중...");
    processedSource = await processScriptHtml(selectedFile, { sourceType: sourceMode });
    processedSourceMode = applyResolvedSourceMode(container, sourceMode, processedSource);
    updateImageBackupOption(container, processedSource);
    renderImportResult(container, processedSource);
  }

  const archiveId = createScriptArchiveId();
  const archive = structuredClone(processedSource.archive);
  let archivedAssetCount = 0;
  const shouldBackupImages = container.querySelector("[data-script-backup-images]")?.checked !== false;
  if (shouldBackupImages && archive.assets.length) {
    setStatus(container, `이미지 백업 중 · 0 / ${archive.assets.length}`);
    const result = await backupAssets(archive.assets, uploader, archiveId, (done) => {
      setStatus(container, `이미지 백업 중 · ${done} / ${archive.assets.length}`);
    });
    archive.assets = result.urls;
    archivedAssetCount = result.uploaded;
  }

  setStatus(container, "로그 업로드 중...");
  const archiveFile = new File(
    [JSON.stringify(archive)],
    `script-${archiveId}.json`,
    { type: "text/plain" }
  );
  const uploaded = await uploader.media.upload(archiveFile);

  const script = {
    archiveUrl: uploaded.url,
    archiveId,
    archiveEncoding: "identity",
    archiveVersion: 1,
    sourceType: processedSource.sourceType,
    sourceFileName: processedSource.sourceFileName,
    messageCount: processedSource.messageCount,
    assetCount: processedSource.assetCount,
    archivedAssetCount,
    originalBytes: processedSource.originalBytes,
    normalizedBytes: processedSource.normalizedBytes,
    archiveBytes: archiveFile.size
  };
  renderImportResult(container, script);
  setStatus(
    container,
    `업로드 완료 · 메시지 ${formatCount(script.messageCount)}개 · ${formatBytes(script.originalBytes)} → ${formatBytes(script.archiveBytes)}`
  );
  return script;
}

async function selectSourceFile(file, container) {
  if (!file) return;
  if (!/\.html?$/i.test(file.name) && file.type !== "text/html") {
    setStatus(container, "HTML 파일만 선택할 수 있습니다.", true);
    return;
  }
  const sourceModeSelect = container?.querySelector("[data-script-source-mode]");
  if (sourceModeSelect?.dataset.autoResolved === "true") {
    sourceModeSelect.value = "auto";
    sourceModeSelect.dataset.autoResolved = "false";
  }
  selectedFile = file;
  processedSource = null;
  processedSourceMode = "";
  renderImportResult(container, null);
  await analyzeSourceFile(file, container);
}

async function analyzeSourceFile(file, container) {
  const token = ++analysisToken;
  const sourceMode = getSourceMode(container);
  try {
    setStatus(container, `${file.name} 분석 중...`);
    renderImportResult(container, null);
    const result = await processScriptHtml(file, { sourceType: sourceMode });
    if (token !== analysisToken) return;
    processedSource = result;
    processedSourceMode = applyResolvedSourceMode(container, sourceMode, result);
    updateImageBackupOption(container, result);
    renderImportResult(container, result);
    const sourceStatus = sourceMode === "auto"
      ? `${result.sourceLabel} 자동 감지`
      : `${getScriptSourceLabel(sourceMode)} 선택`;
    const limitWarning = result.assetCount >= MEMBER_UPLOAD_LIMIT - 2
      ? ` · 이미지가 많아 회원 업로드 한도(시간당 ${MEMBER_UPLOAD_LIMIT}개)를 넘을 수 있습니다. 필요하면 이미지 백업을 꺼주세요.`
      : "";
    setStatus(container, `${sourceStatus} 완료 · 형식이 다르면 위 셀렉트에서 변경하세요.${limitWarning}`);
  } catch (error) {
    if (token !== analysisToken) return;
    processedSource = null;
    processedSourceMode = "";
    updateImageBackupOption(container, null);
    renderImportResult(container, null);
    setStatus(container, error.message || "HTML 분석에 실패했습니다.", true);
  }
}

/* 로그 속 외부 이미지 → 원본 그대로 나루 미디어 백업. 실패한 항목은 원본 URL 유지.
   (나루 미디어가 아주 큰 사진은 자체적으로 줄이거나 변환할 수 있다.) */
const BACKUP_IMAGE_EXTENSIONS = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif"
};

async function backupAssets(urls, uploader, archiveId, onProgress) {
  const output = urls.slice();
  let uploaded = 0;
  let cursor = 0;
  let done = 0;
  const workers = Array.from({ length: Math.min(3, urls.length) }, async () => {
    while (cursor < urls.length) {
      const index = cursor++;
      try {
        const original = await fetchOriginalImage(urls[index]);
        if (original) {
          const extension = BACKUP_IMAGE_EXTENSIONS[original.type.toLowerCase()];
          const assetFile = new File(
            [original],
            `script-${archiveId}-${String(index).padStart(3, "0")}.${extension}`,
            { type: original.type }
          );
          const result = await uploader.media.upload(assetFile);
          output[index] = result.url;
          uploaded += 1;
        }
      } catch (_error) {
        // CORS로 막힌 외부 이미지나 업로드 한도 초과 항목은 원본 URL을 그대로 둔다.
      } finally {
        done += 1;
        onProgress?.(done);
      }
    }
  });
  await Promise.all(workers);
  return { urls: output, uploaded };
}

async function fetchOriginalImage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(url, { mode: "cors", credentials: "omit", signal: controller.signal });
    if (!response.ok) return null;
    const sourceBlob = await response.blob();
    if (!BACKUP_IMAGE_EXTENSIONS[String(sourceBlob.type || "").toLowerCase()]) return null;
    return sourceBlob;
  } finally {
    clearTimeout(timeout);
  }
}

function createScriptArchiveId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const suffix = Array.from(bytes, (byte) => byte.toString(36).padStart(2, "0")).join("").slice(0, 12);
  return `${Date.now()}_${suffix}`;
}

/* ── 상태 표시 ── */
function setStatus(container, message, isError = false) {
  const status = container?.querySelector("[data-script-import-status]");
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("is-error", isError);
}

function renderImportResult(container, result) {
  const panel = container?.querySelector("[data-script-import-result]");
  if (!panel) return;
  if (!result) {
    panel.innerHTML = "";
    panel.classList.add("hidden");
    return;
  }

  const sourceType = normalizeSourceMode(result.sourceType || result.source);
  const assetCount = Math.max(0, Number(result.assetCount) || 0);
  const archivedAssetCount = Math.max(0, Number(result.archivedAssetCount) || 0);
  const imageValue = Number(result.archiveBytes) > 0
    ? `${formatCount(assetCount)}종 · ${formatCount(archivedAssetCount)}개 백업`
    : `${formatCount(assetCount)}종`;
  const items = [
    ["로그 형식", sourceType === "auto" ? "확인 전" : getScriptSourceLabel(sourceType)],
    ["파일명", result.sourceFileName || "-"],
    ["메시지", `${formatCount(result.messageCount)}개`],
    ["로그 이미지", imageValue],
    ["원본 용량", formatBytesOrDash(result.originalBytes)],
    ["정리 후", formatBytesOrDash(result.normalizedBytes)],
    ["업로드 후", formatBytesOrDash(result.archiveBytes)]
  ];

  panel.innerHTML = items.map(([label, value]) => `
    <div class="script-import-result-item">
      <dt>${escapeHtml(label)}</dt>
      <dd title="${escapeHtml(value)}">${escapeHtml(value)}</dd>
    </div>
  `).join("");
  panel.classList.remove("hidden");
}

function applyResolvedSourceMode(container, requestedMode, result) {
  const select = container?.querySelector("[data-script-source-mode]");
  const resolvedMode = normalizeSourceMode(result?.sourceType);
  if (requestedMode === "auto" && resolvedMode !== "auto" && select) {
    select.value = resolvedMode;
    select.dataset.autoResolved = "true";
    return resolvedMode;
  }
  if (select) select.dataset.autoResolved = "false";
  return normalizeSourceMode(requestedMode);
}

function getSourceMode(container) {
  return normalizeSourceMode(container?.querySelector("[data-script-source-mode]")?.value);
}

function normalizeSourceMode(value) {
  const normalized = String(value || "auto").trim().toLowerCase();
  return ["roll20", "ccfolia"].includes(normalized) ? normalized : "auto";
}

function updateImageBackupOption(container, result) {
  const option = container?.querySelector(".script-image-backup-option");
  const input = option?.querySelector("input[type='checkbox']");
  const sourceMode = getSourceMode(container);
  const isCocofolia = result?.sourceType === "ccfolia" || (!result && sourceMode === "ccfolia");
  option?.classList.toggle("hidden", isCocofolia);
  if (input) input.disabled = isCocofolia;
}

/* ── 아래는 원본 archive-processor.js 그대로 (브라우저 DOM만 사용) ── */

async function processScriptHtml(file, { sourceType = "auto" } = {}) {
  if (!(file instanceof File)) throw new Error("가져올 HTML 파일을 선택하세요.");
  if (file.size > MAX_SOURCE_BYTES) throw new Error("원본 HTML은 100MB 이하만 가져올 수 있습니다.");

  const source = await file.text();
  const requestedType = normalizeSourceType(sourceType);
  const resolvedType = requestedType === "auto" ? detectScriptLogSource(source) : requestedType;
  if (resolvedType === "roll20") return processRoll20Source(file, source);
  if (resolvedType === "ccfolia") return processCocofoliaSource(file, source);
  throw new Error("지원하지 않는 로그 형식입니다.");
}

function detectScriptLogSource(source) {
  const html = String(source || "");
  if (!html.trim()) throw new Error("HTML 파일 내용이 비어 있습니다.");

  if (/(?:id\s*=\s*["']textchat["']|class\s*=\s*["'][^"']*textchatcontainer)/i.test(html)
    && /class\s*=\s*["'][^"']*\bmessage\b/i.test(html)) {
    return "roll20";
  }
  if (/<title\b[^>]*>[^<]*ccfolia\s*-\s*logs[^<]*<\/title>/i.test(html)) {
    return "ccfolia";
  }

  const parsed = new DOMParser().parseFromString(html, "text/html");
  if (parsed.querySelector("#textchat .message, .textchatcontainer .message")) return "roll20";
  const paragraphs = Array.from(parsed.body?.querySelectorAll("p") || []);
  const ccfoliaMessages = getCocofoliaMessageElements(parsed);
  if (ccfoliaMessages.length >= 3 && ccfoliaMessages.length >= paragraphs.length * 0.75) return "ccfolia";
  throw new Error("로그 형식을 자동으로 판별하지 못했습니다. Roll20 또는 코코포리아를 직접 선택해 주세요.");
}

function getScriptSourceLabel(sourceType) {
  if (sourceType === "roll20") return "Roll20";
  if (sourceType === "ccfolia") return "코코포리아";
  return "자동 감지";
}

function normalizeSourceType(value) {
  const normalized = String(value || "auto").trim().toLowerCase();
  return SOURCE_TYPES.has(normalized) ? normalized : "auto";
}

async function processRoll20Source(file, source) {
  const scopedSource = extractChatMarkup(source);
  const parsed = new DOMParser().parseFromString(scopedSource, "text/html");
  const chatRoot = parsed.querySelector("#textchat .content, .textchatcontainer .content, #textchat");
  if (!chatRoot) throw new Error("Roll20 채팅 로그 영역을 찾지 못했습니다.");
  const archiveCss = extractRollTemplateStyles(source, chatRoot);

  const assetUrls = [];
  const assetIndexes = new Map();
  chatRoot.querySelectorAll(BLOCKED_TAGS).forEach((node) => node.remove());
  const directMessages = Array.from(chatRoot.children).filter((node) => node.classList.contains("message"));
  const candidates = directMessages.length
    ? directMessages
    : Array.from(chatRoot.querySelectorAll(".message")).filter((node) => !node.parentElement?.closest(".message"));
  if (!candidates.length) throw new Error("가져올 채팅 메시지가 없습니다.");

  const messages = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const message = cleanMessage(candidates[index], assetUrls, assetIndexes);
    if (message) messages.push(message);
    if (index && index % 300 === 0) await yieldToBrowser();
  }
  const archive = {
    version: 1,
    source: "roll20",
    title: String(extractDocumentTitle(source) || file.name.replace(/\.html?$/i, "")).trim(),
    createdAt: new Date().toISOString(),
    css: archiveCss,
    assets: assetUrls,
    messages
  };
  return buildProcessResult(file, archive, "roll20");
}

async function processCocofoliaSource(file, source) {
  const parsed = new DOMParser().parseFromString(source, "text/html");
  const candidates = getCocofoliaMessageElements(parsed);
  if (!candidates.length) throw new Error("코코포리아 로그 메시지를 찾지 못했습니다.");

  const messages = [];
  let previousSpeaker = "";
  let previousChannel = "";
  let previousKind = "";
  for (let index = 0; index < candidates.length; index += 1) {
    const paragraph = candidates[index];
    const spans = getDirectSpanChildren(paragraph);
    const channel = normalizeText(spans[0]?.textContent);
    const speaker = normalizeText(spans[1]?.textContent);
    const contentRoot = spans[2]?.cloneNode(true);
    if (!contentRoot) continue;

    contentRoot.querySelectorAll(BLOCKED_TAGS).forEach((node) => node.remove());
    contentRoot.querySelectorAll("img").forEach((node) => node.remove());
    contentRoot.querySelectorAll("*").forEach((node) => sanitizeElement(node, [], new Map()));
    const contentHtml = String(contentRoot.innerHTML || "").trim();
    const contentText = normalizeText(contentRoot.textContent);
    if (!contentHtml && !contentText) continue;

    const kind = looksLikeDiceResult(contentText) ? "rollresult" : "general";
    const speakerColor = normalizeCocofoliaColor(paragraph.style?.color || "");
    const continuesSpeaker = kind === "general"
      && previousKind === "general"
      && speaker
      && speaker === previousSpeaker
      && channel === previousChannel;
    const speakerStyle = speakerColor ? ` style="--script-speaker-color:${speakerColor}"` : "";
    const speakerHtml = speaker && !continuesSpeaker
      ? `<span class="by ccfolia-speaker"${speakerStyle}>${escapeHtml(speaker)}</span>`
      : "";
    const rollClass = kind === "rollresult" ? resolveCocofoliaRollClass(contentText) : "";
    const classes = ["message", kind, "ccfolia-message"];
    if (kind === "rollresult") classes.push("ccfolia-roll");
    if (rollClass) classes.push(rollClass);

    messages.push({
      kind,
      classes,
      html: `${speakerHtml}${kind === "rollresult" ? `<span class="ccfolia-roll-content">${contentHtml}</span>` : contentHtml}`.trim(),
      text: [speaker, contentText].filter(Boolean).join(" "),
      channel,
      speaker,
      speakerColor
    });
    previousSpeaker = speaker;
    previousChannel = channel;
    previousKind = kind;
    if (index && index % 300 === 0) await yieldToBrowser();
  }

  if (!messages.length) throw new Error("가져올 코코포리아 로그 메시지가 없습니다.");
  const archive = {
    version: 1,
    source: "ccfolia",
    title: String(file.name || "ccfolia-log").replace(/\.html?$/i, "").trim(),
    createdAt: new Date().toISOString(),
    css: "",
    assets: [],
    speakerAvatars: {},
    narratorSpeakers: [],
    messages
  };
  return buildProcessResult(file, archive, "ccfolia");
}

function buildProcessResult(file, archive, sourceType) {
  const normalizedBytes = new TextEncoder().encode(JSON.stringify(archive)).byteLength;
  return {
    archive,
    sourceType,
    sourceLabel: getScriptSourceLabel(sourceType),
    originalBytes: file.size,
    normalizedBytes,
    messageCount: archive.messages.length,
    assetCount: archive.assets.length,
    sourceFileName: file.name
  };
}

function getCocofoliaMessageElements(parsed) {
  return Array.from(parsed.body?.querySelectorAll("p") || []).filter((paragraph) => {
    const spans = getDirectSpanChildren(paragraph);
    if (spans.length !== 3) return false;
    return /^\s*\[[^\]]+\]\s*$/.test(String(spans[0].textContent || ""));
  });
}

function getDirectSpanChildren(element) {
  return Array.from(element?.children || []).filter((child) => child.tagName === "SPAN");
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeCocofoliaColor(value) {
  const color = String(value || "").trim();
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return color;
  if (/^rgba?\([\d\s,.%]+\)$/i.test(color)) return color;
  return "";
}

function looksLikeDiceResult(text) {
  const value = String(text || "");
  const hasDiceCommand = /(?:^|[\s(])(?:\d+)?d\d+|\bCC\s*[<>=]|\bCBR\s*\(|\bchoice\s*\[|\bRES\s*\(/i.test(value);
  return hasDiceCommand && /(?:＞|>|→)\s*[^\s]/.test(value);
}

function resolveCocofoliaRollClass(text) {
  const value = String(text || "");
  if (/펌블|fumble|大失敗/i.test(value)) return "ccfolia-roll-fumble";
  if (/크리티컬|critical|대단한 성공|극단적 성공|決定的成功/i.test(value)) return "ccfolia-roll-critical";
  if (/실패|failure|失敗/i.test(value)) return "ccfolia-roll-fail";
  if (/성공|success|成功/i.test(value)) return "ccfolia-roll-success";
  return "";
}

function escapeHtml(value) {
  const node = document.createElement("span");
  node.textContent = String(value || "");
  return node.innerHTML;
}

function extractChatMarkup(source) {
  const textchatMatch = source.match(/<div[^>]+id=["']textchat["'][^>]*>/i);
  if (!textchatMatch || textchatMatch.index == null) return source;
  const afterTextchat = source.slice(textchatMatch.index + textchatMatch[0].length);
  const contentMatch = afterTextchat.match(/<div[^>]+class=["'][^"']*\bcontent\b[^"']*["'][^>]*>/i);
  if (!contentMatch || contentMatch.index == null) return source;

  const contentStart = textchatMatch.index + textchatMatch[0].length + contentMatch.index + contentMatch[0].length;
  const remainder = source.slice(contentStart);
  const templateMatch = remainder.match(/<script[^>]+id=["']tmpl_chatmessage/i);
  const bodyMatch = remainder.match(/<\/body\s*>/i);
  const contentEnd = templateMatch?.index ?? bodyMatch?.index ?? remainder.length;
  return `<div id="textchat"><div class="content">${remainder.slice(0, contentEnd)}</div></div>`;
}

function extractDocumentTitle(source) {
  const match = source.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return "";
  const probe = document.createElement("textarea");
  probe.innerHTML = match[1];
  return probe.value.replace(/\s+/g, " ").trim();
}

function cleanMessage(sourceNode, assetUrls, assetIndexes) {
  sanitizeElement(sourceNode, assetUrls, assetIndexes);
  sourceNode.querySelectorAll("*").forEach((node) => sanitizeElement(node, assetUrls, assetIndexes));
  sourceNode.querySelectorAll(".avatar").forEach((avatar) => {
    if (!avatar.querySelector("img")) avatar.remove();
  });

  const classes = Array.from(sourceNode.classList)
    .map((value) => value.replace(/[^a-zA-Z0-9_-]/g, ""))
    .filter(Boolean)
    .slice(0, 8);
  const kind = resolveMessageKind(classes);
  const text = String(sourceNode.textContent || "").replace(/\s+/g, " ").trim();
  const html = sourceNode.innerHTML.trim();
  if (!html && !text) return null;
  // Roll20 숨김 메시지 플레이스홀더 제외 (hidden-message 클래스 또는 문구 단독)
  if (classes.includes("hidden-message") || text === "This message has been hidden.") return null;
  return { kind, classes, html, text };
}

function sanitizeElement(element, assetUrls, assetIndexes) {
  Array.from(element.attributes || []).forEach((attribute) => {
    const name = attribute.name.toLowerCase();
    if (name.startsWith("on") || name === "id" || name === "srcdoc") {
      element.removeAttribute(attribute.name);
      return;
    }
    if (["src", "href", "xlink:href", "action", "formaction", "poster", "background"].includes(name)
      && !((element.tagName === "A" && name === "href") || (element.tagName === "IMG" && name === "src"))) {
      element.removeAttribute(attribute.name);
      return;
    }
    if (name === "style") {
      const style = sanitizeStyle(attribute.value);
      if (style) element.setAttribute("style", style);
      else element.removeAttribute("style");
      return;
    }
    if (name.startsWith("data-") && name !== "data-script-asset") {
      element.removeAttribute(attribute.name);
    }
  });

  if (element.tagName === "A") {
    const href = normalizeLink(element.getAttribute("href"));
    if (href) {
      element.setAttribute("href", href);
      element.setAttribute("target", "_blank");
      element.setAttribute("rel", "noopener noreferrer");
    } else {
      element.removeAttribute("href");
    }
  }

  if (element.tagName === "IMG") {
    const src = normalizeAssetUrl(element.getAttribute("src"));
    element.removeAttribute("srcset");
    if (!src) {
      element.remove();
      return;
    }
    let index = assetIndexes.get(src);
    if (index == null) {
      index = assetUrls.length;
      assetIndexes.set(src, index);
      assetUrls.push(src);
    }
    element.removeAttribute("src");
    element.setAttribute("data-script-asset", String(index));
    element.setAttribute("loading", "lazy");
    element.setAttribute("decoding", "async");
  }
}

function sanitizeStyle(rawStyle) {
  if (!rawStyle || /expression\s*\(|@import|javascript:|behavior\s*:/i.test(rawStyle)) return "";
  return rawStyle.split(";").map((declaration) => declaration.trim()).filter(Boolean).map((declaration) => {
    const separator = declaration.indexOf(":");
    if (separator < 1) return "";
    const normalized = declaration.slice(0, separator).trim().toLowerCase();
    if (!ALLOWED_STYLE_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}-`))) return "";
    const value = declaration.slice(separator + 1).trim();
    if (/url\s*\(|expression\s*\(|javascript:/i.test(value)) return "";
    if (normalized === "position" && !/^(?:static|relative|absolute)$/i.test(value)) return "";
    return `${normalized}:${value}`;
  }).filter(Boolean).join(";");
}

function extractRollTemplateStyles(source, chatRoot) {
  const usedClasses = new Set();
  chatRoot.querySelectorAll("[class]").forEach((element) => {
    element.classList.forEach((className) => usedClasses.add(className));
  });
  const usedTemplates = new Set(Array.from(usedClasses).filter((className) => className.startsWith("sheet-rolltemplate-")));
  if (!usedTemplates.size) return "";

  const output = [];
  const stylePattern = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  for (const styleMatch of source.matchAll(stylePattern)) {
    const cssText = String(styleMatch[1] || "");
    if (!/\.sheet-rolltemplate-/i.test(cssText)) continue;
    const withoutComments = cssText.replace(/\/\*[\s\S]*?\*\//g, "");
    const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
    for (const ruleMatch of withoutComments.matchAll(rulePattern)) {
      const declarations = sanitizeStyle(ruleMatch[2]);
      if (!declarations) continue;
      const selectors = String(ruleMatch[1] || "")
        .split(",")
        .map((selector) => sanitizeRollTemplateSelector(selector, usedTemplates))
        .filter(Boolean);
      if (!selectors.length) continue;
      output.push(`${selectors.join(",")}{${declarations}}`);
      if (output.join("").length >= MAX_ARCHIVE_CSS_BYTES) break;
    }
    if (output.join("").length >= MAX_ARCHIVE_CSS_BYTES) break;
  }
  return output.join("\n").slice(0, MAX_ARCHIVE_CSS_BYTES);
}

function sanitizeRollTemplateSelector(rawSelector, usedTemplates) {
  const selector = String(rawSelector || "").trim();
  if (!selector || selector.length > 1000 || /[@{}]|:root|\b(?:html|body)\b/i.test(selector)) return "";
  const templateClasses = Array.from(selector.matchAll(/\.([a-zA-Z0-9_-]*sheet-rolltemplate-[a-zA-Z0-9_-]+)/g), (match) => match[1]);
  if (!templateClasses.some((className) => usedTemplates.has(className))) return "";
  return `.script-reader ${selector}`;
}

function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function normalizeLink(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return "";
  if (/^mailto:/i.test(value)) return value;
  try {
    const url = new URL(value, "https://app.roll20.net/");
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch (_error) {
    return "";
  }
}

function normalizeAssetUrl(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value || /^data:/i.test(value) || /^blob:/i.test(value)) return "";
  try {
    const url = new URL(value, "https://app.roll20.net/");
    if (!["http:", "https:"].includes(url.protocol)) return "";
    if (url.hostname === "app.roll20.net" && /^\/users\/avatar\//i.test(url.pathname)) return "";
    return url.href;
  } catch (_error) {
    return "";
  }
}

function resolveMessageKind(classes) {
  const kinds = ["whisper", "desc", "emote", "rollresult", "rolltemplate", "general"];
  return kinds.find((kind) => classes.includes(kind)) || "general";
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatBytesOrDash(value) {
  const bytes = Number(value) || 0;
  return bytes > 0 ? formatBytes(bytes) : "-";
}

function formatCount(value) {
  return (Number(value) || 0).toLocaleString("ko-KR");
}
