// NARU BOARD Copyright (c) 2026 NAMWALL — MPL-2.0 (https://mozilla.org/MPL/2.0/)
// 관리자 · 디자인 관리 — 색·폰트·배경 이미지·프리셋 + 미리보기
// settings.design(JSON)과 settings.headerFontFamily로 저장한다
import { runMutate, naruErrorMessage } from "../core/naru-client.js";
import { loadBoot, clearSiteCache } from "../core/site.js";
import { showNotice, isChecked, setChecked } from "../shared/ui.js";
import {
  DESIGN_DEFAULT_LABELS,
  DESIGN_PRESETS,
  normalizeDesignSettings,
  normalizeFontFamilyValue,
  normalizeHexColor,
  normalizeImageUrl,
  parseDesignJson
} from "../shared/design.js";

const COLOR_FIELDS = [
  { key: "bgColor", picker: "bgColorPicker", text: "bgColorText" },
  { key: "containerBg", picker: "containerBgPicker", text: "containerBgText" },
  { key: "textColor", picker: "textColorPicker", text: "textColorText" },
  { key: "accentColor", picker: "accentColorPicker", text: "accentColorText" },
  { key: "mutedColor", picker: "mutedColorPicker", text: "mutedColorText" },
  { key: "galleryCardBg", picker: "galleryCardBgPicker", text: "galleryCardBgText" },
  { key: "btnBorderColor", picker: "btnBorderColorPicker", text: "btnBorderColorText" },
  { key: "btnTextColor", picker: "btnTextColorPicker", text: "btnTextColorText" },
  { key: "btnBgColor", picker: "btnBgColorPicker", text: "btnBgColorText" }
];

const PREVIEW_FONT_LINK_ID = "designPreviewFontLink";

let admin = null;
let bgImageStaged = null;      // { file, previewUrl } — 저장 시 업로드

export async function initDesignAdmin(adminHandle) {
  admin = adminHandle;
  renderPresetButtons();
  bindColorInputs();
  bindBgImageControls();
  document.getElementById("saveDesignBtn")?.addEventListener("click", saveDesignSettings);
  document.getElementById("resetDesignBtn")?.addEventListener("click", () => {
    fillForm(normalizeDesignSettings({}), "");
    showMsg("기본값으로 되돌렸습니다. 저장을 눌러야 적용됩니다.");
  });

  try {
    const boot = await loadBoot();
    fillForm(
      normalizeDesignSettings(parseDesignJson(boot.settings.design)),
      normalizeFontFamilyValue(boot.settings.headerFontFamily)
    );
    setChecked("ownerFilesInput", boot.settings.ownerFiles === "1");
    const brandEl = document.getElementById("previewBrand");
    if (brandEl && boot.settings.title) brandEl.textContent = boot.settings.title;
  } catch (error) {
    showMsg(`설정을 불러오지 못했습니다: ${error?.message || error}`, true);
  }
}

function showMsg(text, isError = false) {
  showNotice("designMsg", text, isError);
}

// 배경 이미지: URL 직접 입력 또는 파일(저장 시 업로드)
function bindBgImageControls() {
  const input = document.getElementById("bgImageInput");
  const fileInput = document.getElementById("bgImageFile");
  document.getElementById("bgImageFileBtn")?.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file || !/^image\//i.test(file.type || "")) return;
    if (bgImageStaged) URL.revokeObjectURL(bgImageStaged.previewUrl);
    bgImageStaged = { file, previewUrl: URL.createObjectURL(file) };
    renderBgImagePreview();
    updatePreview();
  });
  input?.addEventListener("input", () => {
    if (bgImageStaged) {
      URL.revokeObjectURL(bgImageStaged.previewUrl);
      bgImageStaged = null;
    }
    renderBgImagePreview();
    updatePreview();
  });
  document.getElementById("clearBgImageBtn")?.addEventListener("click", () => {
    if (bgImageStaged) URL.revokeObjectURL(bgImageStaged.previewUrl);
    bgImageStaged = null;
    if (input) input.value = "";
    renderBgImagePreview();
    updatePreview();
  });
}

function currentBgImagePreviewUrl() {
  return bgImageStaged?.previewUrl || normalizeImageUrl(document.getElementById("bgImageInput")?.value);
}

function renderBgImagePreview() {
  const previewEl = document.getElementById("bgImagePreview");
  const clearBtn = document.getElementById("clearBgImageBtn");
  const url = currentBgImagePreviewUrl();
  clearBtn?.classList.toggle("hidden", !url);
  if (!previewEl) return;
  previewEl.classList.toggle("hidden", !url);
  previewEl.innerHTML = url
    ? `<div class="previewItem"><img class="previewImage" src="${url.replace(/"/g, "&quot;")}" alt="배경 이미지 미리보기"></div>`
    : "";
}

function readColorField(field) {
  return normalizeHexColor(document.getElementById(field.text)?.value);
}

function readFormDesign() {
  const colors = {};
  COLOR_FIELDS.forEach((field) => {
    colors[field.key] = readColorField(field);
  });
  return normalizeDesignSettings({
    ...colors,
    bgImage: document.getElementById("bgImageInput")?.value,
    headingFontFamily: document.getElementById("headingFontInput")?.value,
    bodyFontFamily: document.getElementById("bodyFontInput")?.value
  });
}

function fillColors(values) {
  COLOR_FIELDS.forEach((field) => {
    const value = values[field.key] || "";
    const textEl = document.getElementById(field.text);
    const pickerEl = document.getElementById(field.picker);
    if (textEl) textEl.value = value;
    if (pickerEl) pickerEl.value = value || DESIGN_DEFAULT_LABELS[field.key] || "#000000";
  });
}

function fillForm(design, headerFontFamily) {
  fillColors(design);
  const headerFontInput = document.getElementById("headerFontInput");
  const headingFontInput = document.getElementById("headingFontInput");
  const bodyFontInput = document.getElementById("bodyFontInput");
  if (headerFontInput) headerFontInput.value = headerFontFamily || "";
  if (headingFontInput) headingFontInput.value = design.headingFontFamily || "";
  if (bodyFontInput) bodyFontInput.value = design.bodyFontFamily || "";
  const bgImageInput = document.getElementById("bgImageInput");
  if (bgImageInput) bgImageInput.value = design.bgImage || "";
  if (bgImageStaged) URL.revokeObjectURL(bgImageStaged.previewUrl);
  bgImageStaged = null;
  renderBgImagePreview();
  updatePreview();
}

function updatePreview() {
  const design = readFormDesign();
  const box = document.getElementById("designPreview");
  if (!box) return;

  box.style.background = design.bgColor || DESIGN_DEFAULT_LABELS.bgColor;
  const bgImageUrl = currentBgImagePreviewUrl();
  box.style.backgroundImage = bgImageUrl ? `url("${bgImageUrl.replace(/"/g, '\\"')}")` : "";
  box.style.backgroundSize = "cover";
  box.style.backgroundPosition = "center top";
  box.style.color = design.textColor || DESIGN_DEFAULT_LABELS.textColor;
  const previewContainer = document.getElementById("previewContainer");
  if (previewContainer) previewContainer.style.background = design.containerBg || "transparent";

  const headingFont = design.headingFontFamily || DESIGN_DEFAULT_LABELS.headingFontFamily;
  const bodyFont = design.bodyFontFamily || DESIGN_DEFAULT_LABELS.bodyFontFamily;
  const headerFont = normalizeFontFamilyValue(document.getElementById("headerFontInput")?.value) || headingFont;

  document.getElementById("previewBrand").style.fontFamily = `"${headerFont}", "Pixelify Sans", sans-serif`;
  document.getElementById("previewHeading").style.fontFamily = `"${headingFont}", "Pixelify Sans", sans-serif`;
  document.getElementById("previewBody").style.fontFamily = `"${bodyFont}", "Noto Sans KR", sans-serif`;
  document.getElementById("previewMuted").style.fontFamily = `"${bodyFont}", "Noto Sans KR", sans-serif`;
  document.getElementById("previewAccent").style.color = design.accentColor || "inherit";
  document.getElementById("previewMuted").style.color = design.mutedColor || DESIGN_DEFAULT_LABELS.mutedColor;
  document.getElementById("previewGalleryCard").style.background = design.galleryCardBg || "transparent";
  const previewBtn = document.getElementById("previewBtn");
  const btnFallback = design.textColor || DESIGN_DEFAULT_LABELS.textColor;
  previewBtn.style.color = design.btnTextColor || btnFallback;
  previewBtn.style.borderColor = design.btnBorderColor || btnFallback;
  previewBtn.style.background = design.btnBgColor || "transparent";
  previewBtn.style.fontFamily = `"${headingFont}", "Pixelify Sans", sans-serif`; // 버튼은 제목 폰트

  loadPreviewFonts([headerFont, headingFont, bodyFont]);
}

function loadPreviewFonts(fontNames) {
  const families = [...new Set(
    fontNames
      .map((name) => normalizeFontFamilyValue(name))
      .filter((name) => name && !["Pixelify Sans", "Noto Sans KR", "Darker Grotesque"].includes(name))
  )];

  const existing = document.getElementById(PREVIEW_FONT_LINK_ID);
  if (!families.length) {
    existing?.remove();
    return;
  }

  const href = "https://fonts.googleapis.com/css2?" +
    families.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}`).join("&") +
    "&display=swap";

  if (existing) {
    if (existing.getAttribute("href") !== href) existing.setAttribute("href", href);
    return;
  }
  const link = document.createElement("link");
  link.id = PREVIEW_FONT_LINK_ID;
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

function renderPresetButtons() {
  const presetRowEl = document.getElementById("designPresetRow");
  if (!presetRowEl) return;
  presetRowEl.innerHTML = "";
  Object.values(DESIGN_PRESETS).forEach((preset) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn";
    btn.textContent = preset.label;
    btn.addEventListener("click", () => {
      fillColors(preset.design);
      updatePreview();
      showMsg(`프리셋 "${preset.label}" 값을 채웠습니다. 저장을 눌러야 적용됩니다.`);
    });
    presetRowEl.appendChild(btn);
  });
}

function bindColorInputs() {
  COLOR_FIELDS.forEach((field) => {
    const textEl = document.getElementById(field.text);
    const pickerEl = document.getElementById(field.picker);

    pickerEl?.addEventListener("input", () => {
      if (textEl) textEl.value = pickerEl.value.toUpperCase();
      updatePreview();
    });
    textEl?.addEventListener("input", () => {
      const hex = normalizeHexColor(textEl.value);
      if (hex && pickerEl) pickerEl.value = hex;
      updatePreview();
    });
  });

  ["headerFontInput", "headingFontInput", "bodyFontInput"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", updatePreview);
  });
}

async function saveDesignSettings() {
  try {
    const invalidColor = COLOR_FIELDS.find((field) => {
      const raw = (document.getElementById(field.text)?.value || "").trim();
      return raw && !normalizeHexColor(raw);
    });
    if (invalidColor) {
      showMsg("색상은 #RRGGBB 형식으로 입력하세요. (예: #1C1C1C)", true);
      return;
    }
    const bgImageRaw = (document.getElementById("bgImageInput")?.value || "").trim();
    if (!bgImageStaged && bgImageRaw && !normalizeImageUrl(bgImageRaw)) {
      showMsg("배경 이미지는 http(s) 주소를 입력하거나 파일을 선택하세요.", true);
      return;
    }

    // 골라둔 배경 이미지 파일을 먼저 업로드해 URL 칸에 넣는다
    if (bgImageStaged) {
      showMsg("배경 이미지 업로드 중…");
      const uploaded = await admin.media.upload(bgImageStaged.file);
      const input = document.getElementById("bgImageInput");
      if (input) input.value = uploaded.url;
      URL.revokeObjectURL(bgImageStaged.previewUrl);
      bgImageStaged = null;
      renderBgImagePreview();
    }

    const design = readFormDesign();
    const headerFontFamily = normalizeFontFamilyValue(document.getElementById("headerFontInput")?.value);

    await runMutate("site:saveSettings", {
      design: JSON.stringify(design),
      headerFontFamily,
      ownerFiles: isChecked("ownerFilesInput") ? "1" : ""
    });
    clearSiteCache();
    showMsg("디자인 설정 저장 완료. 사용자 페이지 새로고침 시 적용됩니다.");
  } catch (error) {
    showMsg(naruErrorMessage(error, `저장 실패: ${error?.message || error}`), true);
  }
}
