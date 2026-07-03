import { db } from "../core/firebase.js";
import { ensureAdminPageAccess } from "../core/state.js";
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { invalidateSiteMainSettingsCache } from "../shared/boards-render.js";
import {
  DESIGN_DEFAULT_LABELS,
  DESIGN_PRESETS,
  normalizeDesignSettings,
  normalizeFontFamilyValue,
  normalizeHexColor,
  writeCachedDesign
} from "../shared/design.js";

const msgEl = document.getElementById("designMsg");
const presetRowEl = document.getElementById("designPresetRow");

const COLOR_FIELDS = [
  { key: "bgColor", picker: "bgColorPicker", text: "bgColorText" },
  { key: "textColor", picker: "textColorPicker", text: "textColorText" },
  { key: "accentColor", picker: "accentColorPicker", text: "accentColorText" },
  { key: "mutedColor", picker: "mutedColorPicker", text: "mutedColorText" },
  { key: "galleryCardBg", picker: "galleryCardBgPicker", text: "galleryCardBgText" }
];

const headerFontInput = document.getElementById("headerFontInput");
const headingFontInput = document.getElementById("headingFontInput");
const bodyFontInput = document.getElementById("bodyFontInput");

const PREVIEW_FONT_LINK_ID = "designPreviewFontLink";

function showMsg(text, isError = false) {
  if (!msgEl) return;
  msgEl.classList.remove("hidden");
  msgEl.classList.toggle("notice-error", isError);
  msgEl.textContent = text;
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
    headingFontFamily: headingFontInput?.value,
    bodyFontFamily: bodyFontInput?.value
  });
}

function fillForm(design, headerFontFamily) {
  COLOR_FIELDS.forEach((field) => {
    const value = design[field.key] || "";
    const textEl = document.getElementById(field.text);
    const pickerEl = document.getElementById(field.picker);
    if (textEl) textEl.value = value;
    if (pickerEl) pickerEl.value = value || DESIGN_DEFAULT_LABELS[field.key] || "#000000";
  });
  if (headerFontInput) headerFontInput.value = headerFontFamily || "";
  if (headingFontInput) headingFontInput.value = design.headingFontFamily || "";
  if (bodyFontInput) bodyFontInput.value = design.bodyFontFamily || "";
  updatePreview();
}

function updatePreview() {
  const design = readFormDesign();
  const box = document.getElementById("designPreview");
  if (!box) return;

  box.style.background = design.bgColor || DESIGN_DEFAULT_LABELS.bgColor;
  box.style.color = design.textColor || DESIGN_DEFAULT_LABELS.textColor;

  const headingFont = design.headingFontFamily || DESIGN_DEFAULT_LABELS.headingFontFamily;
  const bodyFont = design.bodyFontFamily || DESIGN_DEFAULT_LABELS.bodyFontFamily;
  const headerFont = normalizeFontFamilyValue(headerFontInput?.value) || headingFont;

  document.getElementById("previewBrand").style.fontFamily = `"${headerFont}", "Pixelify Sans", sans-serif`;
  document.getElementById("previewHeading").style.fontFamily = `"${headingFont}", "Pixelify Sans", sans-serif`;
  document.getElementById("previewBody").style.fontFamily = `"${bodyFont}", "Noto Sans KR", sans-serif`;
  document.getElementById("previewMuted").style.fontFamily = `"${bodyFont}", "Noto Sans KR", sans-serif`;
  document.getElementById("previewAccent").style.color = design.accentColor || "inherit";
  document.getElementById("previewMuted").style.color = design.mutedColor || DESIGN_DEFAULT_LABELS.mutedColor;
  document.getElementById("previewGalleryCard").style.background = design.galleryCardBg || "transparent";

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
  if (!presetRowEl) return;
  presetRowEl.innerHTML = "";
  Object.entries(DESIGN_PRESETS).forEach(([key, preset]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn";
    btn.textContent = preset.label;
    btn.addEventListener("click", () => {
      COLOR_FIELDS.forEach((field) => {
        const value = preset.design[field.key] || "";
        const textEl = document.getElementById(field.text);
        const pickerEl = document.getElementById(field.picker);
        if (textEl) textEl.value = value;
        if (pickerEl) pickerEl.value = value || DESIGN_DEFAULT_LABELS[field.key] || "#000000";
      });
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

  [headerFontInput, headingFontInput, bodyFontInput].forEach((el) => {
    el?.addEventListener("change", updatePreview);
  });
}

async function loadDesignSettings() {
  const snap = await getDoc(doc(db, "site_settings", "main"));
  const data = snap.exists() ? (snap.data() || {}) : {};
  fillForm(normalizeDesignSettings(data.design), normalizeFontFamilyValue(data.headerFontFamily));
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

    const design = readFormDesign();
    const headerFontFamily = normalizeFontFamilyValue(headerFontInput?.value);

    await setDoc(doc(db, "site_settings", "main"), {
      design,
      headerFontFamily,
      updatedAt: serverTimestamp()
    }, { merge: true });

    invalidateSiteMainSettingsCache();
    writeCachedDesign(design);
    showMsg("디자인 설정 저장 완료. 사용자 페이지 새로고침 시 적용됩니다.");
  } catch (error) {
    console.error(error);
    showMsg(`저장 실패: ${error?.message || error}`, true);
  }
}

function resetToDefaults() {
  fillForm(normalizeDesignSettings({}), "");
  showMsg("기본값으로 되돌렸습니다. 저장을 눌러야 적용됩니다.");
}

(async () => {
  const access = await ensureAdminPageAccess();
  if (!access.ok) return;

  renderPresetButtons();
  bindColorInputs();
  document.getElementById("saveDesignBtn")?.addEventListener("click", saveDesignSettings);
  document.getElementById("resetDesignBtn")?.addEventListener("click", resetToDefaults);

  try {
    await loadDesignSettings();
  } catch (error) {
    console.error(error);
    showMsg(`설정을 불러오지 못했습니다: ${error?.message || error}`, true);
  }
})();
