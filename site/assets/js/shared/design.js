// NAMWALL Edition Copyright (c) 2026 NAMWALL — MPL-2.0 (https://mozilla.org/MPL/2.0/)
// 사이트 디자인 설정(settings.design JSON) — 사용자 페이지에 CSS 변수로 적용, 관리자 디자인 화면이 편집
const HEADING_FONT_LINK_ID = "archiveHeadingFontLink";
const BODY_FONT_LINK_ID = "archiveBodyFontLink";
const HEADER_FONT_LINK_ID = "archiveHeaderFontLink";

// 색 피커 기본 표시값 (실제 기본이 투명·글자색 따름인 항목도 피커에는 색이 필요하다)
export const DESIGN_DEFAULT_LABELS = {
  bgColor: "#FFFFFF",
  containerBg: "#FFFFFF",
  textColor: "#000000",
  accentColor: "#000000",
  mutedColor: "#6B6B6B",
  btnBorderColor: "#000000",
  btnTextColor: "#000000",
  btnBgColor: "#FFFFFF",
  galleryCardBg: "#FFFFFF",
  headingFontFamily: "Pixelify Sans",
  bodyFontFamily: "Noto Sans KR"
};

export const DESIGN_PRESETS = {
  mono: {
    label: "모노 (기본)",
    design: {
      bgColor: "", textColor: "", accentColor: "", mutedColor: "",
      btnBorderColor: "", btnTextColor: "", btnBgColor: "", galleryCardBg: ""
    }
  },
  cream: {
    label: "크림 & 올리브",
    design: {
      bgColor: "#F5F3EE", textColor: "#1C1C1C", accentColor: "#4B4B4B", mutedColor: "#6B6B6B",
      btnBorderColor: "", btnTextColor: "", btnBgColor: "", galleryCardBg: ""
    }
  },
  dark: {
    label: "다크",
    design: {
      bgColor: "#161616", textColor: "#EAEAEA", accentColor: "#FFFFFF", mutedColor: "#9A9A9A",
      btnBorderColor: "", btnTextColor: "", btnBgColor: "", galleryCardBg: ""
    }
  }
};

export function normalizeDesignSettings(raw = {}) {
  const data = raw && typeof raw === "object" ? raw : {};
  return {
    bgColor: normalizeHexColor(data.bgColor),
    bgImage: normalizeImageUrl(data.bgImage),
    containerBg: normalizeHexColor(data.containerBg),
    textColor: normalizeHexColor(data.textColor),
    accentColor: normalizeHexColor(data.accentColor),
    mutedColor: normalizeHexColor(data.mutedColor),
    btnBorderColor: normalizeHexColor(data.btnBorderColor),
    btnTextColor: normalizeHexColor(data.btnTextColor),
    btnBgColor: normalizeHexColor(data.btnBgColor),
    galleryCardBg: normalizeHexColor(data.galleryCardBg),
    headingFontFamily: normalizeFontFamilyValue(data.headingFontFamily),
    bodyFontFamily: normalizeFontFamilyValue(data.bodyFontFamily)
  };
}

export function normalizeHexColor(value) {
  const raw = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw.toUpperCase() : "";
}

// 배경 이미지 주소 — http(s) URL만
export function normalizeImageUrl(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 2048) return "";
  try {
    const url = new URL(raw);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch (_error) {
    return "";
  }
}

export function normalizeFontFamilyValue(value) {
  return String(value || "")
    .replace(/^["']+|["']+$/g, "")
    .replace(/[<>{};]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export function parseDesignJson(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function userPageBody() {
  const body = document.body;
  return body && (body.classList.contains("site-page") || body.classList.contains("home-page")) ? body : null;
}

export function applyDesignSettings(rawDesign) {
  const body = userPageBody();
  if (!body) return;
  const design = normalizeDesignSettings(rawDesign);

  setOrRemoveVar(body, "--site-bg", design.bgColor);
  setOrRemoveVar(body, "--site-bg-image", design.bgImage ? `url("${escapeCssString(design.bgImage)}")` : "");
  setOrRemoveVar(body, "--site-container-bg", design.containerBg);
  setOrRemoveVar(body, "--site-text", design.textColor);
  setOrRemoveVar(body, "--site-accent", design.accentColor);
  setOrRemoveVar(body, "--muted", design.mutedColor);
  setOrRemoveVar(body, "--site-btn-border", design.btnBorderColor);
  setOrRemoveVar(body, "--site-btn-text", design.btnTextColor);
  setOrRemoveVar(body, "--site-btn-bg", design.btnBgColor);
  setOrRemoveVar(body, "--gallery-card-bg", design.galleryCardBg);

  applyCustomFont(body, "--font-heading", HEADING_FONT_LINK_ID, design.headingFontFamily,
    '"Pixelify Sans", "Noto Sans KR", sans-serif');
  applyCustomFont(body, "--font-kr", BODY_FONT_LINK_ID, design.bodyFontFamily,
    '"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif');
}

// 로고/내비 폰트 (settings.headerFontFamily)
export function applyHeaderFont(rawFontName) {
  const body = userPageBody();
  if (!body) return;
  applyCustomFont(body, "--header-font", HEADER_FONT_LINK_ID, normalizeFontFamilyValue(rawFontName),
    "var(--font-kr), sans-serif");
}

// 사이트 주인의 파일(/_owner/) — 템플릿 스타일·스크립트 뒤에 불러온다 (설정 ownerFiles)
export function applyOwnerFiles(enabled) {
  if (!enabled || !userPageBody() || document.getElementById("ownerStyle")) return;
  const style = document.createElement("link");
  style.id = "ownerStyle";
  style.rel = "stylesheet";
  style.href = "/_owner/style.css";
  const script = document.createElement("script");
  script.type = "module";
  script.src = "/_owner/script.js";
  document.head.append(style, script);
}

function setOrRemoveVar(el, name, value) {
  if (value) el.style.setProperty(name, value);
  else el.style.removeProperty(name);
}

// 구글 폰트를 불러와 CSS 변수에 지정 (폰트 이름이 비면 해제)
function applyCustomFont(body, varName, linkId, fontName, fallbackStack) {
  if (!fontName) {
    body.style.removeProperty(varName);
    document.getElementById(linkId)?.remove();
    return;
  }
  let link = document.getElementById(linkId);
  if (!link) {
    link = document.createElement("link");
    link.id = linkId;
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }
  const href = `https://fonts.googleapis.com/css2?${new URLSearchParams({ family: fontName, display: "swap" })}`;
  if (link.getAttribute("href") !== href) link.setAttribute("href", href);
  body.style.setProperty(varName, `"${escapeCssString(fontName)}", ${fallbackStack}`);
}

function escapeCssString(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
