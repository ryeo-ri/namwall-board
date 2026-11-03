// 디자인 관리 뷰 — admin.js(해시 라우터)가 initDesignAdmin(관리자 핸들)으로 초기화한다.
// 원본 namwall admin/design-page.js 이식: 색 피커 + 폰트 + 프리셋 + 미리보기.
// 저장은 settings.design(JSON) + settings.headerFontFamily — 사용자 페이지에서
// core/site.js renderHeader가 CSS 변수로 적용한다.
import { runMutate, naruErrorMessage } from "../core/naru-client.js";
import { loadBoot, clearSiteCache } from "../core/site.js";
import {
  DESIGN_DEFAULT_LABELS,
  DESIGN_PRESETS,
  normalizeDesignSettings,
  normalizeFontFamilyValue,
  normalizeHexColor,
  parseDesignJson
} from "../shared/design.js";

const COLOR_FIELDS = [
  { key: "bgColor", picker: "bgColorPicker", text: "bgColorText" },
  { key: "textColor", picker: "textColorPicker", text: "textColorText" },
  { key: "accentColor", picker: "accentColorPicker", text: "accentColorText" },
  { key: "mutedColor", picker: "mutedColorPicker", text: "mutedColorText" },
  { key: "galleryCardBg", picker: "galleryCardBgPicker", text: "galleryCardBgText" },
  { key: "btnBorderColor", picker: "btnBorderColorPicker", text: "btnBorderColorText" },
  { key: "btnTextColor", picker: "btnTextColorPicker", text: "btnTextColorText" },
  { key: "btnBgColor", picker: "btnBgColorPicker", text: "btnBgColorText" }
];

const PREVIEW_FONT_LINK_ID = "designPreviewFontLink";

export async function initDesignAdmin() {
  renderPresetButtons();
  bindColorInputs();
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
    const brandEl = document.getElementById("previewBrand");
    if (brandEl && boot.settings.title) brandEl.textContent = boot.settings.title;
  } catch (error) {
    showMsg(`설정을 불러오지 못했습니다: ${error?.message || error}`, true);
  }
}

function showMsg(text, isError = false) {
  const msgEl = document.getElementById("designMsg");
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
    headingFontFamily: document.getElementById("headingFontInput")?.value,
    bodyFontFamily: document.getElementById("bodyFontInput")?.value
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
  const headerFontInput = document.getElementById("headerFontInput");
  const headingFontInput = document.getElementById("headingFontInput");
  const bodyFontInput = document.getElementById("bodyFontInput");
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
  previewBtn.style.fontFamily = `"${headingFont}", "Pixelify Sans", sans-serif`; // 실제 버튼은 제목 폰트를 따름

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
  Object.entries(DESIGN_PRESETS).forEach(([_key, preset]) => {
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

    const design = readFormDesign();
    const headerFontFamily = normalizeFontFamilyValue(document.getElementById("headerFontInput")?.value);

    await runMutate("site:saveSettings", {
      design: JSON.stringify(design),
      headerFontFamily
    });
    clearSiteCache();
    showMsg("디자인 설정 저장 완료. 사용자 페이지 새로고침 시 적용됩니다.");
  } catch (error) {
    showMsg(naruErrorMessage(error, `저장 실패: ${error?.message || error}`), true);
  }
}
