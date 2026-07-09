import { db, storage } from "../core/firebase.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getDownloadURL,
  ref,
  uploadBytes
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import { sanitizeHTML } from "../shared/html-sanitizer-v2.js";
import { getYoutubeThumbnailUrl, normalizeVideoEmbedInput, renderPostVideoFrame } from "../shared/post-cover.js";
import {
  canWriteToBoard,
  clearGuestState,
  getAuthSnapshot,
  getGuestProofHash,
  isGuestCooldownPassed,
  touchGuestCooldown,
  verifyGuestCode,
  sha256Hex
} from "../core/state.js";
import { showInputModal } from "../shared/ui-modal.js";
import {
  findSkinTypeByAlias,
  getBoardAliasCandidates as getSkinBoardAliasCandidates,
  getPostSkinData,
  getSkin,
  resolveBoardSkinType
} from "../skins/registry.js";

const params = new URLSearchParams(window.location.search);
const editPostId = params.get("id");
const preselectBoardId = params.get("bo") || "";
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const boardSelect = document.getElementById("boardSelect");
const boardCurrentValueEl = document.getElementById("boardCurrentValue");
const authorNameInput = document.getElementById("authorNameInput");
const authorCurrentValueEl = document.getElementById("authorCurrentValue");
const titleInput = document.getElementById("titleInput");
const imageUrlInput = document.getElementById("imageUrlInput");
const thumbModeUrlRadio = document.getElementById("thumbModeUrl");
const thumbModeFileRadio = document.getElementById("thumbModeFile");
const thumbModeVideoRadio = document.getElementById("thumbModeVideo");
const thumbUrlFieldsEl = document.getElementById("thumbUrlFields");
const thumbFileFieldsEl = document.getElementById("thumbFileFields");
const thumbVideoFieldsEl = document.getElementById("thumbVideoFields");
const thumbVideoInput = document.getElementById("thumbVideoInput");
const thumbPreviewEl = document.getElementById("thumbPreview");
const selectThumbFileBtn = document.getElementById("selectThumbFileBtn");
const clearThumbFileBtn = document.getElementById("clearThumbFileBtn");
const thumbFilePathInput = document.getElementById("thumbFilePathInput");
const thumbFileInput = document.getElementById("thumbFileInput");
const thumbSectionEl = document.getElementById("thumbSection");

const extraItemsEl = document.getElementById("extraItems");
const addExtraItemBtn = document.getElementById("addExtraItemBtn");
const extraModeUrlRadio = document.getElementById("extraModeUrl");
const extraModeFileRadio = document.getElementById("extraModeFile");
const extraModeVideoRadio = document.getElementById("extraModeVideo");
const extraUrlFieldsEl = document.getElementById("extraUrlFields");
const extraVideoFieldsEl = document.getElementById("extraVideoFields");
const extraFileFieldsEl = document.getElementById("extraFileFields");
const extraImageUrlInput = document.getElementById("extraImageUrlInput");
const extraVideoInput = document.getElementById("extraVideoInput");
const extraPendingPreviewEl = document.getElementById("extraPendingPreview");
const selectExtraFileBtn = document.getElementById("selectExtraFileBtn");
const clearExtraFileBtn = document.getElementById("clearExtraFileBtn");
const extraFilePathInput = document.getElementById("extraFilePathInput");
const extraFileInput = document.getElementById("extraFileInput");

const logNumberInput = document.getElementById("logNumberInput");
const sourceInput = document.getElementById("sourceInput");
const extraImageAlignInput = document.getElementById("extraImageAlignInput");
const extraImageAlignFieldEl = document.getElementById("extraImageAlignField");
const visibilityInput = document.getElementById("visibilityInput");
const htmlModeInput = document.getElementById("htmlModeInput");
const secretPwWrap = document.getElementById("secretPwWrap");
const secretPwInput = document.getElementById("secretPwInput");
const contentInput = document.getElementById("contentInput");
const tagsInput = document.getElementById("tagsInput");
const saveBtn = document.getElementById("saveBtn");
const msgEl = document.getElementById("writeMsg");
const uploadMsgEl = document.getElementById("uploadMsg");
const titleFieldsEl = document.getElementById("titleFields");
const profileOnlyFieldsEl = document.getElementById("profileOnlyFields");
const contentFieldsEl = document.getElementById("contentFields");
const visibilityFieldsEl = document.getElementById("visibilityFields");
const extraFieldsEl = document.getElementById("extraFields");
const tagFieldsEl = document.getElementById("tagFields");
const skinFieldsTitleEl = document.getElementById("skinFieldsTitle");
const skinFieldsContainerEl = document.getElementById("skinFieldsContainer");
const profileSkinFieldsHelpEl = document.getElementById("profileSkinFieldsHelp");

let boards = [];
let activeBoardId = "";
let uploadedThumbnail = null;
let uploadedExtraAttachments = [];
let fixedAdminNickname = "";
let fixedAuthorName = "";
let extraItems = [];
let stagedExtraAttachments = [];
let stagedThumbFile = null;
let thumbPreviewBlobUrl = "";
let editingPost = null;
const stagedSkinImageFiles = new Map();
const stagedSkinImagePreviewUrls = new Map();
const nextLogNumberCache = new Map();

function showMsg(text, isError = false) {
  msgEl.classList.remove("hidden");
  msgEl.textContent = text;
  msgEl.style.borderColor = isError ? "rgba(220,38,38,.4)" : "rgba(15,23,42,.18)";
}

function showUploadMsg(text, isError = false) {
  if (!uploadMsgEl) return;
  uploadMsgEl.classList.remove("hidden");
  uploadMsgEl.textContent = text;
  uploadMsgEl.style.borderColor = isError ? "rgba(220,38,38,.4)" : "rgba(15,23,42,.18)";
}

function getBoardAliasCandidates(rawBoardId) {
  return getSkinBoardAliasCandidates(rawBoardId, findSkinTypeByAlias(rawBoardId));
}

function getBoardLabel(board) {
  if (!board) return "";
  const title = board.title || board.name || board.id || "";
  const skinType = resolveBoardSkinType(board);
  return skinType ? `${title} · ${skinType}` : title;
}

function resolveCanonicalBoardId(rawBoardId) {
  const normalized = String(rawBoardId || "").trim().toLowerCase();
  if (!normalized) return "";

  const exact = boards.find((board) => String(board.id || "").trim().toLowerCase() === normalized);
  if (exact) return exact.id;

  const aliasCandidateList = getBoardAliasCandidates(normalized);
  const aliasCandidates = new Set(aliasCandidateList);
  const aliasMatchedBoards = boards.filter((board) => aliasCandidates.has(String(board.id || "").trim().toLowerCase()));
  if (aliasMatchedBoards.length === 1) return aliasMatchedBoards[0].id;

  const aliasSkin = aliasCandidateList.length > 1 ? findSkinTypeByAlias(normalized) : "";
  if (aliasSkin) {
    const sameSkinBoards = boards.filter((board) => resolveBoardSkinType(board) === aliasSkin);
    if (sameSkinBoards.length === 1) return sameSkinBoards[0].id;
  }

  return rawBoardId;
}

function syncBoardDisplay(boardId) {
  const canonicalBoardId = resolveCanonicalBoardId(boardId || activeBoardId || "");
  const board = boards.find((item) => item.id === canonicalBoardId) || null;
  activeBoardId = board?.id || canonicalBoardId || "";

  if (boardSelect) {
    boardSelect.value = activeBoardId;
  }

  if (boardCurrentValueEl) {
    boardCurrentValueEl.textContent = board ? (board.title || board.name || board.id) : (activeBoardId || "-");
  }

  return board;
}

function getSelectedBoard() {
  const boardId = activeBoardId || boardSelect.value;
  return boards.find((board) => board.id === boardId) || null;
}

async function getSelectedSkin() {
  const selectedBoard = getSelectedBoard();
  if (selectedBoard) return getSkin(selectedBoard);

  const fallbackSkinType = findSkinTypeByAlias(preselectBoardId);
  return getSkin(fallbackSkinType);
}

function applyProfileWriteLabels(isProfileSkin) {
  const thumbLabelEl = thumbSectionEl?.querySelector(".write-label");
  const thumbUrlLabelEl = thumbUrlFieldsEl?.querySelector("label");
  const titleLabelEl = titleFieldsEl?.querySelector(".write-label");
  const contentLabelEl = contentFieldsEl?.querySelector(".write-label");

  if (thumbLabelEl) thumbLabelEl.textContent = isProfileSkin ? "대표이미지(썸네일)" : "대표이미지";
  if (thumbUrlLabelEl) thumbUrlLabelEl.textContent = isProfileSkin ? "썸네일 이미지 URL" : "이미지 URL";
  if (titleLabelEl) titleLabelEl.textContent = isProfileSkin ? "캐릭터 이름" : "제목";
  if (contentLabelEl) contentLabelEl.textContent = isProfileSkin ? "캐릭터 한마디" : "본문";
  if (titleInput) titleInput.placeholder = isProfileSkin ? "캐릭터 이름" : "제목";
}

function getSkinPostFields(skin) {
  return Array.isArray(skin?.postFields) ? skin.postFields.filter((field) => field?.key) : [];
}

function getNestedValue(source = {}, key = "") {
  return String(key || "")
    .split(".")
    .filter(Boolean)
    .reduce((value, part) => (value && typeof value === "object" ? value[part] : undefined), source);
}

function setNestedValue(target, key = "", value = "") {
  const parts = String(key || "").split(".").filter(Boolean);
  if (!parts.length) return target;
  let cursor = target;
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== "object") cursor[part] = {};
    cursor = cursor[part];
  });
  cursor[parts[parts.length - 1]] = value;
  return target;
}

function mergePlainObjects(target = {}, source = {}) {
  Object.entries(source || {}).forEach(([key, value]) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      target[key] = mergePlainObjects(target[key] && typeof target[key] === "object" ? target[key] : {}, value);
    } else {
      target[key] = value;
    }
  });
  return target;
}

function renderSkinPostFields(skin, post = editingPost) {
  const fields = getSkinPostFields(skin);
  if (!skinFieldsContainerEl) return;
  if (!fields.length) {
    skinFieldsContainerEl.innerHTML = "";
    return;
  }

  const skinData = getPostSkinData(post || {});
  if (skinFieldsTitleEl) skinFieldsTitleEl.textContent = `${skin.type} 정보`;

  const fieldHtml = fields.map((field) => {
    const key = String(field.key || "");
    const id = `skinField_${key.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
    const value = String(getNestedValue(skinData, key) ?? field.defaultValue ?? "");
    const label = escapeHtml(field.label || key);
    const placeholder = escapeHtml(field.placeholder || "");
    const visibleWhen = field.visibleWhen && typeof field.visibleWhen === "object" ? field.visibleWhen : null;
    const visibleAttrs = visibleWhen
      ? ` data-visible-when-key="${escapeHtml(visibleWhen.key)}" data-visible-when-value="${escapeHtml(visibleWhen.value)}"`
      : "";
    const commonAttrs = `id="${id}" data-skin-field="${escapeHtml(key)}" placeholder="${placeholder}"${visibleAttrs}`;
    const wrapperAttrs = visibleWhen
      ? ` data-skin-field-wrap="${escapeHtml(key)}" data-visible-when-key="${escapeHtml(visibleWhen.key)}" data-visible-when-value="${escapeHtml(visibleWhen.value)}"`
      : ` data-skin-field-wrap="${escapeHtml(key)}"`;

    if (field.type === "select") {
      const options = Array.isArray(field.options) ? field.options : [];
      const selectedValue = value || String(field.defaultValue || "");
      const optionsHtml = options.map((option) => {
        const optionValue = typeof option === "object" ? option.value : option;
        const optionLabel = typeof option === "object" ? option.label : option;
        const selected = String(optionValue) === selectedValue ? " selected" : "";
        return `<option value="${escapeHtml(optionValue)}"${selected}>${escapeHtml(optionLabel)}</option>`;
      }).join("");
      return `
        <div class="field-group write-skin-field"${wrapperAttrs}>
          <label class="muted small" for="${id}">${label}</label>
          <select ${commonAttrs}>${optionsHtml}</select>
        </div>
      `;
    }

    if (field.type === "textarea") {
      const rows = Number.isFinite(Number(field.rows)) ? Number(field.rows) : 4;
      const htmlToggleKey = String(field.htmlToggleKey || "");
      const htmlToggleId = htmlToggleKey ? `skinField_${htmlToggleKey.replace(/[^a-zA-Z0-9_-]/g, "_")}` : "";
      const htmlToggleValue = htmlToggleKey ? getNestedValue(skinData, htmlToggleKey) : false;
      const htmlToggleHtml = htmlToggleKey ? `
        <label class="write-check write-skin-html-toggle">
          <input id="${htmlToggleId}" type="checkbox" data-skin-field="${escapeHtml(htmlToggleKey)}" ${htmlToggleValue === true || htmlToggleValue === "true" ? "checked" : ""}>
          <span>HTML 허용</span>
        </label>
      ` : "";
      return `
        <div class="field-group write-skin-field write-skin-field-textarea"${wrapperAttrs}>
          <div class="write-skin-field-head">
            <label class="muted small" for="${id}">${label}</label>
            ${htmlToggleHtml}
          </div>
          <textarea ${commonAttrs} class="textarea write-profile-textarea" rows="${rows}">${escapeHtml(value)}</textarea>
        </div>
      `;
    }

    if (field.type === "image") {
      return `
        <div class="field-group write-skin-field write-skin-image-field"${wrapperAttrs}>
          <label class="muted small" for="${id}">${label}</label>
          <input ${commonAttrs} type="url" value="${escapeHtml(value)}">
          <div class="formRow write-file-row mt-sm">
            <button type="button" class="btn" data-skin-file-select="${escapeHtml(key)}">파일 선택</button>
            <button type="button" class="btn" data-skin-file-clear="${escapeHtml(key)}">선택 삭제</button>
          </div>
          <input type="file" accept="image/*" class="hidden" data-skin-file-input="${escapeHtml(key)}">
          <div class="previewGrid mt-sm" data-skin-file-preview="${escapeHtml(key)}"></div>
        </div>
      `;
    }

    return `
      <div class="field-group write-skin-field"${wrapperAttrs}>
        <label class="muted small" for="${id}">${label}</label>
        <input ${commonAttrs} type="${escapeHtml(field.type || "text")}" value="${escapeHtml(value)}">
      </div>
    `;
  }).join("");

  skinFieldsContainerEl.innerHTML = `<div class="write-skin-fields">${fieldHtml}</div>`;
  bindSkinFieldVisibility();
  bindSkinImageFieldActions(skin);
}

function getSkinFieldInput(key = "") {
  const safeKey = cssEscape(String(key || ""));
  return skinFieldsContainerEl?.querySelector(`[data-skin-field="${safeKey}"]`) || null;
}

function getSkinImagePreviewEl(key = "") {
  const safeKey = cssEscape(String(key || ""));
  return skinFieldsContainerEl?.querySelector(`[data-skin-file-preview="${safeKey}"]`) || null;
}

function revokeSkinImagePreview(key = "") {
  const existingUrl = stagedSkinImagePreviewUrls.get(key);
  revokeObjectUrl(existingUrl);
  stagedSkinImagePreviewUrls.delete(key);
}

function renderSkinImagePreview(key = "", attachment = null) {
  const previewEl = getSkinImagePreviewEl(key);
  if (!previewEl) return;

  const input = getSkinFieldInput(key);
  const url = attachment?.url || input?.value || "";
  if (!url) {
    previewEl.innerHTML = "";
    return;
  }

  const name = attachment?.name || "profile-image";
  previewEl.innerHTML = `
    <div class="previewItem">
      <img src="${escapeHtml(url)}" alt="profile image preview" class="previewImage">
      <div class="muted small previewName" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
    </div>
  `;
}

function clearSkinImageSelection(key = "", clearValue = false) {
  revokeSkinImagePreview(key);
  stagedSkinImageFiles.delete(key);
  const input = getSkinFieldInput(key);
  const fileInput = skinFieldsContainerEl?.querySelector(`[data-skin-file-input="${cssEscape(key)}"]`);
  if (clearValue && input) input.value = "";
  if (fileInput) fileInput.value = "";
  renderSkinImagePreview(key);
}

function setSkinImageFileSelection(key = "", file) {
  ensureImageFile(file, "프로필 이미지");
  revokeSkinImagePreview(key);
  stagedSkinImageFiles.set(key, file);
  const previewUrl = URL.createObjectURL(file);
  stagedSkinImagePreviewUrls.set(key, previewUrl);
  renderSkinImagePreview(key, createLocalAttachment(file, previewUrl));
  showUploadMsg("프로필 이미지를 선택했습니다. 저장 시 Storage에 업로드됩니다.");
}

function bindSkinImageFieldActions(skin) {
  const imageFields = getSkinPostFields(skin).filter((field) => field.type === "image");
  if (!skinFieldsContainerEl || !imageFields.length) return;

  imageFields.forEach((field) => {
    const key = String(field.key || "");
    renderSkinImagePreview(key);

    const selectBtn = skinFieldsContainerEl.querySelector(`[data-skin-file-select="${cssEscape(key)}"]`);
    const clearBtn = skinFieldsContainerEl.querySelector(`[data-skin-file-clear="${cssEscape(key)}"]`);
    const fileInput = skinFieldsContainerEl.querySelector(`[data-skin-file-input="${cssEscape(key)}"]`);
    const urlInput = getSkinFieldInput(key);

    selectBtn?.addEventListener("click", () => fileInput?.click());
    clearBtn?.addEventListener("click", () => {
      clearSkinImageSelection(key, true);
      showUploadMsg("프로필 이미지 선택을 해제했습니다.");
    });
    fileInput?.addEventListener("change", (event) => {
      try {
        const file = event.target.files?.[0];
        if (!file) return;
        setSkinImageFileSelection(key, file);
      } catch (error) {
        clearSkinImageSelection(key);
        showUploadMsg(error.message || "프로필 이미지 파일 선택 실패", true);
      }
    });
    urlInput?.addEventListener("input", () => {
      if (stagedSkinImageFiles.has(key)) clearSkinImageSelection(key);
      renderSkinImagePreview(key);
    });
  });
}

function bindSkinFieldVisibility() {
  if (!skinFieldsContainerEl) return;
  const updateVisibility = () => {
    const inputs = Array.from(skinFieldsContainerEl.querySelectorAll("[data-skin-field]"));
    const values = new Map(inputs.map((input) => [input.dataset.skinField, input.value]));
    skinFieldsContainerEl.querySelectorAll("[data-skin-field-wrap][data-visible-when-key]").forEach((wrap) => {
      const key = wrap.dataset.visibleWhenKey || "";
      const value = wrap.dataset.visibleWhenValue || "";
      wrap.classList.toggle("hidden", String(values.get(key) || "") !== value);
    });
  };
  skinFieldsContainerEl.querySelectorAll("[data-skin-field]").forEach((input) => {
    input.addEventListener("input", updateVisibility);
    input.addEventListener("change", updateVisibility);
  });
  updateVisibility();
}

function readSkinPostFields(skin) {
  const result = {};
  const inputs = Array.from(skinFieldsContainerEl?.querySelectorAll("[data-skin-field]") || []);
  getSkinPostFields(skin).forEach((field) => {
    const key = String(field.key || "");
    const input = inputs.find((item) => item.dataset.skinField === key);
    setNestedValue(result, key, input?.type === "checkbox" ? Boolean(input.checked) : String(input?.value || "").trim());
    const htmlToggleKey = String(field.htmlToggleKey || "");
    if (htmlToggleKey) {
      const toggle = inputs.find((item) => item.dataset.skinField === htmlToggleKey);
      setNestedValue(result, htmlToggleKey, Boolean(toggle?.checked));
    }
  });
  return result;
}

async function setSkinFields() {
  const skin = await getSelectedSkin();
  const writeCaps = skin.capabilities.write;
  const isProfileSkin = skin.type === "PROFILE";
  const isPageSkin = skin.type === "PAGE";
  const hideThumbnailFields = skin.type === "BOARD";
  const hideGalleryTextFields = !!writeCaps.supportsGalleryFields;
  const hideContentFields = writeCaps.supportsContent === false;
  const hasSkinPostFields = getSkinPostFields(skin).length > 0;

  if (writeCaps.disabled) {
    if (saveBtn) saveBtn.disabled = true;
    showMsg(`${skin.type}는 관리자 > 게시판 관리에서 내용을 수정하세요.`, true);
  } else if (saveBtn) {
    saveBtn.disabled = false;
  }

  if (thumbSectionEl) thumbSectionEl.classList.toggle("hidden", hideThumbnailFields || isPageSkin);
  if (profileOnlyFieldsEl) profileOnlyFieldsEl.classList.toggle("hidden", !hasSkinPostFields);
  document.getElementById("logOnlyFields").classList.toggle("hidden", !writeCaps.supportsLogFields);
  document.getElementById("galleryOnlyFields").classList.toggle("hidden", !writeCaps.supportsGalleryFields);
  if (titleFieldsEl) titleFieldsEl.classList.toggle("hidden", !writeCaps.supportsTitle || hideGalleryTextFields || isPageSkin);
  if (contentFieldsEl) contentFieldsEl.classList.toggle("hidden", hideGalleryTextFields || hideContentFields);
  if (visibilityFieldsEl) visibilityFieldsEl.classList.toggle("hidden", isPageSkin);
  if (extraFieldsEl) extraFieldsEl.classList.toggle("hidden", isPageSkin);
  // 추가 이미지 정렬: 인라인 갤러리를 쓰는 스킨(BOARD 등)만 노출, 프로필·페이지는 숨김
  if (extraImageAlignFieldEl) extraImageAlignFieldEl.classList.toggle("hidden", isPageSkin || isProfileSkin);
  if (tagFieldsEl) tagFieldsEl.classList.toggle("hidden", isPageSkin);
  profileSkinFieldsHelpEl?.classList.toggle("hidden", !isProfileSkin);
  if (logNumberInput) {
    logNumberInput.readOnly = !!writeCaps.autoLogNumber;
  }

  applyProfileWriteLabels(isProfileSkin);
  renderSkinPostFields(skin, editingPost);
  contentInput.placeholder = writeCaps.contentPlaceholder || (isProfileSkin ? "캐릭터 한마디" : "본문");
  if (!writeCaps.supportsTitle) {
    titleInput.value = "";
  }
  if (hideThumbnailFields || isPageSkin) {
    clearSelectedThumb();
    uploadedThumbnail = null;
    imageUrlInput.value = "";
  }
  if (isPageSkin) {
    uploadedExtraAttachments = [];
    extraItems = [];
    stagedExtraAttachments = [];
    if (tagsInput) tagsInput.value = "";
    if (visibilityInput) visibilityInput.value = "public";
    renderExtraItems();
    clearPendingExtraPreview();
  }
  updateSecretPasswordVisibility();
}

function syncLogTitleFromNumber(value = "") {
  if (!titleInput) return;
  titleInput.value = String(value || "").trim();
}

function updateSecretPasswordVisibility() {
  if (!secretPwWrap) return;
  const canShow = visibilityInput?.value === "secret";
  secretPwWrap.classList.toggle("hidden", !canShow);
  if (!canShow) {
    if (secretPwInput && !secretPwInput.matches(":focus")) {
      secretPwInput.value = "";
    }
  }
}

async function refreshLogNumberPreview() {
  const selected = getSelectedBoard();
  const skin = await getSelectedSkin();
  if (!logNumberInput) return;
  if (!skin.capabilities.write.autoLogNumber) {
    logNumberInput.value = "";
    return;
  }
  if (editPostId && logNumberInput.value.trim()) return;

  try {
    const nextLogNo = await resolveNextLogNumber(selected);
    logNumberInput.value = String(nextLogNo);
    syncLogTitleFromNumber(nextLogNo);
  } catch (error) {
    console.warn("Failed to preview next log number:", error);
    logNumberInput.value = "";
    syncLogTitleFromNumber("");
  }
}

function getThumbMode() {
  if (thumbModeVideoRadio?.checked) return "video";
  if (thumbModeFileRadio?.checked) return "file";
  return "url";
}

function getExtraMode() {
  if (extraModeVideoRadio?.checked) return "video";
  if (extraModeFileRadio?.checked) return "file";
  return "url";
}

function revokeObjectUrl(url) {
  if (typeof url === "string" && url.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}

function clearThumbPreviewBlob() {
  revokeObjectUrl(thumbPreviewBlobUrl);
  thumbPreviewBlobUrl = "";
}

function fileLooksLikeImage(file) {
  if (!file) return false;
  if (String(file.type || "").startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|svg|ico)$/i.test(file.name || "");
}

function ensureImageFile(file, label = "이미지") {
  if (!file || !file.name) throw new Error(`${label} 파일을 선택하세요.`);
  if (!fileLooksLikeImage(file)) throw new Error(`${label}는 이미지 파일만 업로드할 수 있습니다.`);
  if (Number(file.size || 0) > MAX_IMAGE_BYTES) {
    throw new Error(`${label}는 20MB 이하만 업로드할 수 있습니다.`);
  }
}

function escapeStorageName(name = "file") {
  const trimmed = String(name || "file").trim();
  const normalized = trimmed
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "file";
}

function storageDirectoryFromPath(path = "") {
  const normalized = String(path || "").replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  segments.pop();
  return segments.join("/");
}

function randomId(length = 8) {
  return Math.random().toString(36).slice(2, 2 + length);
}

function parseLogNumber(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  return null;
}

function getContentHtmlFromInput(contentRaw) {
  const raw = String(contentRaw || "").replace(/\r\n/g, "\n");
  const htmlMode = !!htmlModeInput?.checked;
  if (htmlMode) {
    return sanitizeHTML(preserveLineBreaks(raw), { allowIframes: true });
  }
  return preserveLineBreaks(escapeHtml(raw));
}

function htmlToPlainTextValue(html) {
  const temp = document.createElement("div");
  temp.innerHTML = String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n");
  return temp.textContent?.replace(/\u00a0/g, " ").replace(/\r\n/g, "\n").trimEnd() || "";
}

function detectSavedHtmlMode(post = {}) {
  if (post?.contentIsHtml === true || post?.commentIsHtml === true) return true;
  if (post?.contentIsHtml === false || post?.commentIsHtml === false) return false;
  const html = String(post?.contentHtml || post?.commentHtml || "");
  const stripped = html
    .replace(/<br\s*\/?>/gi, "")
    .replace(/&nbsp;/gi, "")
    .trim();
  return /<(p|div|span|a|img|iframe|strong|em|u|b|i|ul|ol|li|blockquote|code|pre|figure|table|thead|tbody|tr|td|th|h[1-6])\b/i.test(stripped);
}

async function resolveNextLogNumber(board) {
  const boardKey = String(board?.id || "").trim();
  if (!boardKey) return 1;
  if (nextLogNumberCache.has(boardKey)) return nextLogNumberCache.get(boardKey);

  const boardCandidates = getBoardAliasCandidates(boardKey);
  const authState = await getAuthSnapshot();
  const visibilityConstraints = authState.isAdmin ? [] : [where("isPublic", "==", true)];
  let posts = [];

  try {
    if (boardCandidates.length > 1) {
      const snapshot = await getDocs(query(
        collection(db, "posts"),
        where("boardId", "in", boardCandidates),
        ...visibilityConstraints
      ));
      posts = snapshot.docs.map((item) => item.data());
    } else {
      const snapshot = await getDocs(query(
        collection(db, "posts"),
        where("boardId", "==", boardKey),
        ...visibilityConstraints
      ));
      posts = snapshot.docs.map((item) => item.data());
    }
  } catch (error) {
    console.warn("Failed to query log numbers directly. Falling back to client filter.", error);
    const snapshot = await getDocs(query(collection(db, "posts"), ...visibilityConstraints));
    const allowedBoardIds = new Set(boardCandidates);
    posts = snapshot.docs
      .map((item) => item.data())
      .filter((post) => allowedBoardIds.has(String(post.boardId || "").trim().toLowerCase()));
  }

  const maxLogNo = posts.reduce((maxValue, post) => {
    const skinData = getPostSkinData(post);
    const parsed = parseLogNumber(skinData.logNo ?? post.logNo ?? post.logNumber);
    return parsed && parsed > maxValue ? parsed : maxValue;
  }, 0);

  const nextValue = maxLogNo + 1;
  nextLogNumberCache.set(boardKey, nextValue);
  return nextValue;
}

function createLocalAttachment(file, previewUrl) {
  return {
    file,
    name: file.name,
    url: previewUrl,
    path: file.name,
    mimeType: file.type || "image/*",
    source: "local-file"
  };
}

function renderThumbPreview(thumbnail = null) {
  if (!thumbPreviewEl) return;
  if (!thumbnail) {
    thumbPreviewEl.innerHTML = "";
    if (thumbFilePathInput) thumbFilePathInput.value = "";
    return;
  }

  const mode = String(thumbnail.mode || "").toLowerCase();
  if (mode === "video") {
    const embedHtml = thumbnail.embedHtml || "";
    const sourceLabel = thumbnail.embedSrc || "VIDEO";
    if (thumbFilePathInput) thumbFilePathInput.value = "";
    if (thumbVideoInput && thumbnail.rawInput != null) thumbVideoInput.value = thumbnail.rawInput;
    thumbPreviewEl.innerHTML = `
      <div class="previewItem previewItemVideo">
        ${renderPostVideoFrame(embedHtml, "previewVideoFrame")}
        <div class="muted small previewName" title="${escapeHtml(sourceLabel)}">${escapeHtml(sourceLabel)}</div>
      </div>
    `;
    return;
  }

  const previewUrl = thumbnail.url || "";
  const fileName = thumbnail.name || "selected-thumb";
  const pathLabel = thumbnail.path || thumbnail.storagePath || "";
  if (thumbFilePathInput) thumbFilePathInput.value = pathLabel || fileName;

  thumbPreviewEl.innerHTML = `
    <div class="previewItem">
      ${previewUrl ? `<img src="${escapeHtml(previewUrl)}" alt="thumb preview" class="previewImage">` : ""}
      <div class="muted small previewName" title="${escapeHtml(fileName)}">${escapeHtml(fileName)}</div>
    </div>
  `;
}

function clearSelectedThumb() {
  clearThumbPreviewBlob();
  stagedThumbFile = null;
  uploadedThumbnail = null;
  if (thumbFileInput) thumbFileInput.value = "";
  renderThumbPreview(null);
}

function applyThumbModeUI() {
  const mode = getThumbMode();
  if (thumbUrlFieldsEl) thumbUrlFieldsEl.classList.toggle("hidden", mode !== "url");
  if (thumbFileFieldsEl) thumbFileFieldsEl.classList.toggle("hidden", mode !== "file");
  if (thumbVideoFieldsEl) thumbVideoFieldsEl.classList.toggle("hidden", mode !== "video");
  if (mode === "url") {
    clearSelectedThumb();
  } else if (mode === "video") {
    clearSelectedThumb();
    imageUrlInput.value = "";
    const existingVideoHtml = thumbVideoInput?.value || "";
    if (existingVideoHtml) {
      try {
        const normalized = normalizeThumbVideoHtml(existingVideoHtml);
        renderThumbPreview({
          mode: "video",
          rawInput: existingVideoHtml,
          embedHtml: normalized.embedHtml,
          embedSrc: normalized.embedSrc
        });
      } catch (_error) {
        renderThumbPreview({
          mode: "video",
          rawInput: existingVideoHtml,
          embedHtml: "",
          embedSrc: ""
        });
      }
    }
  } else {
    imageUrlInput.value = "";
  }
}

function extractIframeSrcFromHtml(html) {
  const temp = document.createElement("div");
  temp.innerHTML = String(html || "").trim();
  const iframe = temp.querySelector("iframe");
  return iframe?.getAttribute("src") || "";
}

function normalizeThumbVideoHtml(rawHtml) {
  const trimmed = String(rawHtml || "").trim();
  if (!trimmed) return { embedHtml: "", embedSrc: "" };
  const normalized = normalizeVideoEmbedInput(trimmed);
  if (!normalized.html || !normalized.src) throw new Error("VIDEO iframe 또는 YouTube 링크를 넣어주세요.");
  return { embedHtml: normalized.html, embedSrc: normalized.src };
}

function renderPendingExtraPreview(attachments = []) {
  if (!extraPendingPreviewEl) return;
  const items = Array.isArray(attachments) ? attachments.filter((item) => item?.url || item?.embedHtml) : [];
  if (!items.length) {
    extraPendingPreviewEl.innerHTML = "";
    if (extraFilePathInput) extraFilePathInput.value = "";
    return;
  }

  if (extraFilePathInput) {
    extraFilePathInput.value = items.length === 1
      ? (items[0]?.name || items[0]?.path || "")
      : `${items.length}개 파일 선택됨`;
  }

  extraPendingPreviewEl.innerHTML = items.map((attachment, index) => {
    const fileName = attachment.name || `selected-extra-${index + 1}`;
    const pathLabel = attachment.path || attachment.url || "";
    const isVideo = String(attachment.mode || "").toLowerCase() === "video" || Boolean(attachment.embedHtml);
    return `
      <div class="previewItem${isVideo ? " previewItemVideo" : ""}">
        ${isVideo
          ? `${renderPostVideoFrame(attachment.embedHtml || "", "previewVideoFrame")}`
          : `<img src="${escapeHtml(attachment.url)}" alt="extra preview" class="previewImage">`}
        <div class="muted small previewName" title="${escapeHtml(fileName)}">${escapeHtml(fileName)}</div>
      </div>
    `;
  }).join("");
}

function revokePendingExtraPreviews() {
  stagedExtraAttachments.forEach((attachment) => revokeObjectUrl(attachment?.url));
}

function clearPendingExtraSelection() {
  revokePendingExtraPreviews();
  stagedExtraAttachments = [];
  if (extraFileInput) extraFileInput.value = "";
  renderPendingExtraPreview([]);
}

function applyExtraModeUI() {
  const mode = getExtraMode();
  if (extraUrlFieldsEl) extraUrlFieldsEl.classList.toggle("hidden", mode !== "url");
  if (extraVideoFieldsEl) extraVideoFieldsEl.classList.toggle("hidden", mode !== "video");
  if (extraFileFieldsEl) extraFileFieldsEl.classList.toggle("hidden", mode !== "file");

  if (mode === "url") {
    clearPendingExtraSelection();
  } else if (mode === "video") {
    clearPendingExtraSelection();
    try {
      renderPendingExtraPreview(extraVideoInput?.value ? [buildExternalVideoAttachment(extraVideoInput.value)] : []);
    } catch (_error) {
      renderPendingExtraPreview([]);
    }
  } else if (extraImageUrlInput) {
    extraImageUrlInput.value = "";
    renderPendingExtraPreview([]);
  }
}

function buildExternalAttachment(rawUrl) {
  const trimmedUrl = String(rawUrl || "").trim();
  if (!trimmedUrl) throw new Error("추가 이미지 URL을 입력하세요.");

  let parsedUrl;
  try {
    parsedUrl = new URL(trimmedUrl, window.location.origin);
  } catch (_error) {
    throw new Error("유효한 추가 이미지 URL을 입력하세요.");
  }

  const fileName = decodeURIComponent(parsedUrl.pathname.split("/").filter(Boolean).pop() || parsedUrl.hostname || "image");
  return {
    name: fileName,
    url: parsedUrl.toString(),
    path: parsedUrl.toString(),
    relativePath: parsedUrl.toString(),
    directory: parsedUrl.pathname ? parsedUrl.pathname.split("/").slice(0, -1).join("/") || "/" : "/",
    source: "external-url"
  };
}

function buildExternalVideoAttachment(rawHtml) {
  const { embedHtml, embedSrc } = normalizeThumbVideoHtml(rawHtml);
  const previewUrl = getYoutubeThumbnailUrl(embedSrc) || embedSrc;
  return {
    mode: "video",
    name: "VIDEO",
    url: previewUrl,
    path: embedSrc,
    embedHtml,
    embedSrc,
    previewUrl,
    source: "embedded-video"
  };
}

function createExtraItem({ file = null, existing = null, previewUrl = "" } = {}) {
  const id = `extra_${Date.now()}_${randomId(8)}`;
  const resolvedPreviewUrl = previewUrl || (file ? URL.createObjectURL(file) : "");
  extraItems.push({ id, file, existing, previewUrl: resolvedPreviewUrl });
  renderExtraItems();
}

function removeExtraItem(id) {
  const target = extraItems.find((item) => item.id === id);
  revokeObjectUrl(target?.previewUrl);
  extraItems = extraItems.filter((item) => item.id !== id);
  renderExtraItems();
}

function renderExtraItems() {
  if (!extraItemsEl) return;
  if (!extraItems.length) {
    extraItemsEl.innerHTML = '<div class="muted small" style="grid-column: 1 / -1;">등록된 추가 이미지가 없습니다.</div>';
    return;
  }

  extraItemsEl.innerHTML = extraItems.map((item, index) => {
    const previewUrl = item.previewUrl || item.existing?.url || "";
    const fileName = item.file?.name || item.existing?.name || `image-${index + 1}`;
    const pathLabel = item.existing?.path || "";
    const isVideo = String(item.existing?.mode || "").toLowerCase() === "video" || Boolean(item.existing?.embedHtml);
    return `
      <div class="previewItem" data-extra-id="${item.id}">
        <div class="muted small">추가 이미지 ${index + 1}</div>
        <div class="mt-sm">
          ${previewUrl
            ? (isVideo
              ? `<div class="previewGrid previewItemVideo">${renderPostVideoFrame(item.existing?.embedHtml || "", "previewVideoFrame")}</div>`
              : `<div class="previewGrid"><img src="${escapeHtml(previewUrl)}" alt="preview" class="previewImage"></div>`)
            : ""}
          ${isVideo ? "" : `<div class="muted small previewName" title="${escapeHtml(fileName)}">${escapeHtml(fileName)}</div>`}
        </div>
        <div class="formRow mt-sm">
          <button type="button" class="btn small" data-remove-extra="${item.id}">삭제</button>
        </div>
      </div>
    `;
  }).join("");

  extraItemsEl.querySelectorAll("[data-remove-extra]").forEach((button) => {
    button.addEventListener("click", () => removeExtraItem(button.dataset.removeExtra));
  });
}

function hasExistingExtraFile(file) {
  return extraItems.some((item) => item.file
    && item.file.name === file.name
    && item.file.size === file.size
    && item.file.lastModified === file.lastModified);
}

function handleThumbFileChange(event) {
  try {
    const file = event.target.files?.[0];
    if (!file) return;
    setThumbFileSelection(file, "썸네일 파일을 선택했습니다. 저장 시 Storage에 업로드됩니다.");
  } catch (error) {
    clearSelectedThumb();
    showUploadMsg(error.message || "썸네일 파일 선택 실패", true);
  }
}

function setThumbFileSelection(file, successMessage = "") {
  ensureImageFile(file, "썸네일");

  clearThumbPreviewBlob();
  stagedThumbFile = file;
  uploadedThumbnail = null;
  thumbPreviewBlobUrl = URL.createObjectURL(file);
  if (thumbModeFileRadio) thumbModeFileRadio.checked = true;
  applyThumbModeUI();
  renderThumbPreview(createLocalAttachment(file, thumbPreviewBlobUrl));
  if (successMessage) showUploadMsg(successMessage);
}

function fileFromClipboardItem(item) {
  if (!item) return null;
  if (item.kind === "file") {
    const file = item.getAsFile();
    return file || null;
  }
  return null;
}

async function handleClipboardPaste(event) {
  const activeTag = document.activeElement?.tagName?.toLowerCase() || "";
  const activeId = document.activeElement?.id || "";
  const isTypingField = ["input", "textarea"].includes(activeTag);
  const isThumbField = activeId === "imageUrlInput" || activeId === "thumbFilePathInput";
  const shouldCapture = !isTypingField || isThumbField || activeId === "thumbFileInput";
  if (!shouldCapture) return;

  const files = [...(event.clipboardData?.files || [])].filter((file) => fileLooksLikeImage(file));
  const items = [...(event.clipboardData?.items || [])];
  const fileItem = items.find((item) => item.kind === "file" && String(item.type || "").startsWith("image/"));
  const file = files[0] || fileFromClipboardItem(fileItem);
  if (!file) return;

  try {
    event.preventDefault();
    setThumbFileSelection(file, "클립보드 이미지를 대표 이미지로 등록했습니다.");
  } catch (error) {
    showUploadMsg(error.message || "클립보드 이미지 등록 실패", true);
  }
}

function handleExtraFileChange(event) {
  try {
    const files = [...(event.target.files || [])];
    if (!files.length) return;
    files.forEach((file) => ensureImageFile(file, "추가 이미지"));

    clearPendingExtraSelection();
    stagedExtraAttachments = files.map((file) => createLocalAttachment(file, URL.createObjectURL(file)));
    renderPendingExtraPreview(stagedExtraAttachments);
    showUploadMsg(`추가 이미지 ${stagedExtraAttachments.length}개를 선택했습니다. 등록을 눌러 목록에 추가하세요.`);
  } catch (error) {
    clearPendingExtraSelection();
    showUploadMsg(error.message || "추가 이미지 파일 선택 실패", true);
  }
}

function addSelectedExtraFiles() {
  if (!stagedExtraAttachments.length) {
    throw new Error("등록할 추가 이미지 파일을 선택하세요.");
  }

  let added = 0;
  stagedExtraAttachments.forEach((attachment) => {
    if (!attachment?.file || hasExistingExtraFile(attachment.file)) return;
    createExtraItem({ file: attachment.file, previewUrl: attachment.url });
    added += 1;
  });

  if (!added) {
    throw new Error("이미 등록된 파일입니다.");
  }

  clearPendingExtraSelection();
  showUploadMsg(`추가 이미지 ${added}개를 등록 목록에 추가했습니다.`);
}

async function uploadImageFile(file, bucketFolder, boardId) {
  ensureImageFile(file, "이미지");

  const extensionSafeName = escapeStorageName(file.name);
  const uniqueName = `${Date.now()}_${randomId(10)}_${extensionSafeName}`;
  const storagePath = `${bucketFolder}/${boardId}/${uniqueName}`;
  const storageRef = ref(storage, storagePath);
  const authState = await getAuthSnapshot();
  const uploadTokenId = authState.isAdmin ? "" : await createGuestUploadToken(boardId);

  let snapshot;
  try {
    snapshot = await uploadBytes(storageRef, file, {
      contentType: file.type || "image/jpeg",
      cacheControl: "public,max-age=3600",
      customMetadata: {
        boardId,
        authorType: authState.isAdmin ? "ADMIN" : "GUEST",
        ...(uploadTokenId ? { uploadToken: uploadTokenId } : {})
      }
    });
  } finally {
    if (uploadTokenId) {
      deleteDoc(doc(db, "guest_upload_tokens", uploadTokenId)).catch(() => {});
    }
  }

  const downloadUrl = await getDownloadURL(snapshot.ref);
  return {
    name: file.name,
    url: downloadUrl,
    path: snapshot.ref.fullPath,
    storagePath: snapshot.ref.fullPath,
    relativePath: snapshot.ref.fullPath,
    directory: storageDirectoryFromPath(snapshot.ref.fullPath),
    mimeType: file.type || "image/*",
    sizeBytes: Number(file.size || 0),
    source: "firebase-storage"
  };
}

async function createGuestUploadToken(boardId) {
  const proofHash = getGuestProofHash();
  if (!proofHash) throw new Error("게스트 코드를 먼저 입력하세요.");

  const tokenRef = doc(collection(db, "guest_upload_tokens"));
  await setDoc(tokenRef, {
    boardId,
    proofHash,
    createdAt: serverTimestamp()
  });
  return tokenRef.id;
}

async function resolveThumbnailAttachment(boardId) {
  if (!stagedThumbFile) return uploadedThumbnail;

  uploadedThumbnail = await uploadImageFile(stagedThumbFile, "gallery_thumbs", boardId);
  clearThumbPreviewBlob();
  stagedThumbFile = null;
  if (thumbFileInput) thumbFileInput.value = "";
  renderThumbPreview(uploadedThumbnail);
  return uploadedThumbnail;
}

async function resolveExtraAttachments(boardId) {
  const pendingUploads = extraItems.map(async (item) => {
    if (item.file) {
      const uploaded = await uploadImageFile(item.file, "gallery_extra", boardId);
      revokeObjectUrl(item.previewUrl);
      return uploaded;
    }
    return item.existing || null;
  });

  return (await Promise.all(pendingUploads)).filter((item) => item?.url);
}

async function resolveSkinFieldImageUploads(boardId) {
  if (!stagedSkinImageFiles.size) return;

  const entries = Array.from(stagedSkinImageFiles.entries());
  await Promise.all(entries.map(async ([key, file]) => {
    const uploaded = await uploadImageFile(file, "profile_images", boardId);
    const input = getSkinFieldInput(key);
    if (input) input.value = uploaded.url;
    revokeSkinImagePreview(key);
    stagedSkinImageFiles.delete(key);
    renderSkinImagePreview(key, uploaded);
  }));
}

async function uploadSelectedImages(boardId) {
  const thumbTask = stagedThumbFile ? 1 : 0;
  const extraTask = extraItems.filter((item) => item.file).length;
  const skinImageTask = stagedSkinImageFiles.size;

  if (thumbTask || extraTask || skinImageTask) {
    const labels = [];
    if (thumbTask) labels.push("썸네일 1개");
    if (extraTask) labels.push(`추가 이미지 ${extraTask}개`);
    if (skinImageTask) labels.push(`프로필 이미지 ${skinImageTask}개`);
    showUploadMsg(`Storage 업로드 중 (${labels.join(", ")})...`);
  }

  uploadedThumbnail = await resolveThumbnailAttachment(boardId);
  uploadedExtraAttachments = await resolveExtraAttachments(boardId);
  await resolveSkinFieldImageUploads(boardId);

  if (thumbTask || extraTask || skinImageTask) {
    showUploadMsg(`업로드 완료 (썸네일 ${uploadedThumbnail ? "적용" : "없음"}, 추가 ${uploadedExtraAttachments.length}개, 프로필 ${skinImageTask}개)`);
  }
}

async function ensureWriteAccess() {
  const authState = await getAuthSnapshot();
  if (editPostId && !authState.isAdmin) {
    showMsg("게시물 수정은 관리자만 가능합니다.", true);
    return false;
  }

  const board = getSelectedBoard();
  if (!board) return false;

  const access = await canWriteToBoard(board);
  if (access.ok) return true;

  if (access.reason === "guest-disabled") {
    showMsg("이 게시판은 게스트 글쓰기를 허용하지 않습니다.", true);
    return false;
  }

  if (access.reason === "admin-only") {
    showMsg("이 게시판은 관리자만 글을 쓸 수 있습니다.", true);
    return false;
  }

  if (access.reason === "guest-locked" || access.reason === "guest-version-expired") {
    const code = await showInputModal({
      title: "게스트 코드 입력",
      description: "게스트 코드를 입력하면 바로 게시하고 파일도 업로드할 수 있습니다.",
      placeholder: "게스트 코드",
      inputType: "password",
      confirmText: "확인"
    });
    if (!code) return false;

    const result = await verifyGuestCode(code.trim());
    if (!result.ok) {
      showMsg(result.reason || "게스트 코드 확인 실패", true);
      return false;
    }

    showMsg("게스트 잠금 해제 완료");
    return true;
  }

  showMsg("이 게시판은 작성 권한이 없습니다.", true);
  return false;
}

async function loadBoards() {
  const q = query(collection(db, "boards"), orderBy("updatedAt", "desc"));
  const snap = await getDocs(q);
  const allBoards = snap.docs.map((item) => ({ id: item.id, ...item.data() }));
  boards = allBoards;

  if (!boards.length) {
    showMsg("boards 컬렉션이 비어 있습니다. 관리자에서 게시판을 먼저 만드세요.", true);
    if (saveBtn) saveBtn.disabled = true;
    if (boardSelect) {
      boardSelect.innerHTML = "";
      boardSelect.disabled = true;
    }
    return;
  }

  boardSelect.innerHTML = boards
    .map((board) => `<option value="${board.id}">${getBoardLabel(board)}</option>`)
    .join("");

  const canonicalPreselectBoardId = resolveCanonicalBoardId(preselectBoardId);
  const fallbackBoardId = boards[0]?.id || "";
  syncBoardDisplay(canonicalPreselectBoardId && boards.some((board) => board.id === canonicalPreselectBoardId)
    ? canonicalPreselectBoardId
    : fallbackBoardId);

  if (boardSelect) {
    boardSelect.classList.add("hidden");
    boardSelect.disabled = true;
  }

  await setSkinFields();
  await refreshLogNumberPreview();
}

function applyUploadPolicyForRole(isAdmin) {
  [thumbModeFileRadio, extraModeFileRadio, selectThumbFileBtn, selectExtraFileBtn].forEach((el) => {
    if (el) el.disabled = false;
  });
}

function applyVisibilityPolicyForRole(isAdmin) {
  if (!visibilityInput) return;
  const privateOption = visibilityInput.querySelector('option[value="private"]');
  if (privateOption) {
    privateOption.hidden = !isAdmin;
    privateOption.disabled = !isAdmin;
    privateOption.style.display = isAdmin ? "" : "none";
  }
  if (!isAdmin && visibilityInput.value === "private") {
    visibilityInput.value = "public";
  }
  updateSecretPasswordVisibility();
}

async function setupAuthorField() {
  const authState = await getAuthSnapshot();
  applyUploadPolicyForRole(authState.isAdmin);
  applyVisibilityPolicyForRole(authState.isAdmin);
  if (authState.isAdmin) {
    const adminProfile = await getDoc(doc(db, "admin_users", authState.user.uid));
    fixedAdminNickname = adminProfile.exists()
      ? (adminProfile.data().nickname || authState.user.email || "ADMIN")
      : (authState.user.email || "ADMIN");
    fixedAuthorName = fixedAdminNickname;
  } else {
    fixedAdminNickname = "";
    fixedAuthorName = "GUEST";
  }

  if (authorNameInput) {
    authorNameInput.value = fixedAuthorName;
    authorNameInput.readOnly = true;
  }
  if (authorCurrentValueEl) {
    authorCurrentValueEl.textContent = fixedAuthorName;
  }
}

async function loadEditPost() {
  if (!editPostId) return;

  const snap = await getDoc(doc(db, "posts", editPostId));
  if (!snap.exists()) {
    showMsg("수정할 게시물을 찾지 못했습니다.", true);
    return;
  }

  const post = snap.data();
  editingPost = { id: snap.id, ...post };
  document.getElementById("writeHeading").textContent = "게시물 수정";
  const skinData = getPostSkinData(post);
  const profile = skinData.profile || {};

  if (post.boardId) syncBoardDisplay(post.boardId);
  titleInput.value = post.title || profile.nameKo || "";
  imageUrlInput.value = post.imageUrl || "";
  logNumberInput.value = skinData.logNo || post.logNo || post.logNumber || "";
  syncLogTitleFromNumber(skinData.logNo || post.logNo || post.logNumber || post.title || "");
  sourceInput.value = skinData.source || "";
  if (extraImageAlignInput) {
    extraImageAlignInput.value = ["left", "center", "right"].includes(skinData.extraImageAlign)
      ? skinData.extraImageAlign
      : "left";
  }
  if (visibilityInput) {
    visibilityInput.value = post.isSecret ? "secret" : (post.isPublic === false ? "private" : "public");
  }
  fixedAuthorName = post.authorName || fixedAuthorName || (fixedAdminNickname || "GUEST");
  if (authorNameInput) authorNameInput.value = fixedAuthorName;
  if (authorCurrentValueEl) authorCurrentValueEl.textContent = fixedAuthorName;
  const savedHtmlMode = detectSavedHtmlMode(post);
  const savedContentHtml = post.commentHtml || post.contentHtml || "";
  contentInput.value = savedHtmlMode
    ? (savedContentHtml || post.contentText || "")
    : (post.contentText || htmlToPlainTextValue(savedContentHtml));
  tagsInput.value = (post.tags || []).join(", ");
  if (htmlModeInput) {
    htmlModeInput.checked = savedHtmlMode;
  }
  uploadedThumbnail = post.thumbnailAttachment || null;
  uploadedExtraAttachments = Array.isArray(post.extraAttachments) ? post.extraAttachments : [];

  const thumbMode = String(post.thumbnailMode || "").toLowerCase();
  const isVideoThumb = thumbMode === "video" || Boolean(post.thumbnailEmbedHtml);
  if (isVideoThumb && thumbModeVideoRadio) {
    thumbModeVideoRadio.checked = true;
  } else if (post.thumbnailAttachment?.url && thumbModeFileRadio) {
    thumbModeFileRadio.checked = true;
  } else if (thumbModeUrlRadio) {
    thumbModeUrlRadio.checked = true;
  }
  updateSecretPasswordVisibility();

  applyThumbModeUI();
  uploadedThumbnail = post.thumbnailAttachment || null;

  if (isVideoThumb) {
    const rawInput = post.thumbnailEmbedHtml || "";
    const normalized = rawInput ? normalizeThumbVideoHtml(rawInput) : { embedHtml: "", embedSrc: "" };
    if (thumbVideoInput) thumbVideoInput.value = rawInput;
    renderThumbPreview({
      mode: "video",
      rawInput,
      embedHtml: normalized.embedHtml,
      embedSrc: normalized.embedSrc
    });
  } else if (thumbModeFileRadio?.checked && uploadedThumbnail?.url) {
    renderThumbPreview(uploadedThumbnail);
  } else if (thumbModeUrlRadio) {
    thumbModeUrlRadio.checked = true;
  }

  extraItems = uploadedExtraAttachments.map((file) => ({
    id: `extra_existing_${randomId(8)}`,
    file: null,
    existing: file,
    previewUrl: ""
  }));
  renderExtraItems();
  await setSkinFields();
  await refreshLogNumberPreview();
}

async function buildPayload() {
  const selected = getSelectedBoard();
  if (!selected) throw new Error("게시판을 선택하세요.");

  const skin = await getSkin(selected);
  const skinType = skin.type;
  const writeCaps = skin.capabilities.write;
  if (writeCaps.disabled) {
    throw new Error(`${skin.type}는 관리자 > 게시판 관리에서 내용을 수정하세요.`);
  }
  const isPageSkin = skinType === "PAGE";
  let title = isPageSkin
    ? (selected.title || selected.name || selected.id || "PAGE")
    : (writeCaps.supportsTitle ? titleInput.value.trim() : "");
  const allowThumbnail = skinType !== "BOARD" && !isPageSkin;
  const thumbMode = allowThumbnail ? getThumbMode() : "";
  const videoThumb = thumbMode === "video" ? normalizeThumbVideoHtml(thumbVideoInput?.value || "") : null;
  const imageUrlFromInput = allowThumbnail && thumbMode === "url" ? imageUrlInput.value.trim() : "";
  const contentRaw = contentInput.value.trim();
  const tags = isPageSkin ? [] : tagsInput.value.split(",").map((value) => value.trim()).filter(Boolean);

  if (writeCaps.requiresTitle && !title) throw new Error(`${skinType}는 제목이 필요합니다.`);
  if (allowThumbnail && thumbMode === "file" && !uploadedThumbnail?.url) throw new Error("Storage에 올릴 썸네일 파일을 선택하세요.");

  const imageUrl = allowThumbnail
    ? (thumbMode === "url" ? imageUrlFromInput : (thumbMode === "file" ? (uploadedThumbnail?.url || "") : ""))
    : "";
  const hasCoverMedia = Boolean(imageUrl || videoThumb?.embedHtml);
  if (allowThumbnail && writeCaps.requiresThumbnail && !hasCoverMedia) {
    throw new Error(`${skinType}는 썸네일 이미지(URL 또는 Storage 업로드 파일)가 필요합니다.`);
  }
  const normalizedContentHtml = getContentHtmlFromInput(contentRaw);
  const contentText = contentRaw.replace(/<[^>]*>/g, " ").trim();
  const visibility = isPageSkin ? "public" : (visibilityInput?.value || "public");
  const isPublic = visibility !== "private";
  const isSecret = visibility === "secret";

  const authState = await getAuthSnapshot();
  const isAdmin = Boolean(authState.isAdmin);
  if (writeCaps.adminOnly && !isAdmin) {
    throw new Error(`${skinType}는 관리자만 작성할 수 있습니다.`);
  }
  const authorType = isAdmin
    ? (editingPost?.authorType || "ADMIN")
    : "GUEST";
  const resolvedAuthorName = editingPost?.authorName
    || fixedAuthorName
    || (authorType === "ADMIN" ? fixedAdminNickname : "GUEST");
  const payload = {
    boardId: selected.id,
    skinType,
    title,
    tags,
    imageUrl,
    thumbnailMode: allowThumbnail ? thumbMode : "",
    thumbnailAttachment: allowThumbnail && thumbMode === "file" ? uploadedThumbnail : null,
    thumbnailEmbedHtml: allowThumbnail && thumbMode === "video" ? videoThumb.embedHtml : "",
    thumbnailEmbedSrc: allowThumbnail && thumbMode === "video" ? videoThumb.embedSrc : "",
    extraAttachments: isPageSkin ? [] : uploadedExtraAttachments,
    authorType,
    authorName: resolvedAuthorName,
    isPublic,
    isSecret,
    status: isPublic ? (isSecret ? "SECRET" : "PUBLISHED") : "PRIVATE",
    updatedAt: serverTimestamp(),
    contentText,
    contentIsHtml: !!htmlModeInput?.checked
  };

  if (writeCaps.contentField === "commentHtml") payload.commentHtml = sanitizeHTML(normalizedContentHtml, { allowIframes: true });
  if (writeCaps.contentField === "contentHtml") payload.contentHtml = sanitizeHTML(normalizedContentHtml, { allowIframes: true });

  if (isSecret) {
    const secretPw = (secretPwInput?.value || "").trim();
    const hasExistingSecret = !!editingPost?.isSecret && Boolean(editingPost?.secretHash);

    if (!secretPw && !hasExistingSecret) {
      throw new Error("비밀글 비밀번호를 입력하세요.");
    }

    if (secretPw) {
      const secretSalt = crypto.getRandomValues(new Uint8Array(8));
      const saltHex = Array.from(secretSalt).map((byte) => byte.toString(16).padStart(2, "0")).join("");
      payload.secretSalt = saltHex;
      payload.secretHash = await sha256Hex(`${saltHex}:${secretPw}`);
    } else {
      payload.secretSalt = editingPost?.secretSalt || "";
      payload.secretHash = editingPost?.secretHash || "";
    }
  } else {
    payload.secretSalt = "";
    payload.secretHash = "";
  }

  if (writeCaps.autoLogNumber) {
    const existingLogNo = parseLogNumber(logNumberInput.value.trim());
    const editingSkinData = getPostSkinData(editingPost);
    const nextLogNo = editPostId
      ? (existingLogNo || parseLogNumber(editingSkinData.logNo ?? editingPost?.logNo ?? editingPost?.logNumber) || 1)
      : await resolveNextLogNumber(selected);
    payload.skinData = { ...(payload.skinData || {}), logNo: nextLogNo };
    title = String(nextLogNo);
    syncLogTitleFromNumber(nextLogNo);
  }

  payload.title = title;

  const skinData = { ...(editingPost?.skinData || {}) };
  if (skinType === "LOG") {
    skinData.logNo = parseLogNumber(logNumberInput.value.trim()) || skinData.logNo || payload.skinData?.logNo || "";
  } else {
    delete skinData.logNo;
  }

  if (skinType === "GALLERY") {
    skinData.source = sourceInput.value.trim();
  } else {
    delete skinData.source;
  }

  // 추가 이미지 정렬 (게시물별) — 좌측이 기본이라 기본값이면 저장하지 않음
  const alignValue = extraImageAlignInput?.value;
  if (["center", "right"].includes(alignValue)) {
    skinData.extraImageAlign = alignValue;
  } else {
    delete skinData.extraImageAlign;
  }

  if (getSkinPostFields(skin).length || typeof skin.buildSkinData === "function") {
    const fieldData = readSkinPostFields(skin);
    const builtSkinData = typeof skin.buildSkinData === "function"
      ? skin.buildSkinData({ title, contentText, fieldData, payload, editingPost })
      : fieldData;
    mergePlainObjects(skinData, builtSkinData);
  }

  if (skinType !== "PROFILE") {
    delete skinData.profile;
  }
  if (skinType !== "PAGE") {
    delete skinData.page;
  }

  payload.skinData = {
    ...skinData,
    ...(payload.skinData || {})
  };

  if (!editPostId) payload.createdAt = serverTimestamp();
  return payload;
}

async function savePost() {
  try {
    if (document.getElementById("honeypotWebsite")?.value) {
      showMsg("잘못된 요청입니다.", true);
      return;
    }

    const allowed = await ensureWriteAccess();
    if (!allowed) return;

    const authState = await getAuthSnapshot();
    const selectedSkin = await getSelectedSkin();
    if (selectedSkin?.capabilities?.write?.adminOnly && !authState.isAdmin) {
      showMsg(`${selectedSkin.type}는 관리자만 작성할 수 있습니다.`, true);
      return;
    }

    if (!authState.isAdmin && !isGuestCooldownPassed(30)) {
      showMsg("게스트 글쓰기는 30초 쿨타임 후 가능합니다.", true);
      return;
    }

    if (!authState.isAdmin && (visibilityInput?.value || "public") === "private") {
      showMsg("게스트 글쓰기는 공개 또는 비밀 글만 저장할 수 있습니다. 비공개는 관리자만 가능합니다.", true);
      return;
    }

    await uploadSelectedImages(getSelectedBoard()?.id || preselectBoardId || "board");
    const payload = await buildPayload();
    const nextLocation = `/board.html?bo=${encodeURIComponent(payload.boardId)}`;

    if (!authState.isAdmin) {
      const refDoc = await createGuestPost(payload);
      if (payload.skinType === "LOG" && Number.isFinite(Number(payload.skinData?.logNo))) {
        nextLogNumberCache.set(payload.boardId, Number(payload.skinData.logNo) + 1);
      }
      touchGuestCooldown();
      location.href = nextLocation;
      return;
    }

    if (editPostId) {
      await updateDoc(doc(db, "posts", editPostId), payload);
      showMsg("수정 완료");
      location.href = nextLocation;
      return;
    }

    const refDoc = await addDoc(collection(db, "posts"), payload);
    if (payload.skinType === "LOG" && Number.isFinite(Number(payload.skinData?.logNo))) {
      nextLogNumberCache.set(payload.boardId, Number(payload.skinData.logNo) + 1);
    }
    location.href = nextLocation;
  } catch (error) {
    console.error("Failed to save post:", error);
    if (isPermissionDeniedError(error)) {
      clearGuestState();
      showMsg("저장 권한이 없습니다. 게스트 코드를 다시 입력해주세요.", true);
      return;
    }
    showMsg(error.message || "저장 실패", true);
  }
}

function isPermissionDeniedError(error) {
  return error?.code === "permission-denied" || /permission/i.test(error?.message || "");
}

function buildGuestPostPayload(payload, status = "PUBLISHED") {
  const skinData = payload?.skinData && typeof payload.skinData === "object" ? payload.skinData : {};
  const guestPost = {
    boardId: payload.boardId,
    skinType: payload.skinType,
    title: payload.title,
    tags: Array.isArray(payload.tags) ? payload.tags : [],
    imageUrl: payload.imageUrl || "",
    thumbnailAttachment: payload.thumbnailAttachment || null,
    extraAttachments: Array.isArray(payload.extraAttachments) ? payload.extraAttachments : [],
    authorType: "GUEST",
    authorName: payload.authorName || "GUEST",
    isPublic: true,
    isSecret: payload.isSecret === true,
    status,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    contentText: payload.contentText || ""
  };

  if (Object.keys(skinData).length) {
    guestPost.skinData = skinData;
  }
  if (payload.commentHtml != null) guestPost.commentHtml = payload.commentHtml;
  if (payload.contentHtml != null) guestPost.contentHtml = payload.contentHtml;
  if (guestPost.isSecret) {
    guestPost.secretSalt = payload.secretSalt || "";
    guestPost.secretHash = payload.secretHash || "";
  }
  if (skinData.logNo != null && skinData.logNo !== "") guestPost.logNo = skinData.logNo;
  if (skinData.source != null && skinData.source !== "") guestPost.source = skinData.source;
  return guestPost;
}

async function createGuestPost(payload) {
  const proofHash = getGuestProofHash();
  if (!proofHash) throw new Error("게스트 코드를 먼저 입력하세요.");

  const commitGuestPost = async (status) => {
    const postRef = doc(collection(db, "posts"));
    const proofRef = doc(db, "post_write_proofs", postRef.id);
    const batch = writeBatch(db);
    batch.set(postRef, buildGuestPostPayload(payload, status));
    batch.set(proofRef, {
      postId: postRef.id,
      boardId: payload.boardId,
      proofHash,
      createdAt: serverTimestamp()
    });
    await batch.commit();
    return postRef;
  };

  try {
    return await commitGuestPost("PUBLISHED");
  } catch (error) {
    if (payload.isSecret === true && isPermissionDeniedError(error)) {
      return await commitGuestPost("SECRET");
    }
    throw error;
  }
}

async function init() {
  try {
    await loadBoards();
    await setupAuthorField();
    await loadEditPost();
    renderExtraItems();

    thumbModeUrlRadio?.addEventListener("change", applyThumbModeUI);
    thumbModeFileRadio?.addEventListener("change", applyThumbModeUI);
    thumbModeVideoRadio?.addEventListener("change", applyThumbModeUI);
    thumbVideoInput?.addEventListener("input", () => {
      if (getThumbMode() !== "video") return;
      try {
        const normalized = normalizeThumbVideoHtml(thumbVideoInput.value);
        renderThumbPreview({
          mode: "video",
          rawInput: thumbVideoInput.value,
          embedHtml: normalized.embedHtml,
          embedSrc: normalized.embedSrc
        });
      } catch (_error) {
        renderThumbPreview({
          mode: "video",
          rawInput: thumbVideoInput.value,
          embedHtml: "",
          embedSrc: ""
        });
      }
    });
    applyThumbModeUI();

    extraModeUrlRadio?.addEventListener("change", applyExtraModeUI);
    extraModeFileRadio?.addEventListener("change", applyExtraModeUI);
    extraModeVideoRadio?.addEventListener("change", applyExtraModeUI);
    extraImageUrlInput?.addEventListener("input", () => {
      const value = extraImageUrlInput.value.trim();
      if (!value) {
        renderPendingExtraPreview([]);
        return;
      }
      try {
        renderPendingExtraPreview([buildExternalAttachment(value)]);
      } catch (_error) {
        renderPendingExtraPreview([]);
      }
    });
    extraVideoInput?.addEventListener("input", () => {
      if (getExtraMode() !== "video") return;
      const value = extraVideoInput.value.trim();
      if (!value) {
        renderPendingExtraPreview([]);
        return;
      }
      try {
        renderPendingExtraPreview([buildExternalVideoAttachment(value)]);
      } catch (_error) {
        renderPendingExtraPreview([]);
      }
    });
    applyExtraModeUI();

    selectThumbFileBtn?.addEventListener("click", () => thumbFileInput?.click());
    thumbFileInput?.addEventListener("change", handleThumbFileChange);
    clearThumbFileBtn?.addEventListener("click", () => {
      clearSelectedThumb();
      showUploadMsg("선택된 썸네일 파일을 해제했습니다.");
    });
    document.addEventListener("paste", handleClipboardPaste);

    selectExtraFileBtn?.addEventListener("click", () => extraFileInput?.click());
    extraFileInput?.addEventListener("change", handleExtraFileChange);
    clearExtraFileBtn?.addEventListener("click", () => {
      clearPendingExtraSelection();
      showUploadMsg("선택된 추가 이미지 파일을 해제했습니다.");
    });

    visibilityInput?.addEventListener("change", updateSecretPasswordVisibility);
    updateSecretPasswordVisibility();

    addExtraItemBtn?.addEventListener("click", () => {
      try {
        const mode = getExtraMode();
        if (mode === "url") {
          const attachment = buildExternalAttachment(extraImageUrlInput?.value || "");
          createExtraItem({ existing: attachment });
          if (extraImageUrlInput) extraImageUrlInput.value = "";
          renderPendingExtraPreview([]);
          showUploadMsg("추가 이미지 URL을 등록 목록에 추가했습니다.");
          return;
        }

        if (mode === "video") {
          const attachment = buildExternalVideoAttachment(extraVideoInput?.value || "");
          createExtraItem({ existing: attachment });
          if (extraVideoInput) extraVideoInput.value = "";
          renderPendingExtraPreview([]);
          showUploadMsg("VIDEO를 등록 목록에 추가했습니다.");
          return;
        }

        addSelectedExtraFiles();
      } catch (error) {
        showMsg(error.message || "추가 이미지 등록 실패", true);
      }
    });

    saveBtn.addEventListener("click", savePost);
  } catch (error) {
    console.error("Write page init failed:", error);
    showMsg("작성 페이지 초기화 실패", true);
  }
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}

function cssEscape(value) {
  if (window.CSS?.escape) return CSS.escape(String(value || ""));
  return String(value || "").replace(/["\\]/g, "\\$&");
}

function preserveLineBreaks(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\n/g, "<br>\n");
}

init();
