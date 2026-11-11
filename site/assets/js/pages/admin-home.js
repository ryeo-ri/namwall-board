// NARU BOARD Copyright (c) 2026 NAMWALL — MPL-2.0 (https://mozilla.org/MPL/2.0/)
// 관리자 · 홈 소개 관리
import { runMutate, naruErrorMessage } from "../core/naru-client.js";
import { loadBoot, clearSiteCache, escapeHtml, parseHomeImages } from "../core/site.js";
import { getValue, setValue, isChecked, setChecked, showNotice, bindImagePicker } from "../shared/ui.js";

let admin = null;
let savedSettings = {};
let savedImages = [];   // [{url, source?}]
const pendingFiles = []; // [{file, previewUrl, uploadedUrl?, source?}]
const MAX_HOME_IMAGES = 12;
const MAX_SOURCE_LENGTH = 200; // 이미지 출처 ([라벨]URL 표기)
let imagesSaving = false;

export async function initHomeAdmin(adminHandle) {
  admin = adminHandle;
  const boot = await loadBoot();
  savedSettings = boot.settings || {};
  savedImages = parseHomeImages(savedSettings.homeImages);
  fillForm();
  renderSavedImages();

  bindImageControls();
  document.getElementById("resetHomeBtn")?.addEventListener("click", () => {
    if (imagesSaving) return;
    clearPending();
    renderPending();
    fillForm();
    renderSavedImages();
    showMsg("저장된 값으로 되돌렸습니다.");
  });
  document.getElementById("saveHomeBtn")?.addEventListener("click", save);
}

function fillForm() {
  setValue("siteTitleInput", savedSettings.title || "");
  setValue("ownerNameInput", savedSettings.ownerName || "");
  setValue("homeHeaderWidthInput", savedSettings.homeHeaderWidth || "");
  setChecked("homeShowTextInput", savedSettings.homeShowText === "1");
  // 하단 메뉴 노출 — 설정이 없으면 켜진 것으로 본다 (로그인 창만 기본 꺼짐)
  setChecked("homeShowRecentInput", savedSettings.homeShowRecent !== "0");
  setChecked("homeShowSearchInput", savedSettings.homeShowSearch !== "0");
  setChecked("homeShowTagsInput", savedSettings.homeShowTags !== "0");
  setChecked("homeShowLoginInput", savedSettings.homeShowLogin === "1");
  setValue("homeIntroWidthInput", savedSettings.homeIntroWidth || "");
  setValue("homeIntroHtmlInput", savedSettings.intro || "");
  setValue("homeImageWidthInput", savedSettings.homeImageWidth || "");
  setValue("homeImageHeightInput", savedSettings.homeImageHeight || "");
}

// 홈 이미지: 선택 → 미리보기(출처 입력) → '업로드'하면 바로 설정에 저장
function bindImageControls() {
  bindImagePicker({
    button: document.getElementById("selectHomeImagesBtn"),
    input: document.getElementById("homeImageInput"),
    dropZone: document.getElementById("homeImageDropZone"),
    clickZone: true
  }, (files) => {
    if (imagesSaving) return;
    files.forEach((file) => pendingFiles.push({ file, previewUrl: URL.createObjectURL(file) }));
    renderPending();
  });
  document.getElementById("clearHomeImagesBtn")?.addEventListener("click", () => {
    if (imagesSaving) return;
    clearPending();
    renderPending();
  });

  document.getElementById("saveHomeImagesBtn")?.addEventListener("click", async () => {
    if (imagesSaving) return;
    if (!pendingFiles.length) return showMsg("먼저 이미지를 선택하세요.");
    const room = MAX_HOME_IMAGES - savedImages.length;
    if (pendingFiles.length > room) {
      return showMsg(room > 0
        ? `홈 이미지는 ${MAX_HOME_IMAGES}장까지입니다. ${room}장만 더 올릴 수 있습니다.`
        : `홈 이미지는 ${MAX_HOME_IMAGES}장까지입니다. 등록된 이미지를 먼저 빼 주세요.`, true);
    }
    setImagesSaving(true);
    try {
      const batch = pendingFiles.slice();
      // 업로드 결과를 기억해 설정 저장이 실패해도 다시 올리지 않는다
      for (const item of batch) {
        if (item.uploadedUrl) continue;
        showMsg(`${item.file.name} 업로드 중…`);
        const uploaded = await admin.media.upload(item.file);
        item.uploadedUrl = uploaded.url;
      }
      await persistImages([...savedImages, ...batch.map((item) => ({ url: item.uploadedUrl, source: item.source }))]);
      batch.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      pendingFiles.splice(0, batch.length);
      renderPending();
      renderSavedImages();
      showMsg("업로드했습니다.");
    } catch (error) {
      renderPending();
      showMsg(naruErrorMessage(error, "업로드에 실패했습니다."), true);
    } finally {
      setImagesSaving(false);
    }
  });
}

function clearPending() {
  pendingFiles.forEach((item) => URL.revokeObjectURL(item.previewUrl));
  pendingFiles.length = 0;
}

function renderPending() {
  const listEl = document.getElementById("homeImagePendingPreview");
  const countEl = document.getElementById("homeImageSelectionCount");
  const clearBtn = document.getElementById("clearHomeImagesBtn");
  if (countEl) countEl.textContent = pendingFiles.length ? `선택됨 ${pendingFiles.length}개` : "";
  clearBtn?.classList.toggle("hidden", !pendingFiles.length);
  if (!listEl) return;
  listEl.innerHTML = pendingFiles.map((item, index) => `
    <div class="previewItem">
      <img class="previewImage" src="${escapeHtml(item.previewUrl)}" alt="">
      <button type="button" class="admin-image-remove" data-pending-remove="${index}" aria-label="선택 해제">&times;</button>
      ${renderSourceInput(`data-pending-source="${index}"`, item.source)}
    </div>
  `).join("");
  listEl.querySelectorAll("[data-pending-source]").forEach((input) => {
    input.addEventListener("input", () => {
      const item = pendingFiles[Number(input.dataset.pendingSource)];
      if (item) item.source = input.value;
    });
  });
  listEl.querySelectorAll("[data-pending-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      if (imagesSaving) return;
      const index = Number(button.dataset.pendingRemove);
      const [removed] = pendingFiles.splice(index, 1);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      renderPending();
    });
  });
}

function renderSavedImages() {
  const listEl = document.getElementById("homeImageItems");
  if (!listEl) return;
  listEl.innerHTML = savedImages.length
    ? savedImages.map((item, index) => `
        <div class="previewItem">
          <img class="previewImage" src="${escapeHtml(item.url)}" alt="">
          <button type="button" class="admin-image-remove" data-saved-remove="${index}" aria-label="목록에서 제거">&times;</button>
          ${renderSourceInput(`data-saved-source="${index}"`, item.source)}
        </div>
      `).join("")
    : '<div class="muted small">등록된 이미지가 없습니다.</div>';
  // 저장된 이미지의 출처는 입력칸을 벗어나면 바로 저장한다
  listEl.querySelectorAll("[data-saved-source]").forEach((input) => {
    input.addEventListener("change", async () => {
      if (imagesSaving) return;
      const index = Number(input.dataset.savedSource);
      const source = input.value.trim();
      input.value = source;
      if (!savedImages[index] || source === (savedImages[index].source || "")) return;
      setImagesSaving(true);
      try {
        await persistImages(savedImages.map((item, itemIndex) => (itemIndex === index ? { ...item, source } : item)));
        showMsg(source ? "출처를 저장했습니다." : "출처를 지웠습니다.");
      } catch (error) {
        input.value = savedImages[index]?.source || "";
        showMsg(naruErrorMessage(error, "출처를 저장하지 못했습니다."), true);
      } finally {
        setImagesSaving(false);
      }
    });
  });
  listEl.querySelectorAll("[data-saved-remove]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (imagesSaving) return;
      if (!window.confirm("이 이미지를 홈 목록에서 뺄까요? (파일은 미디어 라이브러리에 남습니다)")) return;
      const index = Number(button.dataset.savedRemove);
      setImagesSaving(true);
      try {
        await persistImages(savedImages.filter((_item, itemIndex) => itemIndex !== index));
        renderSavedImages();
        showMsg("목록에서 제거했습니다.");
      } catch (error) {
        showMsg(naruErrorMessage(error, "목록에서 제거하지 못했습니다."), true);
      } finally {
        setImagesSaving(false);
      }
    });
  });
}

function setImagesSaving(value) {
  imagesSaving = value;
  ["saveHomeImagesBtn", "selectHomeImagesBtn", "homeImageInput", "clearHomeImagesBtn", "resetHomeBtn"].forEach((id) => {
    const button = document.getElementById(id);
    if (button) button.disabled = value;
  });
  ["homeImagePendingPreview", "homeImageItems"].forEach((id) => {
    document.getElementById(id)?.querySelectorAll("button, input").forEach((control) => { control.disabled = value; });
  });
}

function renderSourceInput(dataAttribute, value) {
  return `<input type="text" class="admin-image-source" ${dataAttribute} value="${escapeHtml(value || "")}" autocomplete="off"
    maxlength="${MAX_SOURCE_LENGTH}" placeholder="출처 (선택)" title="출처 (선택) — [라벨]https://… 처럼 쓰면 라벨이 링크가 됩니다" aria-label="이미지 출처 (선택)">`;
}

async function persistImages(images) {
  // 빈 출처는 키를 빼서 설정 길이 한도를 아낀다
  const nextImages = images.slice(0, MAX_HOME_IMAGES).map(({ url, source }) => {
    const trimmed = String(source || "").trim().slice(0, MAX_SOURCE_LENGTH);
    return trimmed ? { url, source: trimmed } : { url };
  });
  const homeImages = JSON.stringify(nextImages);
  await runMutate("site:saveSettings", { homeImages });
  savedImages = nextImages;
  savedSettings = { ...savedSettings, homeImages };
  clearSiteCache();
}

async function save() {
  const saveBtn = document.getElementById("saveHomeBtn");
  if (saveBtn) saveBtn.disabled = true;
  try {
    const values = {
      title: getValue("siteTitleInput").trim(),
      ownerName: getValue("ownerNameInput").trim(),
      intro: getValue("homeIntroHtmlInput"),
      homeShowText: isChecked("homeShowTextInput") ? "1" : "",
      homeShowRecent: isChecked("homeShowRecentInput") ? "1" : "0",
      homeShowSearch: isChecked("homeShowSearchInput") ? "1" : "0",
      homeShowTags: isChecked("homeShowTagsInput") ? "1" : "0",
      homeShowLogin: isChecked("homeShowLoginInput") ? "1" : "0",
      homeIntroWidth: getValue("homeIntroWidthInput").trim(),
      homeImageWidth: getValue("homeImageWidthInput").trim(),
      homeImageHeight: getValue("homeImageHeightInput").trim(),
      homeHeaderWidth: getValue("homeHeaderWidthInput").trim()
    };
    await runMutate("site:saveSettings", values);
    clearSiteCache();
    savedSettings = { ...savedSettings, ...values };
    showMsg("저장했습니다.");
  } catch (error) {
    showMsg(naruErrorMessage(error, "저장에 실패했습니다."), true);
  }
  if (saveBtn) saveBtn.disabled = false;
}

function showMsg(text, isError = false) {
  showNotice("homeMsg", text, isError);
}
