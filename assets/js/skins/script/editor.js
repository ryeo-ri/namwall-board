import { db } from "../../core/firebase.js";
import { getPostSkinData } from "../registry.js";
import {
  createScriptArchiveId,
  deleteScriptArchive,
  deleteScriptAsset,
  loadScriptArchive,
  normalizeScriptNarratorSpeakers,
  normalizeScriptSpeakerAvatars,
  uploadScriptArchive,
  uploadScriptAsset
} from "./archive-io.js";
import {
  applyScriptArchiveCss,
  createScriptMessageNode,
  decorateScriptMessageFlow,
  extractScriptMessageContent,
  getScriptMessageSpeaker,
  getScriptMessageText,
  isHiddenScriptMessage,
  mergeScriptMessageContent,
  normalizeScriptMessageKind,
  sanitizeScriptMessageContent,
  setScriptMessageKind
} from "./message-dom.js";
import {
  doc,
  getDoc,
  serverTimestamp,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const LIST_CHUNK_SIZE = 150;
const HISTORY_LIMIT = 3;
const UNDO_LIMIT = 100;
const MAX_AVATAR_FILE_BYTES = 20 * 1024 * 1024;
const AVATAR_OUTPUT_SIZE = 256;
const INTERNAL_ID = "__scriptEditorId";
const KIND_LABELS = {
  general: "대사",
  desc: "나레이션",
  emote: "행동",
  whisper: "귓속말"
};

let postId = "";
let boardId = "";
let titleEl = null;
let metaEl = null;
let undoButton = null;
let saveButton = null;
let noticeEl = null;
let searchInput = null;
let kindFilter = null;
let jumpForm = null;
let jumpInput = null;
let countEl = null;
let listPane = null;
let listEl = null;
let loadMoreButton = null;
let emptyEl = null;
let formEl = null;
let indexEl = null;
let messageKindField = null;
let messageKindInput = null;
let speakerEl = null;
let contentEl = null;
let insertBeforeButton = null;
let insertAfterButton = null;
let deleteButton = null;
let previewReader = null;
let previewMessagesEl = null;
let avatarManagerEl = null;
let avatarCountEl = null;
let avatarListEl = null;
let avatarFileInput = null;

let post = null;
let board = null;
let archive = null;
let assets = [];
let speakerAvatars = Object.create(null);
let narratorSpeakers = new Set();
let pendingAvatars = new Map();
let avatarTargetSpeaker = "";
let messages = [];
let selectedId = "";
let activeEditBaseline = null;
let loadedArchivePath = "";
let visibleStart = 0;
let visibleLimit = LIST_CHUNK_SIZE;
let undoStack = [];
let dirty = false;
let draftTouched = false;
let saving = false;
let filterTimer = 0;
let previewFrame = 0;

function showNotice(message, isError = false) {
  if (!noticeEl) return;
  noticeEl.textContent = String(message || "");
  noticeEl.classList.toggle("hidden", !message);
  noticeEl.classList.toggle("notice-error", Boolean(isError));
}

function cloneSpeakerAvatarMap(value = speakerAvatars) {
  const output = Object.create(null);
  Object.entries(value || {}).forEach(([speaker, index]) => {
    output[speaker] = Number(index);
  });
  return output;
}

function getMessageSpeaker(message) {
  return String(message?.speaker || getScriptMessageSpeaker(message?.html)).trim();
}

function isNarratorCharacter(speaker) {
  return Boolean(speaker) && narratorSpeakers.has(speaker);
}

function getDisplayMessageKind(message) {
  return isNarratorCharacter(getMessageSpeaker(message))
    ? "desc"
    : normalizeScriptMessageKind(message?.kind);
}

function serializeNarratorSpeakers() {
  return getSpeakerSummaries()
    .map(({ speaker }) => speaker)
    .filter((speaker) => narratorSpeakers.has(speaker));
}

function getSpeakerSummaries() {
  const summaries = new Map();
  messages.forEach((message) => {
    const speaker = getMessageSpeaker(message);
    if (!speaker) return;
    if (!summaries.has(speaker)) {
      summaries.set(speaker, {
        speaker,
        count: 0,
        color: normalizeSpeakerColor(message?.speakerColor)
      });
    }
    const summary = summaries.get(speaker);
    summary.count += 1;
    if (!summary.color) summary.color = normalizeSpeakerColor(message?.speakerColor);
  });
  return Array.from(summaries.values());
}

function normalizeSpeakerColor(value) {
  const color = String(value || "").trim();
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return color;
  if (/^rgba?\([\d\s,.%]+\)$/i.test(color)) return color;
  return "";
}

function getSpeakerAvatarIndex(speaker) {
  if (!Object.prototype.hasOwnProperty.call(speakerAvatars, speaker)) return null;
  const index = Number(speakerAvatars[speaker]);
  return Number.isInteger(index) && index >= 0 && index < assets.length ? index : null;
}

function isSafeAvatarUrl(value) {
  try {
    return ["http:", "https:", "blob:"].includes(new URL(String(value || "")).protocol);
  } catch (_error) {
    return false;
  }
}

function getSpeakerAvatarPreviewUrl(speaker) {
  const pending = pendingAvatars.get(speaker);
  if (pending?.previewUrl && isSafeAvatarUrl(pending.previewUrl)) return pending.previewUrl;
  const index = getSpeakerAvatarIndex(speaker);
  const url = index == null ? "" : String(assets[index] || "");
  return isSafeAvatarUrl(url) ? url : "";
}

function setPendingAvatar(speaker, blob = null) {
  const current = pendingAvatars.get(speaker);
  if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
  pendingAvatars.delete(speaker);
  if (!(blob instanceof Blob)) return;
  pendingAvatars.set(speaker, {
    blob,
    previewUrl: URL.createObjectURL(blob)
  });
}

function clearPendingAvatars() {
  pendingAvatars.forEach((entry) => {
    if (entry?.previewUrl) URL.revokeObjectURL(entry.previewUrl);
  });
  pendingAvatars.clear();
  avatarTargetSpeaker = "";
}

function captureSpeakerAvatarState(speaker) {
  const assetIndex = getSpeakerAvatarIndex(speaker);
  return {
    assetIndex,
    pendingBlob: pendingAvatars.get(speaker)?.blob || null
  };
}

function restoreSpeakerAvatarState(speaker, state = {}) {
  setPendingAvatar(speaker, state.pendingBlob || null);
  if (Number.isInteger(state.assetIndex)) speakerAvatars[speaker] = state.assetIndex;
  else delete speakerAvatars[speaker];
}

function renderAvatarManager() {
  if (!avatarManagerEl || !avatarListEl) return;
  const isCocofolia = String(archive?.source || "").toLowerCase() === "ccfolia";
  avatarManagerEl.classList.toggle("hidden", !isCocofolia);
  if (!isCocofolia) {
    avatarListEl.replaceChildren();
    return;
  }

  const speakers = getSpeakerSummaries();
  const registered = speakers.filter(({ speaker }) => Boolean(getSpeakerAvatarPreviewUrl(speaker))).length;
  const narratorCount = speakers.filter(({ speaker }) => narratorSpeakers.has(speaker)).length;
  if (avatarCountEl) avatarCountEl.textContent = `${registered} / ${speakers.length} 아바타 · ${narratorCount} 나레이션`;
  if (!speakers.length) {
    avatarListEl.innerHTML = '<p class="muted small">설정할 캐릭터 정보가 없습니다.</p>';
    return;
  }

  avatarListEl.innerHTML = speakers.map(({ speaker, count, color }) => {
    const previewUrl = getSpeakerAvatarPreviewUrl(speaker);
    const hasPending = pendingAvatars.has(speaker);
    const isNarrator = narratorSpeakers.has(speaker);
    const colorStyle = color ? ` style="--script-speaker-color:${escapeHtml(color)}"` : "";
    return `
      <article class="script-avatar-card"${colorStyle}>
        <div class="script-avatar-preview${previewUrl ? " has-image" : ""}">
          ${previewUrl
            ? `<img src="${escapeHtml(previewUrl)}" alt="${escapeHtml(speaker)} 아바타">`
            : '<span aria-hidden="true">+</span>'}
        </div>
        <div class="script-avatar-info">
          <div class="script-character-name">
            <span class="script-character-color" aria-hidden="true"></span>
            <strong>${escapeHtml(speaker)}</strong>
          </div>
          <span>${count.toLocaleString("ko-KR")}개 대사${hasPending ? " · 저장 대기" : ""}</span>
          <label class="script-narrator-check">
            <input type="checkbox" data-script-narrator-speaker="${escapeHtml(speaker)}"${isNarrator ? " checked" : ""}>
            <span>나레이션</span>
          </label>
        </div>
        <div class="script-avatar-actions">
          <button type="button" class="btn" data-script-avatar-select="${escapeHtml(speaker)}">${previewUrl ? "변경" : "등록"}</button>
          ${previewUrl ? `<button type="button" class="btn" data-script-avatar-remove="${escapeHtml(speaker)}">삭제</button>` : ""}
        </div>
      </article>
    `;
  }).join("");
}

function cloneMessage(message) {
  return {
    ...message,
    classes: Array.isArray(message?.classes) ? message.classes.slice() : []
  };
}

function createEditorId(prefix = "message") {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const suffix = Array.from(bytes, (byte) => byte.toString(36).padStart(2, "0")).join("").slice(0, 10);
  return `${prefix}_${Date.now()}_${suffix}`;
}

function normalizeMessage(message, index) {
  const normalized = cloneMessage(message || {});
  normalized.kind = normalizeScriptMessageKind(normalized.kind);
  normalized.classes = Array.isArray(normalized.classes) ? normalized.classes : ["message", normalized.kind];
  normalized.html = String(normalized.html || "");
  normalized.text = getScriptMessageText(normalized.html);
  normalized[INTERNAL_ID] = createEditorId(`m${index + 1}`);
  return normalized;
}

function getMessageIndex(id = selectedId) {
  return messages.findIndex((message) => message[INTERNAL_ID] === id);
}

function getSelectedMessage() {
  const index = getMessageIndex();
  return index >= 0 ? messages[index] : null;
}

function messagesEqual(left, right) {
  if (!left || !right) return false;
  return left.kind === right.kind
    && left.html === right.html
    && left.text === right.text
    && JSON.stringify(left.classes || []) === JSON.stringify(right.classes || []);
}

function buildDraftMessage() {
  const current = getSelectedMessage();
  if (!current || !activeEditBaseline) return current;
  const next = cloneMessage(current);
  const content = sanitizeScriptMessageContent(contentEl?.innerHTML || "", assets.length);
  next.html = mergeScriptMessageContent(activeEditBaseline.html, content, assets.length);
  const nextKind = isNarratorCharacter(getMessageSpeaker(current))
    ? current.kind
    : (messageKindInput?.value || current.kind);
  setScriptMessageKind(next, nextKind);
  next.text = getScriptMessageText(next.html);
  return next;
}

function commitActiveEdit() {
  const index = getMessageIndex();
  if (index < 0 || !activeEditBaseline) {
    draftTouched = false;
    return false;
  }

  const next = buildDraftMessage();
  const changed = !messagesEqual(next, activeEditBaseline);
  if (changed) {
    pushUndo({ type: "replace", id: selectedId, before: cloneMessage(activeEditBaseline) });
    messages[index] = next;
    dirty = true;
  }

  activeEditBaseline = cloneMessage(messages[index]);
  if (contentEl) contentEl.innerHTML = extractScriptMessageContent(messages[index].html);
  syncSelectedKindControl(messages[index]);
  draftTouched = false;
  updateControls();
  return changed;
}

function pushUndo(operation) {
  undoStack.push(operation);
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
}

function hasPendingChanges() {
  return dirty || draftTouched;
}

function updateControls() {
  const hasChanges = hasPendingChanges();
  if (saveButton) saveButton.disabled = saving || !hasChanges;
  if (undoButton) undoButton.disabled = saving || (!undoStack.length && !draftTouched);
  if (contentEl) contentEl.contentEditable = saving ? "false" : "true";
  const selectedNarrator = isNarratorCharacter(getMessageSpeaker(getSelectedMessage()));
  if (messageKindInput) messageKindInput.disabled = saving || !selectedId || selectedNarrator;
  [insertBeforeButton, insertAfterButton, deleteButton].forEach((element) => {
    if (element) element.disabled = saving || !selectedId;
  });
  if (avatarFileInput) avatarFileInput.disabled = saving;
  avatarListEl?.querySelectorAll("button, input").forEach((control) => {
    control.disabled = saving;
  });
}

function getFilteredMessages() {
  const query = String(searchInput?.value || "").trim().toLocaleLowerCase("ko-KR");
  const kind = String(kindFilter?.value || "").trim();
  return messages.map((message, index) => ({ message, index })).filter(({ message }) => {
    if (kind && getDisplayMessageKind(message) !== kind) return false;
    if (!query) return true;
    return String(message.text || getScriptMessageText(message.html)).toLocaleLowerCase("ko-KR").includes(query);
  });
}

function renderMessageList({ preserveScroll = false } = {}) {
  if (!listEl) return;
  const previousScrollTop = listPane?.scrollTop || 0;
  const filtered = getFilteredMessages();
  const safeStart = Math.min(visibleStart, Math.max(0, filtered.length - 1));
  visibleStart = safeStart;
  const visible = filtered.slice(safeStart, safeStart + visibleLimit);
  if (jumpInput) jumpInput.max = String(messages.length || 1);
  if (countEl) {
    countEl.textContent = safeStart > 0
      ? `#${(safeStart + 1).toLocaleString("ko-KR")}–${(safeStart + visible.length).toLocaleString("ko-KR")} / ${filtered.length.toLocaleString("ko-KR")}`
      : `${filtered.length.toLocaleString("ko-KR")} / ${messages.length.toLocaleString("ko-KR")}`;
  }

  listEl.innerHTML = visible.map(({ message, index }) => {
    const id = message[INTERNAL_ID];
    const kind = getDisplayMessageKind(message);
    const kindLabel = KIND_LABELS[kind] || "";
    const speaker = String(message.speaker || getScriptMessageSpeaker(message.html)).trim();
    const text = String(message.text || getScriptMessageText(message.html) || "내용 없음").trim();
    return `
      <button
        type="button"
        class="script-editor-list-item${id === selectedId ? " is-selected" : ""}${isHiddenScriptMessage(message) ? " is-hidden-message" : ""}"
        data-script-message-id="${escapeHtml(id)}"
        role="option"
        aria-selected="${id === selectedId ? "true" : "false"}"
      >
        <span class="script-editor-list-meta">
          <strong>#${index + 1}</strong>
          ${kindLabel ? `<span>${escapeHtml(kindLabel)}</span>` : ""}
          ${speaker ? `<span>${escapeHtml(speaker)}</span>` : ""}
        </span>
        <span class="script-editor-list-text">${escapeHtml(text)}</span>
      </button>
    `;
  }).join("");

  listEl.querySelectorAll("[data-script-message-id]").forEach((button) => {
    button.addEventListener("click", () => selectMessage(button.dataset.scriptMessageId));
  });
  loadMoreButton?.classList.toggle("hidden", safeStart + visible.length >= filtered.length);
  if (preserveScroll && listPane) listPane.scrollTop = previousScrollTop;
}

function jumpToMessageNumber() {
  const number = Number.parseInt(String(jumpInput?.value || ""), 10);
  if (!Number.isInteger(number) || number < 1 || number > messages.length) {
    showNotice(`1~${messages.length.toLocaleString("ko-KR")} 사이의 로그 번호를 입력하세요.`, true);
    jumpInput?.focus();
    return;
  }

  const targetIndex = number - 1;
  const target = messages[targetIndex];
  if (!target) return;
  if (searchInput) searchInput.value = "";
  if (kindFilter) kindFilter.value = "";
  visibleStart = targetIndex;
  visibleLimit = LIST_CHUNK_SIZE;
  renderMessageList();
  selectMessage(target[INTERNAL_ID]);

  requestAnimationFrame(() => {
    if (listPane) listPane.scrollTop = 0;
  });
  showNotice(`#${number.toLocaleString("ko-KR")} 로그로 이동했습니다.`);
}

function selectMessage(id) {
  if (!id || id === selectedId) return;
  const changed = commitActiveEdit();
  selectedId = id;
  const message = getSelectedMessage();
  if (!message) {
    clearSelection();
    return;
  }

  activeEditBaseline = cloneMessage(message);
  draftTouched = false;
  emptyEl?.classList.add("hidden");
  formEl?.classList.remove("hidden");
  if (contentEl) contentEl.innerHTML = extractScriptMessageContent(message.html);
  syncSelectedKindControl(message);
  renderSelectedMeta();
  renderPreview(message);
  renderMessageList({ preserveScroll: true });
  if (changed) showNotice("메시지 변경사항을 임시 저장했습니다. 상단 저장 버튼을 눌러 반영하세요.");
  updateControls();
}

function syncSelectedKindControl(message = getSelectedMessage()) {
  const isNarrator = isNarratorCharacter(getMessageSpeaker(message));
  const kind = normalizeScriptMessageKind(message?.kind);
  const visibleKind = isNarrator || Object.prototype.hasOwnProperty.call(KIND_LABELS, kind);
  messageKindField?.classList.toggle("hidden", !visibleKind);
  if (messageKindInput) messageKindInput.value = visibleKind ? (isNarrator ? "desc" : kind) : "";
}

function clearSelection() {
  selectedId = "";
  activeEditBaseline = null;
  draftTouched = false;
  emptyEl?.classList.remove("hidden");
  formEl?.classList.add("hidden");
  if (previewMessagesEl) previewMessagesEl.innerHTML = "";
  updateControls();
}

function renderSelectedMeta() {
  const index = getMessageIndex();
  const message = index >= 0 ? messages[index] : null;
  if (!message) return;
  if (indexEl) indexEl.textContent = `#${index + 1}`;
  const speaker = getMessageSpeaker(message);
  if (speakerEl) {
    speakerEl.textContent = speaker
      ? `캐릭터 · ${speaker}${isNarratorCharacter(speaker) ? " · 나레이션 지정" : ""}`
      : "캐릭터 정보 없음";
  }
}

function renderPreview(message = buildDraftMessage()) {
  if (!previewMessagesEl || !message) return;
  previewMessagesEl.replaceChildren();
  const speaker = getMessageSpeaker(message);
  const node = createScriptMessageNode(message, assets, {
    speakerAvatars,
    speakerAvatarUrl: pendingAvatars.get(speaker)?.previewUrl || "",
    narratorSpeakers
  });
  decorateScriptMessageFlow(node, true);
  previewMessagesEl.appendChild(node);
}

function schedulePreview() {
  cancelAnimationFrame(previewFrame);
  previewFrame = requestAnimationFrame(() => renderPreview());
}

function markDraftChanged() {
  if (!selectedId || saving) return;
  draftTouched = true;
  schedulePreview();
  updateControls();
}

async function optimizeAvatarFile(file) {
  if (!(file instanceof File)) throw new Error("아바타 이미지 파일을 선택하세요.");
  const supportedType = /^image\/(?:png|jpe?g|webp|gif|avif)$/i.test(file.type || "");
  const supportedName = /\.(?:png|jpe?g|webp|gif|avif)$/i.test(file.name || "");
  if (!supportedType && !supportedName) {
    throw new Error("PNG, JPG, WebP, GIF, AVIF 이미지만 사용할 수 있습니다.");
  }
  if (file.size > MAX_AVATAR_FILE_BYTES) throw new Error("아바타 이미지는 20MB 이하만 사용할 수 있습니다.");

  let bitmap = null;
  try {
    bitmap = await createImageBitmap(file);
    if (!bitmap.width || !bitmap.height) throw new Error("이미지 크기를 확인할 수 없습니다.");
    const side = Math.min(bitmap.width, bitmap.height);
    const sourceX = Math.max(0, (bitmap.width - side) / 2);
    const sourceY = 0;
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_OUTPUT_SIZE;
    canvas.height = AVATAR_OUTPUT_SIZE;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("이미지를 변환할 수 없습니다.");
    context.drawImage(
      bitmap,
      sourceX,
      sourceY,
      side,
      side,
      0,
      0,
      AVATAR_OUTPUT_SIZE,
      AVATAR_OUTPUT_SIZE
    );
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
    if (!(blob instanceof Blob)) throw new Error("WebP 이미지 변환에 실패했습니다.");
    return blob;
  } catch (_error) {
    throw new Error("아바타 이미지를 읽지 못했습니다.");
  } finally {
    bitmap?.close?.();
  }
}

async function handleAvatarFileChange() {
  const speaker = avatarTargetSpeaker;
  const file = avatarFileInput?.files?.[0] || null;
  if (avatarFileInput) avatarFileInput.value = "";
  avatarTargetSpeaker = "";
  if (!speaker || !file || saving) return;

  try {
    showNotice(`${speaker} 아바타를 정리하는 중입니다.`);
    const blob = await optimizeAvatarFile(file);
    commitActiveEdit();
    pushUndo({ type: "avatar", speaker, before: captureSpeakerAvatarState(speaker) });
    setPendingAvatar(speaker, blob);
    dirty = true;
    renderAvatarManager();
    renderPreview();
    updateControls();
    showNotice(`${speaker} 아바타를 저장 대기 상태로 추가했습니다.`);
  } catch (error) {
    showNotice(error.message || "아바타 이미지를 처리하지 못했습니다.", true);
  }
}

function handleAvatarListClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  const selectButton = target?.closest("[data-script-avatar-select]");
  if (selectButton) {
    if (saving) return;
    avatarTargetSpeaker = String(selectButton.dataset.scriptAvatarSelect || "").trim();
    avatarFileInput?.click();
    return;
  }

  const removeButton = target?.closest("[data-script-avatar-remove]");
  if (!removeButton || saving) return;
  const speaker = String(removeButton.dataset.scriptAvatarRemove || "").trim();
  if (!speaker || (!pendingAvatars.has(speaker) && getSpeakerAvatarIndex(speaker) == null)) return;
  commitActiveEdit();
  pushUndo({ type: "avatar", speaker, before: captureSpeakerAvatarState(speaker) });
  setPendingAvatar(speaker, null);
  delete speakerAvatars[speaker];
  dirty = true;
  renderAvatarManager();
  renderPreview();
  updateControls();
  showNotice(`${speaker} 아바타를 삭제 대기 상태로 변경했습니다.`);
}

function handleCharacterListChange(event) {
  const target = event.target instanceof Element ? event.target : null;
  const input = target?.closest("[data-script-narrator-speaker]");
  if (!input || saving) return;
  const speaker = String(input.dataset.scriptNarratorSpeaker || "").trim();
  const before = narratorSpeakers.has(speaker);
  const next = Boolean(input.checked);
  if (!speaker || before === next) return;

  commitActiveEdit();
  pushUndo({ type: "narrator", speaker, before });
  if (next) narratorSpeakers.add(speaker);
  else narratorSpeakers.delete(speaker);
  dirty = true;
  renderAvatarManager();
  renderMessageList({ preserveScroll: true });
  syncSelectedKindControl();
  renderSelectedMeta();
  renderPreview();
  updateControls();
  showNotice(next
    ? `${speaker} 캐릭터를 나레이션으로 지정했습니다.`
    : `${speaker} 캐릭터의 나레이션 지정을 해제했습니다.`);
}

function insertMessage(offset) {
  commitActiveEdit();
  const selectedIndex = getMessageIndex();
  const insertIndex = selectedIndex < 0
    ? messages.length
    : Math.max(0, Math.min(messages.length, selectedIndex + offset));
  const message = {
    kind: "general",
    classes: ["message", "general"],
    html: "새 메시지",
    text: "새 메시지",
    [INTERNAL_ID]: createEditorId("new")
  };
  messages.splice(insertIndex, 0, message);
  pushUndo({ type: "insert", id: message[INTERNAL_ID] });
  dirty = true;
  selectedId = "";
  activeEditBaseline = null;
  visibleLimit = Math.max(visibleLimit, insertIndex + 1);
  renderMessageList({ preserveScroll: true });
  selectMessage(message[INTERNAL_ID]);
  showNotice("새 메시지를 추가했습니다. 내용을 수정한 뒤 저장하세요.");
}

function deleteSelectedMessage() {
  commitActiveEdit();
  const index = getMessageIndex();
  if (index < 0) return;
  const removed = cloneMessage(messages[index]);
  messages.splice(index, 1);
  pushUndo({ type: "delete", index, message: removed });
  dirty = true;
  const nextId = messages[index]?.[INTERNAL_ID] || messages[index - 1]?.[INTERNAL_ID] || "";
  selectedId = "";
  activeEditBaseline = null;
  renderMessageList({ preserveScroll: true });
  if (nextId) selectMessage(nextId);
  else clearSelection();
  showNotice("메시지를 삭제했습니다. 상단 저장 버튼을 눌러 반영하세요.");
}

function undoLastChange() {
  const hadDraft = draftTouched;
  const committedDraft = commitActiveEdit();
  if (hadDraft && !committedDraft) {
    const current = getSelectedMessage();
    if (current) {
      activeEditBaseline = cloneMessage(current);
      if (contentEl) contentEl.innerHTML = extractScriptMessageContent(current.html);
      syncSelectedKindControl(current);
      renderPreview(current);
    }
    updateControls();
    return;
  }

  const operation = undoStack.pop();
  if (!operation) return;
  if (operation.type === "avatar") {
    restoreSpeakerAvatarState(operation.speaker, operation.before);
    dirty = undoStack.length > 0;
    renderAvatarManager();
    renderPreview();
    updateControls();
    showNotice(`${operation.speaker} 아바타 변경을 취소했습니다.`);
    return;
  }
  if (operation.type === "narrator") {
    if (operation.before) narratorSpeakers.add(operation.speaker);
    else narratorSpeakers.delete(operation.speaker);
    dirty = undoStack.length > 0;
    renderAvatarManager();
    renderMessageList({ preserveScroll: true });
    syncSelectedKindControl();
    renderSelectedMeta();
    renderPreview();
    updateControls();
    showNotice(`${operation.speaker} 캐릭터의 나레이션 설정 변경을 취소했습니다.`);
    return;
  }
  let nextSelection = selectedId;

  if (operation.type === "replace") {
    const index = getMessageIndex(operation.id);
    if (index >= 0) messages[index] = cloneMessage(operation.before);
    nextSelection = operation.id;
  } else if (operation.type === "insert") {
    const index = getMessageIndex(operation.id);
    if (index >= 0) {
      messages.splice(index, 1);
      nextSelection = messages[index]?.[INTERNAL_ID] || messages[index - 1]?.[INTERNAL_ID] || "";
    }
  } else if (operation.type === "delete") {
    const index = Math.max(0, Math.min(messages.length, Number(operation.index) || 0));
    messages.splice(index, 0, cloneMessage(operation.message));
    nextSelection = operation.message[INTERNAL_ID];
  }

  dirty = undoStack.length > 0;
  selectedId = "";
  activeEditBaseline = null;
  draftTouched = false;
  renderMessageList({ preserveScroll: true });
  if (nextSelection) selectMessage(nextSelection);
  else clearSelection();
  showNotice("마지막 변경을 취소했습니다.");
}

function serializeMessages() {
  return messages.map((message) => {
    const output = cloneMessage(message);
    delete output[INTERNAL_ID];
    output.kind = normalizeScriptMessageKind(output.kind);
    output.html = String(output.html || "").trim();
    output.text = String(output.text || getScriptMessageText(output.html));
    return output;
  });
}

function buildArchiveHistoryEntry(script = {}) {
  const archivePath = String(script.archivePath || "").trim();
  const archiveUrl = String(script.archiveUrl || "").trim();
  if (!archivePath || !archiveUrl) return null;
  return {
    archiveId: String(script.archiveId || ""),
    archivePath,
    archiveUrl,
    archiveEncoding: script.archiveEncoding === "gzip" ? "gzip" : "identity",
    archiveVersion: Number(script.archiveVersion) || 1,
    archiveBytes: Number(script.archiveBytes) || 0,
    messageCount: Number(script.messageCount) || 0,
    archivedAt: new Date().toISOString()
  };
}

function normalizeArchiveHistory(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.filter((entry) => {
    const path = String(entry?.archivePath || "").trim();
    if (!path || seen.has(path)) return false;
    seen.add(path);
    return true;
  }).map((entry) => ({ ...entry }));
}

async function saveArchive() {
  if (saving) return;
  commitActiveEdit();
  if (!dirty) {
    showNotice("변경된 내용이 없습니다.");
    return;
  }
  if (!messages.length) {
    showNotice("플레이 로그에는 메시지가 하나 이상 필요합니다.", true);
    return;
  }

  saving = true;
  updateControls();
  showNotice("변경사항을 저장할 준비를 하는 중입니다.");
  let uploaded = null;
  const uploadedAssetPaths = [];

  try {
    const serializedMessages = serializeMessages();
    const archiveId = createScriptArchiveId();
    const nextAssets = assets.slice();
    const nextSpeakerAvatars = cloneSpeakerAvatarMap();
    const nextNarratorSpeakers = serializeNarratorSpeakers();
    const pendingEntries = Array.from(pendingAvatars.entries());
    for (let index = 0; index < pendingEntries.length; index += 1) {
      const [speaker, pending] = pendingEntries[index];
      showNotice(`아바타 업로드 중 · ${index + 1} / ${pendingEntries.length}`);
      const uploadedAsset = await uploadScriptAsset({
        blob: pending.blob,
        boardId,
        archiveId,
        fileName: `avatar_${String(index + 1).padStart(3, "0")}.webp`
      });
      uploadedAssetPaths.push(uploadedAsset.assetPath);
      nextSpeakerAvatars[speaker] = nextAssets.length;
      nextAssets.push(uploadedAsset.assetUrl);
    }

    const nextArchive = {
      ...archive,
      assets: nextAssets,
      speakerAvatars: nextSpeakerAvatars,
      narratorSpeakers: nextNarratorSpeakers,
      messages: serializedMessages,
      editedAt: new Date().toISOString(),
      editorVersion: 2,
      revision: (Number(archive.revision) || 0) + 1
    };
    const normalizedBytes = new TextEncoder().encode(JSON.stringify(nextArchive)).byteLength;
    showNotice("새 아카이브를 압축하고 업로드하는 중입니다.");
    uploaded = await uploadScriptArchive({ archive: nextArchive, boardId, archiveId });

    const postRef = doc(db, "posts", postId);
    const latestSnap = await getDoc(postRef);
    if (!latestSnap.exists()) throw new Error("게시물이 삭제되어 저장할 수 없습니다.");
    const latestPost = { id: latestSnap.id, ...latestSnap.data() };
    const latestScript = getPostSkinData(latestPost).script || {};
    const latestArchivePath = String(latestScript.archivePath || "").trim();
    if (loadedArchivePath && latestArchivePath && latestArchivePath !== loadedArchivePath) {
      throw new Error("다른 화면에서 플레이 로그가 교체되었습니다. 새로고침 후 다시 수정해 주세요.");
    }

    const previousEntry = buildArchiveHistoryEntry(latestScript);
    const historyCandidates = [previousEntry, ...normalizeArchiveHistory(latestScript.archiveHistory)].filter(Boolean);
    const history = [];
    const seenPaths = new Set();
    historyCandidates.forEach((entry) => {
      const path = String(entry.archivePath || "").trim();
      if (!path || seenPaths.has(path) || path === uploaded.archivePath) return;
      seenPaths.add(path);
      history.push(entry);
    });
    const keptHistory = history.slice(0, HISTORY_LIMIT);
    const expiredHistory = history.slice(HISTORY_LIMIT);
    const assetPaths = Array.from(new Set([
      ...(Array.isArray(latestScript.assetPaths) ? latestScript.assetPaths : []),
      ...uploadedAssetPaths
    ].map((path) => String(path || "").trim()).filter(Boolean)));

    const nextScript = {
      ...latestScript,
      ...uploaded,
      messageCount: serializedMessages.length,
      assetCount: nextAssets.length,
      assetPaths,
      normalizedBytes,
      archiveHistory: keptHistory
    };
    await updateDoc(postRef, {
      "skinData.script": nextScript,
      updatedAt: serverTimestamp()
    });

    archive = nextArchive;
    assets = nextAssets;
    speakerAvatars = nextSpeakerAvatars;
    narratorSpeakers = new Set(nextNarratorSpeakers);
    clearPendingAvatars();
    post = latestPost;
    post.skinData = { ...(post.skinData || {}), script: nextScript };
    loadedArchivePath = uploaded.archivePath;
    undoStack = [];
    dirty = false;
    draftTouched = false;
    activeEditBaseline = cloneMessage(getSelectedMessage());
    if (metaEl) metaEl.textContent = `${messages.length.toLocaleString("ko-KR")}개 메시지 · 저장 완료`;
    renderAvatarManager();
    renderPreview();
    updateControls();
    showNotice("플레이 로그 변경사항을 저장했습니다.");

    await Promise.all(expiredHistory.map((entry) => (
      deleteScriptArchive(entry.archivePath).catch((error) => console.warn("Old SCRIPT revision cleanup failed:", error))
    )));
  } catch (error) {
    if (uploaded?.archivePath) {
      await deleteScriptArchive(uploaded.archivePath).catch(() => {});
    }
    await Promise.all(uploadedAssetPaths.map((path) => deleteScriptAsset(path).catch(() => {})));
    console.error("SCRIPT message editor save failed:", error);
    showNotice(error.message || "플레이 로그 변경사항 저장에 실패했습니다.", true);
  } finally {
    saving = false;
    updateControls();
  }
}

function insertPlainText(text) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const fragment = document.createDocumentFragment();
  let lastNode = null;
  String(text || "").replace(/\r\n?/g, "\n").split("\n").forEach((line, index) => {
    if (index > 0) {
      lastNode = document.createElement("br");
      fragment.appendChild(lastNode);
    }
    if (line) {
      lastNode = document.createTextNode(line);
      fragment.appendChild(lastNode);
    }
  });
  if (!lastNode) return;
  range.insertNode(fragment);
  range.setStartAfter(lastNode);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  markDraftChanged();
}

function bindEvents() {
  searchInput?.addEventListener("input", () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => {
      visibleStart = 0;
      visibleLimit = LIST_CHUNK_SIZE;
      renderMessageList();
    }, 100);
  });
  kindFilter?.addEventListener("change", () => {
    visibleStart = 0;
    visibleLimit = LIST_CHUNK_SIZE;
    renderMessageList();
  });
  jumpForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    jumpToMessageNumber();
  });
  loadMoreButton?.addEventListener("click", () => {
    visibleLimit += LIST_CHUNK_SIZE;
    renderMessageList({ preserveScroll: true });
  });
  listPane?.addEventListener("scroll", () => {
    if (listPane.scrollHeight - listPane.scrollTop - listPane.clientHeight > 180) return;
    if (loadMoreButton?.classList.contains("hidden")) return;
    visibleLimit += LIST_CHUNK_SIZE;
    renderMessageList({ preserveScroll: true });
  });

  contentEl?.addEventListener("input", markDraftChanged);
  contentEl?.addEventListener("paste", (event) => {
    const text = event.clipboardData?.getData("text/plain") || "";
    if (!text) return;
    event.preventDefault();
    insertPlainText(text);
  });
  messageKindInput?.addEventListener("change", markDraftChanged);
  insertBeforeButton?.addEventListener("click", () => insertMessage(0));
  insertAfterButton?.addEventListener("click", () => insertMessage(1));
  deleteButton?.addEventListener("click", deleteSelectedMessage);
  avatarListEl?.addEventListener("click", handleAvatarListClick);
  avatarListEl?.addEventListener("change", handleCharacterListChange);
  avatarFileInput?.addEventListener("change", handleAvatarFileChange);
  undoButton?.addEventListener("click", undoLastChange);
  saveButton?.addEventListener("click", saveArchive);

  window.removeEventListener("beforeunload", handleBeforeUnload);
  window.addEventListener("beforeunload", handleBeforeUnload);
}

function handleBeforeUnload(event) {
  if (!hasPendingChanges() || saving) return;
  event.preventDefault();
  event.returnValue = "";
}

function canLeaveScriptEditor() {
  if (saving) return false;
  if (!hasPendingChanges()) return true;
  return window.confirm("저장하지 않은 변경사항이 있습니다. 이 화면에서 나가시겠습니까?");
}

function unmountScriptEditor() {
  window.removeEventListener("beforeunload", handleBeforeUnload);
  resetEditorState();
  clearEditorElementReferences();
  postId = "";
  boardId = "";
  post = null;
  board = null;
}

function clearEditorElementReferences() {
  titleEl = null;
  metaEl = null;
  undoButton = null;
  saveButton = null;
  noticeEl = null;
  searchInput = null;
  kindFilter = null;
  jumpForm = null;
  jumpInput = null;
  countEl = null;
  listPane = null;
  listEl = null;
  loadMoreButton = null;
  emptyEl = null;
  formEl = null;
  indexEl = null;
  messageKindField = null;
  messageKindInput = null;
  speakerEl = null;
  contentEl = null;
  insertBeforeButton = null;
  insertAfterButton = null;
  deleteButton = null;
  previewReader = null;
  previewMessagesEl = null;
  avatarManagerEl = null;
  avatarCountEl = null;
  avatarListEl = null;
  avatarFileInput = null;
}

function renderScriptEditorMarkup() {
  return `
    <div class="script-editor-app" id="scriptEditorApp">
      <details class="script-avatar-manager hidden" id="scriptAvatarManager" open>
        <summary>
          <span class="script-avatar-manager-title">
            <strong>캐릭터 설정</strong>
            <span>코코포리아 아바타와 출력 형식</span>
          </span>
          <span class="script-avatar-manager-count" id="scriptAvatarCount"></span>
        </summary>
        <div class="script-avatar-manager-body">
          <p class="muted small">이미지는 256px 정사각형 WebP로 중앙 크롭됩니다. 나레이션 지정 시 해당 캐릭터의 모든 대사가 나레이션 형식으로 출력됩니다.</p>
          <div class="script-avatar-list" id="scriptAvatarList"></div>
          <input
            class="hidden"
            id="scriptAvatarFile"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/avif,.png,.jpg,.jpeg,.webp,.gif,.avif"
          >
        </div>
      </details>

      <div class="script-editor-toolbar">
        <label class="script-editor-search" for="scriptEditorSearch">
          <span class="sr-only">메시지 검색</span>
          <input id="scriptEditorSearch" type="search" placeholder="캐릭터명이나 내용 검색" autocomplete="off">
        </label>
        <label class="script-editor-filter" for="scriptEditorKindFilter">
          <span class="sr-only">메시지 종류</span>
          <select id="scriptEditorKindFilter">
            <option value="">전체 종류</option>
            <option value="general">대사</option>
            <option value="desc">나레이션</option>
            <option value="emote">행동</option>
            <option value="whisper">귓속말</option>
          </select>
        </label>
        <form class="script-editor-jump" id="scriptEditorJumpForm">
          <label class="sr-only" for="scriptEditorJumpInput">로그 번호로 이동</label>
          <input id="scriptEditorJumpInput" type="number" min="1" step="1" inputmode="numeric" placeholder="로그 번호">
          <button type="submit" class="btn">이동</button>
        </form>
        <span class="script-editor-count" id="scriptEditorResultCount"></span>
      </div>

      <div class="script-editor-workspace">
        <aside class="script-editor-list-pane" aria-label="메시지 목록">
          <div class="script-editor-list" id="scriptEditorList" role="listbox"></div>
          <button type="button" class="btn script-editor-load-more hidden" id="scriptEditorLoadMore">더 보기</button>
        </aside>

        <section class="script-editor-detail-pane">
          <div class="script-editor-empty" id="scriptEditorEmpty">왼쪽에서 수정할 메시지를 선택하세요.</div>
          <div class="script-editor-form hidden" id="scriptEditorForm">
            <div class="script-editor-message-head">
              <span class="script-editor-message-index" id="scriptEditorIndex"></span>
              <label for="scriptEditorKind" data-script-kind-field>
                <span class="sr-only">메시지 종류</span>
                <select id="scriptEditorKind">
                  <option value="general">대사</option>
                  <option value="desc">나레이션</option>
                  <option value="emote">행동</option>
                  <option value="whisper">귓속말</option>
                </select>
              </label>
              <span class="script-editor-speaker" id="scriptEditorSpeaker"></span>
            </div>

            <div class="field-group">
              <label for="scriptEditorContent">메시지 내용</label>
              <div
                class="script-editor-content"
                id="scriptEditorContent"
                contenteditable="true"
                role="textbox"
                aria-multiline="true"
                spellcheck="false"
              ></div>
              <div class="muted small">캐릭터명, 아바타, 원본 메시지 클래스는 유지됩니다. 붙여넣기는 일반 텍스트로 들어갑니다.</div>
            </div>

            <div class="formRow script-editor-message-actions">
              <button type="button" class="btn" id="scriptEditorInsertBefore">앞에 추가</button>
              <button type="button" class="btn" id="scriptEditorInsertAfter">뒤에 추가</button>
              <button type="button" class="btn" id="scriptEditorDelete">메시지 삭제</button>
            </div>

            <div class="script-editor-preview-block">
              <span class="script-editor-preview-label">PREVIEW</span>
              <div class="script-reader script-editor-preview-reader" id="scriptEditorPreviewReader">
                <div class="script-messages" id="scriptEditorPreviewMessages"></div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  `;
}

function cacheEditorElements(root, ui = {}) {
  titleEl = ui.titleEl || null;
  metaEl = ui.metaEl || null;
  noticeEl = ui.noticeEl || null;
  if (ui.actionsEl) {
    ui.actionsEl.innerHTML = `
      <button type="button" class="btn" id="scriptEditorUndo" disabled>실행 취소</button>
      <button type="button" class="btn primary" id="scriptEditorSave" disabled>저장</button>
    `;
  }
  root.innerHTML = renderScriptEditorMarkup();

  undoButton = ui.actionsEl?.querySelector("#scriptEditorUndo") || null;
  saveButton = ui.actionsEl?.querySelector("#scriptEditorSave") || null;
  avatarManagerEl = root.querySelector("#scriptAvatarManager");
  avatarCountEl = root.querySelector("#scriptAvatarCount");
  avatarListEl = root.querySelector("#scriptAvatarList");
  avatarFileInput = root.querySelector("#scriptAvatarFile");
  searchInput = root.querySelector("#scriptEditorSearch");
  kindFilter = root.querySelector("#scriptEditorKindFilter");
  jumpForm = root.querySelector("#scriptEditorJumpForm");
  jumpInput = root.querySelector("#scriptEditorJumpInput");
  countEl = root.querySelector("#scriptEditorResultCount");
  listPane = root.querySelector(".script-editor-list-pane");
  listEl = root.querySelector("#scriptEditorList");
  loadMoreButton = root.querySelector("#scriptEditorLoadMore");
  emptyEl = root.querySelector("#scriptEditorEmpty");
  formEl = root.querySelector("#scriptEditorForm");
  indexEl = root.querySelector("#scriptEditorIndex");
  messageKindField = root.querySelector("[data-script-kind-field]");
  messageKindInput = root.querySelector("#scriptEditorKind");
  speakerEl = root.querySelector("#scriptEditorSpeaker");
  contentEl = root.querySelector("#scriptEditorContent");
  insertBeforeButton = root.querySelector("#scriptEditorInsertBefore");
  insertAfterButton = root.querySelector("#scriptEditorInsertAfter");
  deleteButton = root.querySelector("#scriptEditorDelete");
  previewReader = root.querySelector("#scriptEditorPreviewReader");
  previewMessagesEl = root.querySelector("#scriptEditorPreviewMessages");
}

function resetEditorState() {
  clearTimeout(filterTimer);
  cancelAnimationFrame(previewFrame);
  clearPendingAvatars();
  archive = null;
  assets = [];
  speakerAvatars = Object.create(null);
  narratorSpeakers = new Set();
  messages = [];
  selectedId = "";
  activeEditBaseline = null;
  loadedArchivePath = "";
  visibleStart = 0;
  visibleLimit = LIST_CHUNK_SIZE;
  undoStack = [];
  dirty = false;
  draftTouched = false;
  saving = false;
  filterTimer = 0;
  previewFrame = 0;
}

async function mountScriptEditor(context = {}) {
  if (!context.root) throw new Error("편집기를 표시할 영역이 없습니다.");
  resetEditorState();
  post = context.post || {};
  board = context.board || {};
  postId = String(context.postId || post.id || "").trim();
  boardId = String(context.boardId || board.id || post.boardId || "").trim();
  if (!postId || !boardId) throw new Error("편집할 게시물 정보가 올바르지 않습니다.");

  cacheEditorElements(context.root, context.ui);
  const script = getPostSkinData(post).script || {};
  if (!script.archiveUrl) throw new Error("저장된 플레이 로그 파일이 없습니다.");

  loadedArchivePath = String(script.archivePath || "").trim();
  archive = await loadScriptArchive(script.archiveUrl, { cache: "no-store" });
  assets = Array.isArray(archive.assets) ? archive.assets.slice() : [];
  speakerAvatars = normalizeScriptSpeakerAvatars(archive.speakerAvatars, assets.length);
  narratorSpeakers = new Set(normalizeScriptNarratorSpeakers(archive.narratorSpeakers));
  messages = archive.messages.map(normalizeMessage);

  const title = post.title || script.scenario || "플레이 로그";
  document.title = `${title} 메시지 편집`;
  if (titleEl) titleEl.textContent = title;
  if (metaEl) metaEl.textContent = `${messages.length.toLocaleString("ko-KR")}개 메시지 · ${board.title || board.name || boardId}`;

  applyScriptArchiveCss(previewReader, archive.css);
  bindEvents();
  renderAvatarManager();
  renderMessageList();
  if (messages[0]) selectMessage(messages[0][INTERNAL_ID]);
  else clearSelection();
  updateControls();
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value || "");
  return div.innerHTML;
}

export const editor = {
  id: "script-message-editor",
  label: "로그 편집",
  kicker: "SCRIPT MESSAGE EDITOR",
  unavailableMessage: "저장된 플레이 로그 파일이 없습니다.",
  canEdit({ post: targetPost } = {}) {
    return Boolean(getPostSkinData(targetPost).script?.archiveUrl);
  },
  mount: mountScriptEditor,
  canLeave: canLeaveScriptEditor,
  unmount: unmountScriptEditor
};

export default editor;
