// NAMWALL Edition Copyright (c) 2026 NAMWALL — MPL-2.0 (https://mozilla.org/MPL/2.0/)
// SCRIPT 스킨 글쓰기 — Roll20/코코포리아 로그 HTML(코코포리아 탭 로그 ZIP 포함)을 아카이브 JSON으로 정리해 나루 미디어에 올린다.
// 나루 미디어는 코드로 지울 수 없어, 로그를 교체해도 이전 파일은 미디어 라이브러리에 남는다.
import { escapeHtml } from "../core/site.js";
import { DROP_TAGS, normalizeSpeakerColor, sanitizeScriptHtml, sanitizeScriptStyle, sanitizeScriptCss } from "../shared/script-sanitizer.js";
import { MAX_MEDIA_BYTES, createMediaUploadSession } from "../shared/media-budget.js";

const MAX_SOURCE_BYTES = 100 * 1024 * 1024;
const MAX_ARCHIVE_CSS_BYTES = 160 * 1024;
const BLOCKED_TAGS = Array.from(DROP_TAGS).join(",");
const MEMBER_UPLOAD_LIMIT = 30; // 회원 미디어 업로드: 시간당 30개

let selectedFile = null;
let processedSource = null;
let processedSourceMode = "";
let analysisToken = 0;
// 파일·설정별 저장 작업 — 성공한 이미지와 아카이브는 등록 재시도 시 재사용한다.
let archiveJob = null;
let writerLocked = false;
let planning = false;
let preparing = false;
let analysisPromise = Promise.resolve();
// 코코포리아 탭 로그에서 올리지 않기로 한 탭(data-channel 값)
let excludedTabs = new Set();
const isBusy = () => writerLocked || planning || preparing;

export function setScriptWriterBusy(container, value) {
  writerLocked = value;
  container?.querySelectorAll("button, select, input").forEach((control) => { control.disabled = value; });
  container?.setAttribute("aria-busy", String(value));
  if (!value) updateImageBackupOption(container, processedSource);
}

/* ── 글쓰기 폼 바인딩 — write.html의 #scriptFields 안에서 동작 ── */
export function bindScriptWriter(container, existingScript = null) {
  if (!container) return;

  const fileInput = container.querySelector("[data-script-file-input]");
  const selectButton = container.querySelector("[data-script-file-select]");
  const dropzone = container.querySelector("[data-script-dropzone]");
  const sourceModeSelect = container.querySelector("[data-script-source-mode]");

  if (!isBusy() && existingScript?.archiveUrl) {
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

  selectButton?.addEventListener("click", () => { if (!isBusy()) fileInput?.click(); });
  fileInput?.addEventListener("change", () => selectSourceFile(fileInput.files?.[0], container));
  sourceModeSelect?.addEventListener("change", () => {
    if (isBusy()) return;
    sourceModeSelect.dataset.autoResolved = "false";
    processedSource = null;
    processedSourceMode = "";
    updateImageBackupOption(container, null);
    renderTabPicker(container, null);
    if (selectedFile) analysisPromise = analyzeSourceFile(selectedFile, container);
  });
  container.querySelector("[data-script-tab-picker]")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-script-tab]");
    if (button) toggleScriptTab(container, button.dataset.scriptTab);
  });
  dropzone?.addEventListener("click", (event) => {
    if (isBusy()) return;
    if (event.target.closest("button")) return;
    fileInput?.click();
  });
  dropzone?.addEventListener("keydown", (event) => {
    if (isBusy()) return;
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
    if (isBusy()) return;
    selectSourceFile(event.dataTransfer?.files?.[0], container);
  });
}

/* ── 저장 직전: 아카이브 업로드 → script 필드값 반환 ──
   새 파일이 없으면 기존 값을 그대로 돌려준다(수정 모드). */
export async function planScriptArchive({ container, existingScript = null }) {
  if (planning) throw new Error("로그를 정리하는 중입니다. 잠시 후 다시 저장해 주세요.");
  planning = true;
  const file = selectedFile;
  const requestedMode = getSourceMode(container);
  const backup = container.querySelector("[data-script-backup-images]")?.checked !== false;
  try {
    if (!file) {
      if (existingScript?.archiveUrl) return { result: { ...existingScript } };
      throw new Error("플레이 로그 파일을 선택하세요.");
    }
    await analysisPromise;
    const sourceMode = requestedMode === "auto" && processedSource ? processedSource.sourceType : requestedMode;
    if (archiveJob?.file === file && archiveJob.sourceMode === sourceMode && archiveJob.backup === backup) return archiveJob;
    let result = processedSource;
    if (!result || processedSourceMode !== sourceMode) {
      setStatus(container, "로그를 정리하는 중...");
      result = await processScriptHtml(file, { sourceType: sourceMode, excludedTabs });
    }
    processedSource = result;
    processedSourceMode = applyResolvedSourceMode(container, sourceMode, result);
    // 원본과 별도로 변환된 JSON의 실제 UTF-8 크기도 업로드 전에 검사한다.
    assertArchiveSize(new Blob([JSON.stringify(result.archive)]).size);
    const archive = structuredClone(result.archive);
    for (let index = 0; index < archive.messages.length; index += 1) {
      archive.messages[index].html = sanitizeScriptHtml(archive.messages[index].html);
      if (index && index % 300 === 0) await yieldToBrowser();
    }
    archive.css = sanitizeScriptCss(archive.css);
    // 파일 안에 든 캐릭터 아이콘은 올려야만 쓸 수 있다 — 저장을 끄면 아이콘 없이 올린다.
    const embedded = result.assetBlobs || [];
    if (!backup && embedded.length && archive.assets.every((url) => !url)) {
      archive.assets = [];
      archive.speakerAvatars = {};
    }
    const job = {
      file, sourceMode: result.sourceType, backup, archive, archiveId: createScriptArchiveId(),
      assets: archive.assets.map((url, index) => ({ original: url, url: null, skipped: false, blob: backup ? embedded[index] || null : null })),
      metadata: {
        sourceType: result.sourceType, sourceFileName: String(result.sourceFileName).slice(0, 200),
        messageCount: result.messageCount, assetCount: archive.assets.length,
        originalBytes: result.originalBytes, normalizedBytes: new Blob([JSON.stringify(archive)]).size
      }, result: null
    };
    // 백업 주소가 길어지는 경우에도 나루 주소(최대 2048자)를 담을 공간을 미리 확보한다.
    const growth = backup ? job.assets.reduce((sum, item) => sum + Math.max(0, 2048 - new Blob([JSON.stringify(item.original)]).size), 0) : 0;
    assertArchiveSize(job.metadata.normalizedBytes + growth);
    archiveJob = job;
    return job;
  } catch (error) {
    error.field = "scriptFile";
    throw error;
  } finally {
    planning = false;
  }
}

export function requiredScriptUploads(job) {
  if (job.result) return 0;
  return 1 + (job.backup ? job.assets.filter((item) => !item.url && !item.skipped).length : 0);
}

function assertArchiveSize(size) {
  if (size > MAX_MEDIA_BYTES) throw new Error("정리된 로그가 파일당 25MiB 한도를 넘습니다. HTML 로그를 나눠서 다시 선택해 주세요.");
}

export async function prepareScriptArchive({ container, uploader, existingScript = null, job = null, uploadSession = null }) {
  if (preparing) throw new Error("로그를 저장하는 중입니다.");
  preparing = true;
  try {
    const currentJob = job || await planScriptArchive({ container, existingScript });
    if (currentJob.result) return { ...currentJob.result };
    const session = uploadSession || await createMediaUploadSession(uploader);
    session.assertAvailable(requiredScriptUploads(currentJob));
    if (currentJob.backup && currentJob.assets.length) {
      await backupAssets(currentJob, session, (done) => {
        setStatus(container, `이미지 백업 중 · ${done} / ${currentJob.assets.length}`);
      });
    }
    const archive = { ...currentJob.archive, assets: currentJob.assets.map((item) => item.url || item.original) };
    const archiveFile = new File([JSON.stringify(archive)], `script-${currentJob.archiveId}.json`, { type: "text/plain" });
    assertArchiveSize(archiveFile.size);
    setStatus(container, "로그 업로드 중...");
    const uploaded = await session.upload(archiveFile);
    const archivedAssetCount = currentJob.assets.filter((item) => item.url).length;
    const script = {
      ...currentJob.metadata, archiveUrl: uploaded.url, archiveId: currentJob.archiveId,
      archiveEncoding: "identity", archiveVersion: 1, archivedAssetCount, archiveBytes: archiveFile.size
    };
    currentJob.result = script;
    renderImportResult(container, script);
    const unarchived = currentJob.backup ? currentJob.assets.length - archivedAssetCount : 0;
    setStatus(container, `업로드 완료 · 메시지 ${formatCount(script.messageCount)}개 · ${formatBytes(script.archiveBytes)}${unarchived ? ` · 이미지 ${unarchived}개는 백업하지 못해 원본 주소를 사용합니다.` : ""}`);
    return { ...script };
  } finally {
    preparing = false;
  }
}

async function selectSourceFile(file, container) {
  if (!file || isBusy()) return;
  if (!isZipFile(file) && !/\.html?$/i.test(file.name) && file.type !== "text/html") {
    setStatus(container, "HTML 또는 ZIP 파일만 선택할 수 있습니다.", true);
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
  excludedTabs = new Set();
  renderTabPicker(container, null);
  renderImportResult(container, null);
  analysisPromise = analyzeSourceFile(file, container);
  await analysisPromise;
}

async function analyzeSourceFile(file, container) {
  const token = ++analysisToken;
  const sourceMode = getSourceMode(container);
  try {
    setStatus(container, `${file.name} 분석 중...`);
    renderImportResult(container, null);
    const result = await processScriptHtml(file, { sourceType: sourceMode, excludedTabs });
    if (token !== analysisToken) return;
    processedSource = result;
    processedSourceMode = applyResolvedSourceMode(container, sourceMode, result);
    updateImageBackupOption(container, result);
    renderTabPicker(container, result);
    renderImportResult(container, result);
    const sourceStatus = sourceMode === "auto"
      ? `${result.sourceLabel} 자동 감지`
      : `${getScriptSourceLabel(sourceMode)} 선택`;
    const limitWarning = result.assetCount >= MEMBER_UPLOAD_LIMIT - 2
      ? ` · 이미지가 많아 회원 업로드 한도(시간당 ${MEMBER_UPLOAD_LIMIT}개)를 넘을 수 있습니다. 필요하면 이미지 백업을 꺼주세요.`
      : "";
    const tabNote = result.tabs?.length > 1 ? ` · 탭 ${result.tabs.length}개 — 올리지 않을 탭은 위에서 끄세요.` : "";
    setStatus(container, `${sourceStatus} 완료 · 형식이 다르면 위 셀렉트에서 변경하세요.${tabNote}${limitWarning}`);
  } catch (error) {
    if (token !== analysisToken) return;
    processedSource = null;
    processedSourceMode = "";
    updateImageBackupOption(container, null);
    renderTabPicker(container, null);
    renderImportResult(container, null);
    setStatus(container, error.message || "로그 분석에 실패했습니다.", true);
  }
}

/* 코코포리아 탭 로그: 올릴 탭 고르기 — 끈 탭은 아카이브에 아예 넣지 않는다(비밀 탭용). */
function renderTabPicker(container, result) {
  const picker = container?.querySelector("[data-script-tab-picker]");
  if (!picker) return;
  const tabs = result?.tabs || [];
  picker.classList.toggle("hidden", tabs.length < 2);
  picker.innerHTML = tabs.length < 2 ? "" : `<span class="muted small">올릴 탭</span>${tabs.map((tab) => `
    <button type="button" class="script-tab${tab.included ? " is-on" : ""}" data-script-tab="${escapeHtml(tab.key)}" aria-pressed="${tab.included}">
      ${escapeHtml(tab.label)} <span>${formatCount(tab.count)}</span>
    </button>`).join("")}`;
}

function toggleScriptTab(container, key) {
  if (isBusy() || !processedSource?.tabSource) return;
  const next = new Set(excludedTabs);
  if (!next.delete(key)) next.add(key);
  if (next.size >= processedSource.tabs.length) {
    setStatus(container, "탭을 하나 이상 남겨 주세요.", true);
    return;
  }
  excludedTabs = next;
  processedSource = buildCocofoliaTabResult(selectedFile, processedSource.tabSource, next);
  archiveJob = null;
  updateImageBackupOption(container, processedSource);
  renderTabPicker(container, processedSource);
  renderImportResult(container, processedSource);
  const { tabs, messageCount } = processedSource;
  setStatus(container, `탭 ${tabs.length}개 중 ${tabs.length - next.size}개를 올립니다 · 메시지 ${formatCount(messageCount)}개`);
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

async function backupAssets(job, session, onProgress) {
  let cursor = 0;
  let done = job.assets.filter((item) => item.url || item.skipped).length;
  let failure = null;
  onProgress?.(done);
  const workers = Array.from({ length: Math.min(3, job.assets.length) }, async () => {
    while (!failure && cursor < job.assets.length) {
      const index = cursor++;
      const item = job.assets[index];
      if (item.url || item.skipped) continue;
      try {
        if (!item.blob) {
          try { item.blob = await fetchOriginalImage(item.original); }
          catch (_error) { item.blob = null; }
          if (!item.blob || item.blob.size > MAX_MEDIA_BYTES) {
            item.skipped = true;
            continue;
          }
        }
        if (failure) break;
        const extension = BACKUP_IMAGE_EXTENSIONS[item.blob.type.toLowerCase()];
        const assetFile = new File([item.blob], `script-${job.archiveId}-${String(index).padStart(3, "0")}.${extension}`, { type: item.blob.type });
        const result = await session.upload(assetFile);
        item.url = result.url;
        item.blob = null;
      } catch (error) {
        // 실제 업로드 실패는 재시도할 수 있게 남긴다. 다른 작업자의 성공 결과도 모두 회수한다.
        failure ||= error;
      } finally {
        done += 1;
        onProgress?.(done);
      }
    }
  });
  await Promise.all(workers);
  if (failure) throw failure;
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
  // 코코포리아 옛 형식은 이미지가 없다. 탭 로그는 캐릭터 아이콘이 파일 안에 들어 있어 문구를 바꿔 보여준다.
  const hasEmbedded = Boolean(result?.assetBlobs?.length);
  const hidden = isCocofolia && !hasEmbedded;
  option?.classList.toggle("hidden", hidden);
  option?.querySelectorAll("[data-script-backup-text]").forEach((text) => {
    text.classList.toggle("hidden", (text.dataset.scriptBackupText === "embedded") !== hasEmbedded);
  });
  if (input) input.disabled = hidden;
}

/* ── 로그 분석 — Roll20·코코포리아(탭 로그·ZIP 포함), 브라우저 DOM만 사용 ── */

async function processScriptHtml(file, { sourceType = "auto", excludedTabs: excluded } = {}) {
  if (!(file instanceof File)) throw new Error("가져올 로그 파일을 선택하세요.");
  if (file.size > MAX_SOURCE_BYTES) throw new Error("원본 파일은 100MB 이하만 가져올 수 있습니다.");

  // ZIP이면 안의 HTML들을(큰 것부터), 아니면 그 파일 하나를 읽는다.
  const sources = isZipFile(file) ? await readZipHtmlEntries(file) : [{ name: file.name, text: await file.text() }];
  const requestedType = normalizeSourceMode(sourceType);
  const tabLogs = requestedType === "roll20" ? [] : sources.filter((item) => isCocofoliaTabLog(item.text));
  if (tabLogs.length) return processCocofoliaTabLogs(file, tabLogs, excluded);

  const source = sources[0].text;
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
    const speakerColor = normalizeSpeakerColor(paragraph.style?.color);
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

/* ── 코코포리아 탭 로그(+ZIP): .message-list 안에 article.message[data-channel]이 시간순으로 놓이고,
   캐릭터 아이콘은 <style>의 .avatar-image-N 배경(data URL)으로 들어 있다. ── */
const COCOFOLIA_TAB_LABELS = { main: "메인", other: "잡담", info: "정보" };
const COCOFOLIA_ROLL_CLASSES = {
  success: "ccfolia-roll-success",
  failure: "ccfolia-roll-fail",
  critical: "ccfolia-roll-critical",
  fumble: "ccfolia-roll-fumble"
};

function isZipFile(file) {
  return /\.zip$/i.test(file?.name || "") || /^application\/(?:zip|x-zip-compressed)$/i.test(file?.type || "");
}

function isCocofoliaTabLog(source) {
  return /<main\b[^>]*\bmessage-list\b/i.test(source) && /<article\b[^>]*\bdata-channel\s*=/i.test(source);
}

// 1단계: 파일을 읽어 메시지 기록으로 — 탭을 켜고 끌 때는 이 결과를 다시 쓴다(재분석 없음).
async function processCocofoliaTabLogs(file, sources, excluded) {
  const records = [];
  const labels = new Map();
  const covered = new Set();
  let title = "";
  let fileCount = 0;
  // 큰 파일부터: '전체' 파일이 있으면 그것만 쓰고, 탭별 파일뿐이면 겹치지 않는 것끼리 합친다.
  for (const source of sources) {
    const channels = new Set(Array.from(
      source.text.matchAll(/<article\b[^>]*\bdata-channel\s*=\s*["']([^"']*)["']/gi),
      (match) => match[1]
    ));
    if (!channels.size || Array.from(channels).some((key) => covered.has(key))) continue;
    channels.forEach((key) => covered.add(key));

    const parsed = new DOMParser().parseFromString(source.text, "text/html");
    const avatars = new Map();
    const styleText = Array.from(parsed.querySelectorAll("style"), (style) => style.textContent).join("\n");
    for (const match of styleText.matchAll(/\.avatar-image-(\d+)\s*\{\s*background-image\s*:\s*url\(\s*["']?([^"')]+)/gi)) {
      avatars.set(match[1], match[2].trim());
    }
    const documentTitle = normalizeText(parsed.title);
    const tabName = /\[([^\[\]]+)\]$/.exec(documentTitle)?.[1] || /\[([^\[\]]+)\]\.html?$/i.exec(source.name)?.[1] || "";
    title ||= documentTitle.replace(/\s*\[[^\[\]]*\]$/, "");

    const articles = parsed.querySelectorAll(".message-list article.message");
    let time = 0;
    for (let index = 0; index < articles.length; index += 1) {
      if (index && index % 300 === 0) await yieldToBrowser();
      const article = articles[index];
      const key = article.getAttribute("data-channel") || "";
      const label = normalizeText(article.querySelector(".channel-name")?.textContent).replace(/^\[|\]$/g, "").trim();
      if (label && !labels.has(key)) labels.set(key, label);
      // 시스템 메시지는 시각이 없다 — 바로 앞 메시지의 시각을 물려받아 제자리를 지킨다.
      time = Date.parse(article.querySelector("time")?.getAttribute("datetime") || "") || time;
      const speakerEl = article.querySelector(".speaker");
      const rollEl = article.querySelector(".roll-result");
      const text = String(article.querySelector(".message-text")?.textContent || "").replace(/\r\n?/g, "\n").trim();
      const roll = normalizeText(rollEl?.textContent);
      if (!text && !roll) continue;
      const rollName = roll ? Object.keys(COCOFOLIA_ROLL_CLASSES).find((name) => rollEl.classList.contains(name)) : "";
      records.push({
        key,
        speaker: normalizeText(speakerEl?.textContent),
        color: normalizeSpeakerColor(/--speaker-color\s*:\s*([^;]+)/i.exec(speakerEl?.getAttribute("style") || "")?.[1]),
        text,
        roll,
        rollClass: COCOFOLIA_ROLL_CLASSES[rollName] || "",
        system: article.classList.contains("system"),
        avatar: avatars.get(/avatar-image-(\d+)/.exec(article.querySelector(".avatar")?.className || "")?.[1]) || "",
        time,
        file: fileCount,
        order: index
      });
    }
    if (channels.size === 1 && tabName) {
      const [only] = channels;
      if (!labels.has(only)) labels.set(only, tabName);
    }
    fileCount += 1;
  }
  if (!records.length) throw new Error("코코포리아 로그 메시지를 찾지 못했습니다.");
  if (fileCount > 1) records.sort((a, b) => a.time - b.time || a.file - b.file || a.order - b.order);

  const tabs = new Map();
  records.forEach(({ key }) => {
    if (!tabs.has(key)) tabs.set(key, { key, label: labels.get(key) || COCOFOLIA_TAB_LABELS[key] || key || "탭", count: 0 });
    tabs.get(key).count += 1;
  });
  // 코코포리아와 같은 순서: 메인 · 정보 · 잡담 · 그 밖의 탭(나온 순서)
  const rank = (key) => (["main", "info", "other"].indexOf(key) + 4) % 4;
  return buildCocofoliaTabResult(file, {
    title: title || String(file.name || "ccfolia-log").replace(/\.(?:html?|zip)$/i, "").trim(),
    records,
    tabs: Array.from(tabs.values()).sort((a, b) => rank(a.key) - rank(b.key)),
    blobs: new Map()
  }, excluded);
}

// 2단계: 켜진 탭의 기록만 아카이브로. 캐릭터 아이콘은 화자마다 가장 많이 쓴 것 하나만 올린다.
function buildCocofoliaTabResult(file, parsed, excluded) {
  const skip = excluded instanceof Set ? excluded : new Set();
  const labels = new Map(parsed.tabs.map((tab) => [tab.key, tab.label]));
  const messages = [];
  const usage = new Map();
  let previous = null;
  parsed.records.forEach((record) => {
    if (skip.has(record.key)) return;
    const { key, speaker, color, text, roll } = record;
    const kind = roll || record.system ? "rollresult" : "general";
    const continuesSpeaker = kind === "general"
      && previous?.kind === "general"
      && speaker
      && speaker === previous.speaker
      && key === previous.key;
    const speakerHtml = speaker && !continuesSpeaker
      ? `<span class="by ccfolia-speaker"${color ? ` style="--script-speaker-color:${color}"` : ""}>${escapeHtml(speaker)}</span>`
      : "";
    const body = escapeHtml(text).replace(/\n/g, "<br>");
    const classes = ["message", kind, "ccfolia-message"];
    if (kind === "rollresult") classes.push("ccfolia-roll");
    if (record.rollClass) classes.push(record.rollClass);
    if (record.system) classes.push("ccfolia-system");
    if (key === "other") classes.push("ccfolia-chat");

    messages.push({
      kind,
      classes,
      html: kind === "general"
        ? `${speakerHtml}${body}`
        : `${speakerHtml}<span class="ccfolia-roll-content">${[roll && body ? `<b>${body}</b>` : body, escapeHtml(roll)].filter(Boolean).join("<br>")}</span>`,
      text: [speaker, normalizeText(text), roll].filter(Boolean).join(" "),
      channel: labels.get(key),
      speaker,
      speakerColor: color
    });
    previous = { kind, speaker, key };
    if (speaker && record.avatar) {
      if (!usage.has(speaker)) usage.set(speaker, new Map());
      usage.get(speaker).set(record.avatar, (usage.get(speaker).get(record.avatar) || 0) + 1);
    }
  });
  if (!messages.length) throw new Error("가져올 코코포리아 로그 메시지가 없습니다.");

  const assets = [];
  const assetBlobs = [];
  const assetIndexes = new Map();
  const speakerAvatars = {};
  usage.forEach((counts, speaker) => {
    const [source] = Array.from(counts).sort((a, b) => b[1] - a[1])[0];
    let index = assetIndexes.get(source);
    if (index == null) {
      if (!parsed.blobs.has(source)) parsed.blobs.set(source, dataUrlToBlob(source));
      const blob = parsed.blobs.get(source);
      const url = blob ? "" : normalizeAssetUrl(source);
      if (!blob && !url) return;
      index = assets.length;
      assetIndexes.set(source, index);
      // 파일 안에 든 아이콘은 주소가 없다 — 올린 뒤 나루 주소로 채운다(prepareScriptArchive).
      assets.push(url);
      assetBlobs.push(blob);
    }
    speakerAvatars[speaker] = index;
  });

  const archive = {
    version: 1,
    source: "ccfolia",
    title: parsed.title,
    createdAt: new Date().toISOString(),
    css: "",
    assets,
    speakerAvatars,
    narratorSpeakers: [],
    tabs: parsed.tabs.filter((tab) => !skip.has(tab.key)).map((tab) => tab.label),   // 상세의 탭 줄 순서
    messages
  };
  return {
    ...buildProcessResult(file, archive, "ccfolia"),
    assetBlobs,
    tabs: parsed.tabs.map((tab) => ({ ...tab, included: !skip.has(tab.key) })),
    tabSource: parsed
  };
}

function dataUrlToBlob(dataUrl) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(dataUrl);
  const type = match?.[1].toLowerCase();
  if (!BACKUP_IMAGE_EXTENSIONS[type]) return null;
  try {
    const binary = atob(match[2].replace(/\s+/g, ""));
    return new Blob([Uint8Array.from(binary, (character) => character.charCodeAt(0))], { type });
  } catch (_error) {
    return null;
  }
}

/* ── ZIP에서 HTML만 꺼내기 — 브라우저 내장 압축 해제(DecompressionStream)만 쓴다 ── */
async function readZipHtmlEntries(file) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("이 브라우저에서는 ZIP을 열 수 없습니다. 압축을 풀어 HTML 파일을 선택해 주세요.");
  }
  try {
    return await extractZipHtml(new Uint8Array(await file.arrayBuffer()));
  } catch (error) {
    // 깨진 ZIP은 범위 밖 읽기(RangeError)나 압축 해제 오류(TypeError)로 드러난다.
    if (error instanceof RangeError || error instanceof TypeError) {
      throw new Error("ZIP 파일을 읽지 못했습니다. 압축을 풀어 HTML 파일을 선택해 주세요.");
    }
    throw error;
  }
}

async function extractZipHtml(bytes) {
  const view = new DataView(bytes.buffer);
  // 끝에서부터 중앙 디렉터리 끝 표식(EOCD)을 찾는다.
  let end = bytes.length - 22;
  const stop = Math.max(0, end - 0xffff);
  while (end >= stop && view.getUint32(end, true) !== 0x06054b50) end -= 1;
  if (end < stop) throw new RangeError("EOCD not found");

  const entries = [];
  let total = 0;
  let offset = view.getUint32(end + 16, true);
  for (let count = view.getUint16(end + 10, true); count > 0; count -= 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new RangeError("Bad central directory");
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const packed = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const local = view.getUint32(offset + 42, true);
    const name = decodeZipName(bytes.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    if (!/\.html?$/i.test(name) || /(?:^|\/)(?:__MACOSX\/|\._[^/]*$)/.test(name)) continue;
    if (flags & 1) throw new Error("암호가 걸린 ZIP은 열 수 없습니다.");
    if ((method !== 0 && method !== 8) || [packed, size, local].includes(0xffffffff)) {
      throw new Error("지원하지 않는 ZIP 형식입니다. 압축을 풀어 HTML 파일을 선택해 주세요.");
    }
    total += size;
    entries.push({ name: name.split("/").pop(), method, packed, size, local });
  }
  if (!entries.length) throw new Error("ZIP 안에 HTML 로그가 없습니다.");
  if (total > MAX_SOURCE_BYTES) throw new Error("압축을 푼 로그는 100MB 이하만 가져올 수 있습니다.");

  entries.sort((a, b) => b.size - a.size);
  const sources = [];
  for (const entry of entries) {
    const start = entry.local + 30 + view.getUint16(entry.local + 26, true) + view.getUint16(entry.local + 28, true);
    const data = bytes.subarray(start, start + entry.packed);
    const text = entry.method === 0
      ? new TextDecoder().decode(data)
      : await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text();
    sources.push({ name: entry.name, text });
  }
  return sources;
}

function decodeZipName(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (_error) {
    return new TextDecoder("euc-kr").decode(bytes);   // 옛 압축 프로그램의 한글 파일명
  }
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
      const style = sanitizeScriptStyle(attribute.value);
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
      const declarations = sanitizeScriptStyle(ruleMatch[2]);
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
