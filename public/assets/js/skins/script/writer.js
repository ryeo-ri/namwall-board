import { storage } from "../../core/firebase.js";
import {
  deleteObject,
  getDownloadURL,
  ref as storageRef,
  uploadBytes
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import { getScriptSourceLabel, processScriptHtml } from "./archive-processor.js";
import { createScriptArchiveId, uploadScriptArchive } from "./archive-io.js";

let activeContainer = null;
let selectedFile = null;
let processedSource = null;
let processedSourceMode = "";
let replacedAssetPaths = [];
let analysisToken = 0;

export function cleanupScriptWriter() {
  analysisToken += 1;
  activeContainer = null;
  selectedFile = null;
  processedSource = null;
  processedSourceMode = "";
  replacedAssetPaths = [];
}

export function renderArchiveField({ id, value, commonAttrs, wrapperAttrs }) {
  return `
    <div class="field-group write-skin-field script-import-field"${wrapperAttrs}>
      <label class="muted small" for="${id}">플레이 로그 HTML</label>
      <input ${commonAttrs} type="hidden" value="${escapeHtml(value)}">
      <div class="script-source-controls">
        <label class="muted small" for="${id}SourceType">로그 형식</label>
        <select id="${id}SourceType" data-script-source-mode>
          <option value="auto">자동 감지</option>
          <option value="roll20">Roll20</option>
          <option value="ccfolia">코코포리아</option>
        </select>
        <span class="muted small script-source-help">자동 판별 후 형식이 다르면 직접 변경하세요.</span>
      </div>
      <div class="script-import-dropzone" data-script-dropzone tabindex="0" role="button" aria-label="Roll20 또는 코코포리아 HTML 파일 선택">
        <button type="button" class="btn" data-script-file-select>HTML 선택</button>
        <span>Roll20 또는 코코포리아 로그 HTML을 끌어놓으세요.</span>
        <span class="muted small">불필요한 화면 코드는 제거하고 원본 로그 서식은 최대한 유지합니다.</span>
      </div>
      <input class="hidden" type="file" accept=".html,.htm,text/html" data-script-file-input>
      <label class="write-check script-image-backup-option">
        <input type="checkbox" data-script-backup-images checked>
        <span>로그 이미지도 WebP로 경량화하여 백업</span>
      </label>
      <div class="script-import-status" data-script-import-status aria-live="polite"></div>
      <dl class="script-import-result hidden" data-script-import-result aria-label="로그 분석 결과"></dl>
    </div>
  `;
}

export function bindScriptWriter({ container, post }) {
  if (!container) return;
  if (activeContainer !== container) {
    activeContainer = container;
    selectedFile = null;
    processedSource = null;
    processedSourceMode = "";
    replacedAssetPaths = [];
    analysisToken += 1;
  }

  const fileInput = container.querySelector("[data-script-file-input]");
  const selectButton = container.querySelector("[data-script-file-select]");
  const dropzone = container.querySelector("[data-script-dropzone]");
  const sourceModeSelect = container.querySelector("[data-script-source-mode]");
  const existing = post?.skinData?.script || {};
  if (existing.archiveUrl) {
    const existingSourceType = normalizeSourceMode(existing.sourceType);
    if (sourceModeSelect && existingSourceType !== "auto") {
      sourceModeSelect.value = existingSourceType;
      sourceModeSelect.dataset.autoResolved = "true";
    }
    if (Array.isArray(existing.assetPaths)) {
      setField(container, "script.assetPathsJson", JSON.stringify(existing.assetPaths));
    }
    renderImportResult(container, existing);
    setStatus(container, `저장된 로그 ${formatCount(existing.messageCount)}개 · 새 파일을 선택하면 교체됩니다.`);
  }

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

export async function prepareScriptWrite({ boardId, container, editingPost }) {
  const archiveUrlInput = getField(container, "script.archiveUrl");
  if (!selectedFile) {
    if (archiveUrlInput?.value) return;
    throw new Error("플레이 로그 HTML 파일을 선택하세요.");
  }

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
  let assetPaths = [];
  const shouldBackupImages = container.querySelector("[data-script-backup-images]")?.checked !== false;
  if (shouldBackupImages && archive.assets.length) {
    setStatus(container, `이미지 경량화 중 · 0 / ${archive.assets.length}`);
    const result = await backupAssets(archive.assets, boardId, archiveId, (done) => {
      setStatus(container, `이미지 경량화 중 · ${done} / ${archive.assets.length}`);
    });
    archive.assets = result.urls;
    assetPaths = result.paths;
    archivedAssetCount = result.paths.length;
  }

  setStatus(container, "로그 압축 및 업로드 중...");
  const uploadedArchive = await uploadScriptArchive({ archive, boardId, archiveId });

  setField(container, "script.archiveUrl", uploadedArchive.archiveUrl);
  setField(container, "script.archivePath", uploadedArchive.archivePath);
  setField(container, "script.archiveEncoding", uploadedArchive.archiveEncoding);
  setField(container, "script.archiveVersion", String(uploadedArchive.archiveVersion));
  setField(container, "script.archiveId", uploadedArchive.archiveId);
  setField(container, "script.sourceType", processedSource.sourceType);
  setField(container, "script.messageCount", String(processedSource.messageCount));
  setField(container, "script.assetCount", String(processedSource.assetCount));
  setField(container, "script.archivedAssetCount", String(archivedAssetCount));
  setField(container, "script.originalBytes", String(processedSource.originalBytes));
  setField(container, "script.normalizedBytes", String(processedSource.normalizedBytes));
  setField(container, "script.archiveBytes", String(uploadedArchive.archiveBytes));
  setField(container, "script.sourceFileName", processedSource.sourceFileName);
  setField(container, "script.assetPathsJson", JSON.stringify(assetPaths));
  const previous = editingPost?.skinData?.script || {};
  const previousArchivePaths = (Array.isArray(previous.archiveHistory) ? previous.archiveHistory : [])
    .map((entry) => entry?.archivePath);
  replacedAssetPaths = [
    previous.archivePath,
    ...(previous.assetPaths || []),
    ...previousArchivePaths
  ].filter(Boolean);

  renderImportResult(container, {
    ...processedSource,
    archivedAssetCount,
    archiveBytes: uploadedArchive.archiveBytes
  });
  setStatus(
    container,
    `업로드 완료 · 메시지 ${formatCount(processedSource.messageCount)}개 · ${formatBytes(processedSource.originalBytes)} → ${formatBytes(uploadedArchive.archiveBytes)}`
  );
}

export async function cleanupReplacedScriptArchive({ payload }) {
  const data = payload?.skinData?.script || {};
  const currentPaths = new Set([data.archivePath, ...(data.assetPaths || [])].filter(Boolean));
  const pathsToDelete = replacedAssetPaths.filter((path) => !currentPaths.has(path));
  replacedAssetPaths = [];
  await Promise.all(pathsToDelete.map(async (path) => {
    try {
      await deleteObject(storageRef(storage, path));
    } catch (error) {
      if (error?.code !== "storage/object-not-found") console.warn("Old SCRIPT asset cleanup failed.", error);
    }
  }));
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
    setStatus(
      container,
      `${sourceStatus} 완료 · 형식이 다르면 위 셀렉트에서 변경하세요.`
    );
  } catch (error) {
    if (token !== analysisToken) return;
    processedSource = null;
    processedSourceMode = "";
    updateImageBackupOption(container, null);
    renderImportResult(container, null);
    setStatus(container, error.message || "HTML 분석에 실패했습니다.", true);
  }
}

async function backupAssets(urls, boardId, archiveId, onProgress) {
  const output = urls.slice();
  const paths = [];
  let cursor = 0;
  let done = 0;
  const workers = Array.from({ length: Math.min(5, urls.length) }, async () => {
    while (cursor < urls.length) {
      const index = cursor++;
      try {
        const optimized = await fetchAndOptimizeImage(urls[index]);
        if (optimized) {
          const path = `script_assets/${safePathSegment(boardId)}/${safePathSegment(archiveId)}/${String(index).padStart(3, "0")}.webp`;
          const targetRef = storageRef(storage, path);
          await uploadBytes(targetRef, optimized, { contentType: "image/webp" });
          output[index] = await getDownloadURL(targetRef);
          paths.push(path);
        }
      } catch (_error) {
        // CORS or protected Roll20 assets remain as their lightweight external URL.
      } finally {
        done += 1;
        onProgress?.(done);
      }
    }
  });
  await Promise.all(workers);
  return { urls: output, paths };
}

async function fetchAndOptimizeImage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(url, { mode: "cors", credentials: "omit", signal: controller.signal });
    if (!response.ok) return null;
    const sourceBlob = await response.blob();
    if (!/^image\/(png|jpe?g|webp|avif)$/i.test(sourceBlob.type)) return null;
    const bitmap = await createImageBitmap(sourceBlob);
    const scale = Math.min(1, 960 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d", { alpha: true }).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    return await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.74));
  } finally {
    clearTimeout(timeout);
  }
}

function getField(container, key) {
  return container?.querySelector(`[data-skin-field="${cssEscape(key)}"]`) || null;
}

function setField(container, key, value) {
  const input = getField(container, key);
  if (input) input.value = String(value ?? "");
}

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

function safePathSegment(value) {
  return String(value || "script").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "script";
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

function cssEscape(value) {
  return window.CSS?.escape ? window.CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&");
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value || "");
  return div.innerHTML;
}
