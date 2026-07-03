// 사이트 디자인 설정 (site_settings/main 의 design 필드) 공용 모듈.
// - 사용자 페이지: core/app.js 가 applyDesignSettings 로 CSS 변수를 주입
// - 관리자 페이지: admin/design-page.js 가 편집/저장
const DESIGN_CACHE_KEY = "archive_design_cache_v1";
const HEADING_FONT_LINK_ID = "archiveHeadingFontLink";
const BODY_FONT_LINK_ID = "archiveBodyFontLink";

export const DESIGN_DEFAULT_LABELS = {
  bgColor: "#FFFFFF",
  textColor: "#000000",
  accentColor: "#000000",
  mutedColor: "#6B6B6B",
  headingFontFamily: "Pixelify Sans",
  bodyFontFamily: "Noto Sans KR"
};

export const DESIGN_PRESETS = {
  mono: {
    label: "모노 (기본)",
    design: {
      bgColor: "",
      textColor: "",
      accentColor: "",
      mutedColor: ""
    }
  },
  cream: {
    label: "크림 & 올리브",
    design: {
      bgColor: "#F5F3EE",
      textColor: "#1C1C1C",
      accentColor: "#4B4B4B",
      mutedColor: "#6B6B6B"
    }
  },
  dark: {
    label: "다크",
    design: {
      bgColor: "#161616",
      textColor: "#EAEAEA",
      accentColor: "#FFFFFF",
      mutedColor: "#9A9A9A"
    }
  }
};

export function normalizeDesignSettings(raw = {}) {
  const data = raw && typeof raw === "object" ? raw : {};
  return {
    bgColor: normalizeHexColor(data.bgColor),
    textColor: normalizeHexColor(data.textColor),
    accentColor: normalizeHexColor(data.accentColor),
    mutedColor: normalizeHexColor(data.mutedColor),
    headingFontFamily: normalizeFontFamilyValue(data.headingFontFamily),
    bodyFontFamily: normalizeFontFamilyValue(data.bodyFontFamily)
  };
}

export function normalizeHexColor(value) {
  const raw = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw.toUpperCase() : "";
}

export function normalizeFontFamilyValue(value) {
  return String(value || "")
    .replace(/^["']+|["']+$/g, "")
    .replace(/[<>{};]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

// 사용자 페이지(body.site-page / body.home-page)에만 적용
export function applyDesignSettings(rawDesign) {
  const body = document.body;
  if (!body) return;
  if (!body.classList.contains("site-page") && !body.classList.contains("home-page")) return;

  const design = normalizeDesignSettings(rawDesign);

  setOrRemoveVar(body, "--site-bg", design.bgColor);
  setOrRemoveVar(body, "--site-text", design.textColor);
  setOrRemoveVar(body, "--site-accent", design.accentColor);
  setOrRemoveVar(body, "--muted", design.mutedColor);

  applyCustomFont(body, "--font-pixel", HEADING_FONT_LINK_ID, design.headingFontFamily,
    '"Pixelify Sans", "Noto Sans KR", sans-serif');
  applyCustomFont(body, "--font-kr", BODY_FONT_LINK_ID, design.bodyFontFamily,
    '"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif');
}

function setOrRemoveVar(el, name, value) {
  if (value) el.style.setProperty(name, value);
  else el.style.removeProperty(name);
}

function applyCustomFont(body, varName, linkId, fontName, fallbackStack) {
  if (!fontName) {
    body.style.removeProperty(varName);
    document.getElementById(linkId)?.remove();
    return;
  }
  const link = ensureFontLink(linkId);
  const href = buildGoogleFontUrl(fontName);
  if (link.getAttribute("href") !== href) link.setAttribute("href", href);
  body.style.setProperty(varName, `"${escapeCssString(fontName)}", ${fallbackStack}`);
}

function ensureFontLink(id) {
  const existing = document.getElementById(id);
  if (existing) return existing;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  document.head.appendChild(link);
  return link;
}

function buildGoogleFontUrl(fontName) {
  const params = new URLSearchParams({ family: fontName, display: "swap" });
  return `https://fonts.googleapis.com/css2?${params.toString()}`;
}

function escapeCssString(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// 첫 페인트 깜빡임(FOUC) 완화용 localStorage 캐시
export function readCachedDesign() {
  try {
    const raw = localStorage.getItem(DESIGN_CACHE_KEY);
    return raw ? normalizeDesignSettings(JSON.parse(raw)) : null;
  } catch (_error) {
    return null;
  }
}

export function writeCachedDesign(design) {
  try {
    const normalized = normalizeDesignSettings(design);
    if (Object.values(normalized).some((v) => v)) {
      localStorage.setItem(DESIGN_CACHE_KEY, JSON.stringify(normalized));
    } else {
      localStorage.removeItem(DESIGN_CACHE_KEY);
    }
  } catch (_error) {
    // ignore
  }
}
