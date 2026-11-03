// 홈 소개 관리 뷰 — admin.js(해시 라우터)가 initHomeAdmin(관리자 핸들)으로 초기화한다.
import { runMutate, naruErrorMessage } from "../core/naru-client.js";
import { loadBoot, clearSiteCache, escapeHtml } from "../core/site.js";

let admin = null;
let savedSettings = {};
let savedImages = [];   // [{url}]
const pendingFiles = []; // [{file, previewUrl}]

export async function initHomeAdmin(adminHandle) {
  admin = adminHandle;
  const boot = await loadBoot();
  savedSettings = boot.settings || {};
  savedImages = parseImages(savedSettings.homeImages);
  fillForm();
  renderSavedImages();

  bindImageControls();
  document.getElementById("resetHomeBtn")?.addEventListener("click", () => {
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
  document.getElementById("homeShowTextInput").checked = savedSettings.homeShowText === "1";
  setValue("homeIntroWidthInput", savedSettings.homeIntroWidth || "");
  setValue("homeIntroHtmlInput", savedSettings.intro || "");
  setValue("homeImageWidthInput", savedSettings.homeImageWidth || "");
  setValue("homeImageHeightInput", savedSettings.homeImageHeight || "");
}

/* ── 홈 이미지: 드롭존 선택 → pending 미리보기 → '업로드' → 저장된 목록 반영 ── */
function bindImageControls() {
  const dropZone = document.getElementById("homeImageDropZone");
  const fileInput = document.getElementById("homeImageInput");

  const addFiles = (files) => {
    Array.from(files || []).forEach((file) => {
      if (!/^image\//i.test(file.type || "")) return;
      pendingFiles.push({ file, previewUrl: URL.createObjectURL(file) });
    });
    renderPending();
  };
  document.getElementById("selectHomeImagesBtn")?.addEventListener("click", () => fileInput?.click());
  dropZone?.addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    fileInput?.click();
  });
  fileInput?.addEventListener("change", () => { addFiles(fileInput.files); fileInput.value = ""; });
  dropZone?.addEventListener("dragover", (event) => event.preventDefault());
  dropZone?.addEventListener("drop", (event) => {
    event.preventDefault();
    addFiles(event.dataTransfer?.files);
  });
  dropZone?.addEventListener("paste", (event) => {
    const files = Array.from(event.clipboardData?.files || []).filter((item) => /^image\//i.test(item.type || ""));
    if (files.length) { event.preventDefault(); addFiles(files); }
  });
  document.getElementById("clearHomeImagesBtn")?.addEventListener("click", () => {
    clearPending();
    renderPending();
  });

  // 업로드: pending 전부 나루 미디어로 올리고 homeImages 설정 즉시 저장
  document.getElementById("saveHomeImagesBtn")?.addEventListener("click", async () => {
    if (!pendingFiles.length) return showMsg("먼저 이미지를 선택하세요.");
    try {
      for (const item of pendingFiles) {
        showMsg(`${item.file.name} 업로드 중…`);
        const uploaded = await admin.media.upload(item.file);
        savedImages.push({ url: uploaded.url });
      }
      clearPending();
      renderPending();
      await persistImages();
      renderSavedImages();
      showMsg("업로드했습니다.");
    } catch (error) {
      showMsg(naruErrorMessage(error, "업로드에 실패했습니다."), true);
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
    </div>
  `).join("");
  listEl.querySelectorAll("[data-pending-remove]").forEach((button) => {
    button.addEventListener("click", () => {
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
        </div>
      `).join("")
    : '<div class="muted small">등록된 이미지가 없습니다.</div>';
  listEl.querySelectorAll("[data-saved-remove]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!window.confirm("이 이미지를 홈 목록에서 뺄까요? (파일은 미디어 라이브러리에 남습니다)")) return;
      savedImages.splice(Number(button.dataset.savedRemove), 1);
      await persistImages();
      renderSavedImages();
      showMsg("목록에서 제거했습니다.");
    });
  });
}

async function persistImages() {
  await runMutate("site:saveSettings", { homeImages: JSON.stringify(savedImages.slice(0, 12)) });
  clearSiteCache();
}

async function save() {
  const saveBtn = document.getElementById("saveHomeBtn");
  if (saveBtn) saveBtn.disabled = true;
  try {
    await runMutate("site:saveSettings", {
      title: getValue("siteTitleInput").trim(),
      ownerName: getValue("ownerNameInput").trim(),
      intro: getValue("homeIntroHtmlInput"),
      homeShowText: document.getElementById("homeShowTextInput")?.checked ? "1" : "",
      homeIntroWidth: getValue("homeIntroWidthInput").trim(),
      homeImageWidth: getValue("homeImageWidthInput").trim(),
      homeImageHeight: getValue("homeImageHeightInput").trim(),
      homeHeaderWidth: getValue("homeHeaderWidthInput").trim()
    });
    clearSiteCache();
    savedSettings = {
      ...savedSettings,
      title: getValue("siteTitleInput").trim(),
      ownerName: getValue("ownerNameInput").trim(),
      intro: getValue("homeIntroHtmlInput"),
      homeShowText: document.getElementById("homeShowTextInput")?.checked ? "1" : "",
      homeIntroWidth: getValue("homeIntroWidthInput").trim(),
      homeImageWidth: getValue("homeImageWidthInput").trim(),
      homeImageHeight: getValue("homeImageHeightInput").trim(),
      homeHeaderWidth: getValue("homeHeaderWidthInput").trim()
    };
    showMsg("저장했습니다.");
  } catch (error) {
    showMsg(naruErrorMessage(error, "저장에 실패했습니다."), true);
  }
  if (saveBtn) saveBtn.disabled = false;
}

function parseImages(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => item && item.url) : [];
  } catch (_error) {
    return [];
  }
}

function getValue(id) { return document.getElementById(id)?.value || ""; }
function setValue(id, value) { const el = document.getElementById(id); if (el) el.value = value ?? ""; }
function showMsg(text, isError = false) {
  const el = document.getElementById("homeMsg");
  if (!el) return;
  el.textContent = text;
  el.classList.remove("hidden");
  el.classList.toggle("notice-error", isError);
}
