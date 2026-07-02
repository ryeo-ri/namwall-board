import { db, storage } from "../core/firebase.js";
import { ensureAdminPageAccess } from "../core/state.js";
import { invalidateSiteMainSettingsCache, loadSiteMainSettings } from "../shared/boards-render.js";
import {
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

const msgEl = document.getElementById("homeMsg");
const siteTitleInput = document.getElementById("siteTitleInput");
const homeShowTextInput = document.getElementById("homeShowTextInput");
const homeIntroInput = document.getElementById("homeIntroHtmlInput");
const homeIntroWidthInput = document.getElementById("homeIntroWidthInput");
const homeHeaderWidthInput = document.getElementById("homeHeaderWidthInput");
const headerFontFamilyInput = document.getElementById("headerFontFamilyInput");
const homeImageWidthInput = document.getElementById("homeImageWidthInput");
const homeImageHeightInput = document.getElementById("homeImageHeightInput");
const homeImageInput = document.getElementById("homeImageInput");
const homeImagePathInput = document.getElementById("homeImagePathInput");
const homeImagePendingPreviewEl = document.getElementById("homeImagePendingPreview");
const homeImageItemsEl = document.getElementById("homeImageItems");
const selectHomeImagesBtn = document.getElementById("selectHomeImagesBtn");
const clearHomeImagesBtn = document.getElementById("clearHomeImagesBtn");
const saveHomeImagesBtn = document.getElementById("saveHomeImagesBtn");
const saveHomeBtn = document.getElementById("saveHomeBtn");
const resetHomeBtn = document.getElementById("resetHomeBtn");

let homeSettings = {
  siteTitle: "NAMWALL",
  homeIntroHtml: "",
  homeIntroWidth: "",
  homeShowText: false,
  homeHeaderWidth: "",
  headerFontFamily: "",
  homeImageWidth: "",
  homeImageHeight: "",
  homeImages: []
};

let stagedHomeFiles = [];
let stagedHomePreviewUrls = [];
let removedHomeImagePaths = new Set();

function showMsg(text, isError = false) {
  if (!msgEl) return;
  msgEl.classList.remove("hidden");
  msgEl.textContent = text;
  msgEl.style.borderColor = isError ? "rgba(220,38,38,.45)" : "rgba(15,23,42,.18)";
}

function readableStorageError(error) {
  if (error?.code === "storage/unauthorized") {
    return "Storage 권한이 없어 이미지를 올릴 수 없습니다. firestore.rules와 storage.rules를 다시 게시해 주세요.";
  }
  return error?.message || "홈 소개를 저장하는 중 오류가 발생했습니다.";
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = String(text ?? "");
  return div.innerHTML;
}

function normalizePixelValue(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const number = Number(raw);
  if (!Number.isFinite(number)) return "";
  return String(Math.max(120, Math.min(2400, Math.round(number))));
}

function normalizeWidthValue(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const number = Number(raw);
  if (!Number.isFinite(number) || number < 1) return "";
  return String(Math.round(number));
}

function normalizeFontFamilyValue(value) {
  return String(value || "")
    .replace(/[<>{};]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function fileLooksLikeImage(file) {
  if (!file) return false;
  if (String(file.type || "").startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|svg|ico)$/i.test(file.name || "");
}

function ensureImageFile(file, label = "이미지") {
  if (!file || !file.name) throw new Error(`${label} 파일을 선택해 주세요.`);
  if (!fileLooksLikeImage(file)) throw new Error(`${label}는 이미지 파일만 업로드할 수 있습니다.`);
  if (Number(file.size || 0) > 20 * 1024 * 1024) {
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

function randomId(length = 8) {
  return Math.random().toString(36).slice(2, 2 + length);
}

function revokeObjectUrl(url) {
  if (typeof url === "string" && url.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}

function buildLegacyIntroHtml(settings = {}) {
  const title = String(settings.homeTitle || "").trim();
  const lead = String(settings.homeLead || "").trim();
  const body = String(settings.homeBody || "").trim();
  const parts = [];

  if (title) parts.push(`<p><strong>${escapeHtml(title)}</strong></p>`);
  if (lead) parts.push(`<p>${escapeHtml(lead)}</p>`);
  if (body) {
    body
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => parts.push(`<p>${escapeHtml(line)}</p>`));
  }

  return parts.join("");
}

function resolveIntroHtml(settings = {}) {
  if (Object.prototype.hasOwnProperty.call(settings, "homeIntroHtml")) {
    return String(settings.homeIntroHtml || "");
  }
  return buildLegacyIntroHtml(settings);
}

function updateHomeSummary() {}

function renderHomePendingPreview(files = []) {
  if (!homeImagePendingPreviewEl) return;
  const items = Array.isArray(files) ? files.filter(Boolean) : [];

  if (!items.length) {
    homeImagePendingPreviewEl.innerHTML = "";
    if (homeImagePathInput) homeImagePathInput.value = "";
    return;
  }

  if (homeImagePathInput) {
    homeImagePathInput.value = `${items.length}개 파일 선택`;
  }

  homeImagePendingPreviewEl.innerHTML = items.map((item, index) => `
    <div class="previewItem">
      <img src="${escapeHtml(item.previewUrl)}" alt="home preview ${index + 1}" class="previewImage">
    </div>
  `).join("");
}

function clearHomePendingSelection() {
  stagedHomePreviewUrls.forEach((url) => revokeObjectUrl(url));
  stagedHomePreviewUrls = [];
  stagedHomeFiles = [];
  if (homeImageInput) homeImageInput.value = "";
  renderHomePendingPreview([]);
}

function renderHomeImageItems() {
  if (!homeImageItemsEl) return;
  const items = Array.isArray(homeSettings.homeImages) ? homeSettings.homeImages : [];

  if (!items.length) {
    homeImageItemsEl.innerHTML = '<div class="muted small" style="grid-column: 1 / -1;">저장된 이미지가 없습니다.</div>';
    return;
  }

  homeImageItemsEl.innerHTML = items.map((item, index) => {
    const name = item?.name || `image-${index + 1}`;
    const url = item?.url || "";
    const path = item?.storagePath || item?.path || "";
    const key = path || url || String(index);

    return `
      <div class="previewItem" data-home-image="${escapeHtml(key)}">
        <img src="${escapeHtml(url)}" alt="${escapeHtml(name)}" class="previewImage">
        <div class="formRow mt-sm">
          <button type="button" class="btn small" data-home-remove="${escapeHtml(key)}">삭제</button>
        </div>
      </div>
    `;
  }).join("");

  homeImageItemsEl.querySelectorAll("[data-home-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.homeRemove || "";
      const index = homeSettings.homeImages.findIndex((item, idx) => {
        const itemKey = item?.storagePath || item?.path || item?.url || String(idx);
        return itemKey === key;
      });
      if (index < 0) return;

      const removed = homeSettings.homeImages.splice(index, 1)[0];
      const path = removed?.storagePath || removed?.path || "";
      if (path) removedHomeImagePaths.add(path);
      renderHomeImageItems();
      updateHomeSummary();
    });
  });
}

function fillHomeForm(settings) {
  homeSettings = {
    siteTitle: settings?.siteTitle || "NAMWALL",
    homeIntroHtml: resolveIntroHtml(settings),
    homeIntroWidth: normalizePixelValue(settings?.homeIntroWidth),
    homeShowText: settings?.homeShowText === true,
    homeHeaderWidth: normalizeWidthValue(settings?.homeHeaderWidth),
    headerFontFamily: normalizeFontFamilyValue(settings?.headerFontFamily),
    homeImageWidth: normalizePixelValue(settings?.homeImageWidth),
    homeImageHeight: normalizePixelValue(settings?.homeImageHeight),
    homeImages: Array.isArray(settings?.homeImages) ? settings.homeImages.map((item) => ({ ...item })) : []
  };

  if (siteTitleInput) siteTitleInput.value = homeSettings.siteTitle;
  if (homeShowTextInput) homeShowTextInput.checked = homeSettings.homeShowText;
  if (homeIntroInput) homeIntroInput.value = homeSettings.homeIntroHtml;
  if (homeIntroWidthInput) homeIntroWidthInput.value = homeSettings.homeIntroWidth;
  if (homeHeaderWidthInput) homeHeaderWidthInput.value = homeSettings.homeHeaderWidth;
  if (headerFontFamilyInput) headerFontFamilyInput.value = homeSettings.headerFontFamily;
  if (homeImageWidthInput) homeImageWidthInput.value = homeSettings.homeImageWidth;
  if (homeImageHeightInput) homeImageHeightInput.value = homeSettings.homeImageHeight;

  removedHomeImagePaths = new Set();
  renderHomePendingPreview([]);
  renderHomeImageItems();
  updateHomeSummary();
}

async function loadHomeSettings() {
  const settings = await loadSiteMainSettings();
  fillHomeForm(settings);
}

async function createHomeUploadToken(storagePath) {
  const tokenRef = doc(collection(db, "admin_upload_tokens"));
  await setDoc(tokenRef, {
    purpose: "homeIntro",
    storagePath,
    createdAt: serverTimestamp()
  });
  return tokenRef.id;
}

async function uploadHomeImageFile(file) {
  ensureImageFile(file, "홈 이미지");
  const extensionSafeName = escapeStorageName(file.name);
  const uniqueName = `${Date.now()}_${randomId(10)}_${extensionSafeName}`;
  const storagePath = `home_intro/${uniqueName}`;
  const storageRef = ref(storage, storagePath);
  const uploadTokenId = await createHomeUploadToken(storagePath);

  let snapshot;
  try {
    snapshot = await uploadBytes(storageRef, file, {
      contentType: file.type || "image/jpeg",
      cacheControl: "public,max-age=3600",
      customMetadata: {
        uploadToken: uploadTokenId,
        purpose: "homeIntro"
      }
    });
  } finally {
    deleteDoc(doc(db, "admin_upload_tokens", uploadTokenId)).catch(() => {});
  }

  const downloadUrl = await getDownloadURL(snapshot.ref);
  return {
    name: file.name,
    url: downloadUrl,
    path: snapshot.ref.fullPath,
    storagePath: snapshot.ref.fullPath,
    mimeType: file.type || "image/*",
    sizeBytes: Number(file.size || 0),
    source: "firebase-storage"
  };
}

async function saveHomeSettings() {
  try {
    const siteTitle = (siteTitleInput?.value || "").trim() || "NAMWALL";
    const homeIntroHtml = (homeIntroInput?.value || "").trim();
    const homeIntroWidth = normalizePixelValue(homeIntroWidthInput?.value);
    const homeShowText = !!homeShowTextInput?.checked;
    const homeHeaderWidth = normalizeWidthValue(homeHeaderWidthInput?.value);
    const headerFontFamily = normalizeFontFamilyValue(headerFontFamilyInput?.value);
    const homeImageWidth = normalizePixelValue(homeImageWidthInput?.value);
    const homeImageHeight = normalizePixelValue(homeImageHeightInput?.value);

    const uploadedImages = [];
    for (const file of stagedHomeFiles) {
      uploadedImages.push(await uploadHomeImageFile(file));
    }

    const nextImages = [...homeSettings.homeImages, ...uploadedImages];
    const refDoc = doc(db, "site_settings", "main");

    await setDoc(refDoc, {
      siteTitle,
      homeIntroHtml,
      homeIntroWidth,
      homeTitle: "",
      homeLead: "",
      homeBody: "",
      homeShowText,
      homeHeaderWidth,
      headerFontFamily,
      homeImageWidth,
      homeImageHeight,
      homeImages: nextImages,
      updatedAt: serverTimestamp()
    }, { merge: true });

    invalidateSiteMainSettingsCache();

    for (const path of removedHomeImagePaths) {
      if (!path) continue;
      try {
        await deleteObject(ref(storage, path));
      } catch (error) {
        if (error?.code !== "storage/object-not-found") {
          console.warn("Failed to delete removed home image:", path, error);
        }
      }
    }

    homeSettings = {
      siteTitle,
      homeIntroHtml,
      homeIntroWidth,
      homeShowText,
      homeHeaderWidth,
      headerFontFamily,
      homeImageWidth,
      homeImageHeight,
      homeImages: nextImages
    };
    clearHomePendingSelection();
    removedHomeImagePaths = new Set();
    if (homeImagePathInput) homeImagePathInput.value = "";
    renderHomeImageItems();
    updateHomeSummary();
    showMsg("홈 소개를 저장했습니다.");
  } catch (error) {
    console.error("Failed to save home settings:", error);
    showMsg(readableStorageError(error), true);
  }
}

function resetHomeSettings() {
  fillHomeForm({
    siteTitle: "NAMWALL",
    homeIntroHtml: "",
    homeIntroWidth: "",
    homeShowText: false,
    homeHeaderWidth: "",
    headerFontFamily: "",
    homeImageWidth: "",
    homeImageHeight: "",
    homeImages: []
  });
  clearHomePendingSelection();
  showMsg("초기화했습니다.");
}

function handleHomeImageChange(event) {
  try {
    const files = [...(event.target.files || [])];
    if (!files.length) return;
    files.forEach((file) => ensureImageFile(file, "홈 이미지"));

    clearHomePendingSelection();
    stagedHomeFiles = files;
    stagedHomePreviewUrls = files.map((file) => URL.createObjectURL(file));
    renderHomePendingPreview(files.map((file, index) => ({
      name: file.name,
      previewUrl: stagedHomePreviewUrls[index]
    })));
    showMsg(`이미지 ${files.length}개를 선택했습니다. 저장하면 반영됩니다.`);
  } catch (error) {
    clearHomePendingSelection();
    showMsg(error.message || "이미지 선택에 실패했습니다.", true);
  }
}

(async () => {
  const access = await ensureAdminPageAccess();
  if (!access.ok) return;

  await loadHomeSettings();

  selectHomeImagesBtn?.addEventListener("click", () => homeImageInput?.click());
  homeImageInput?.addEventListener("change", handleHomeImageChange);
  clearHomeImagesBtn?.addEventListener("click", () => {
    clearHomePendingSelection();
    showMsg("선택한 이미지를 해제했습니다.");
  });
  saveHomeImagesBtn?.addEventListener("click", saveHomeSettings);
  saveHomeBtn?.addEventListener("click", saveHomeSettings);
  resetHomeBtn?.addEventListener("click", resetHomeSettings);
  [
    siteTitleInput,
    homeShowTextInput,
    homeIntroInput,
    homeIntroWidthInput,
    homeHeaderWidthInput,
    headerFontFamilyInput,
    homeImageWidthInput,
    homeImageHeightInput
  ].forEach((el) => {
    el?.addEventListener("input", updateHomeSummary);
    el?.addEventListener("change", updateHomeSummary);
  });
})();
