// NARU BOARD Copyright (c) 2026 NAMWALL — MPL-2.0 (https://mozilla.org/MPL/2.0/)
// SCRIPT 아카이브는 외부 JSON도 연결할 수 있으므로 가져올 때와 표시할 때 모두 정제한다.
const TAGS = new Set("div span p br b strong i em u s del small sub sup code pre blockquote a img ul ol li table thead tbody tfoot tr td th caption colgroup col hr dl dt dd".split(" "));
export const DROP_TAGS = new Set("script style iframe object embed form input button textarea select link meta base audio video canvas svg math template slot".split(" "));
const STYLE_PREFIXES = [
  "align", "aspect-ratio", "background", "border", "box", "clear", "color", "column", "cursor",
  "display", "float", "flex", "font", "gap", "grid", "height", "inset", "isolation", "justify",
  "left", "letter-spacing", "line-height", "list", "margin", "max-height", "max-width", "min-height",
  "min-width", "object", "opacity", "order", "overflow", "padding", "position", "right", "table-layout",
  "text", "top", "transform", "vertical-align", "visibility", "white-space", "width", "word-break", "overflow-wrap", "z-index"
];

export const SCRIPT_MESSAGE_KINDS = ["general", "whisper", "desc", "emote", "rollresult", "rolltemplate"];

export function normalizeScriptMessageKind(value) {
  const kind = String(value || "general").trim().toLowerCase();
  return SCRIPT_MESSAGE_KINDS.includes(kind) ? kind : "general";
}

// 화자 색: #hex 또는 rgb()/rgba()만, 그 외는 ""
export function normalizeSpeakerColor(value) {
  const color = String(value || "").trim();
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return color;
  if (/^rgba?\([\d\s,.%]+\)$/i.test(color)) return color;
  return "";
}

export function sanitizeScriptStyle(rawStyle) {
  const raw = String(rawStyle || "");
  // CSS 이스케이프와 주석으로 url()/expression 등을 숨기는 경우도 제외한다.
  if (/[\\<>@\u0000-\u001f]|\/\*|url\s*\(|expression\s*\(|javascript:|behavior\s*:/i.test(raw)) return "";
  return raw.split(";").map((declaration) => {
    const separator = declaration.indexOf(":");
    if (separator < 1) return "";
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).trim();
    if (!value) return "";
    if (property === "--script-speaker-color") {
      return normalizeSpeakerColor(value) ? `${property}:${value}` : "";
    }
    if (!STYLE_PREFIXES.some((prefix) => property === prefix || property.startsWith(`${prefix}-`))) return "";
    if (property === "position" && !/^(?:static|relative|absolute)$/i.test(value)) return "";
    if (/var\s*\(/i.test(value) && !/^var\(\s*--script-speaker-color\s*\)$/i.test(value)) return "";
    return `${property}:${value}`;
  }).filter(Boolean).join(";");
}

function safeUrl(raw, allowMail = false) {
  const value = String(raw || "").replace(/[\u0000-\u0020\u007f]/g, "").trim();
  if (!value) return "";
  try {
    const url = new URL(value, "https://app.roll20.net/");
    return ["http:", "https:", ...(allowMail ? ["mailto:"] : [])].includes(url.protocol) ? url.href : "";
  } catch (_error) {
    return "";
  }
}

export function sanitizeScriptHtml(html) {
  // template의 내용은 연결되지 않은 채 파싱되며 이미지/iframe도 로드하지 않는다.
  const source = document.createElement("template");
  source.innerHTML = String(html || "");
  const output = document.createElement("div");
  const append = (parent, original) => {
    if (original.nodeType === 3) {
      parent.appendChild(document.createTextNode(original.textContent));
      return;
    }
    if (original.nodeType !== 1) return;
    const tag = original.tagName.toLowerCase();
    if (DROP_TAGS.has(tag)) return;
    if (!TAGS.has(tag)) {
      Array.from(original.childNodes).forEach((child) => append(parent, child));
      return;
    }
    const node = document.createElement(tag);
    for (const attribute of Array.from(original.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value;
      if (name === "class") {
        const classes = value.split(/\s+/).filter((item) => /^[a-zA-Z0-9_-]+$/.test(item)).slice(0, 32);
        if (classes.length) node.className = classes.join(" ");
      } else if (name === "style") {
        const style = sanitizeScriptStyle(value);
        if (style) node.setAttribute("style", style);
      } else if (["title", "aria-label"].includes(name) || (tag === "img" && name === "alt")) {
        node.setAttribute(name, value);
      } else if (tag === "a" && name === "href") {
        const href = safeUrl(value, true);
        if (href) node.setAttribute("href", href);
      } else if (tag === "img" && name === "src") {
        const src = safeUrl(value);
        if (src) node.setAttribute("src", src);
      } else if (tag === "img" && name === "data-script-asset" && /^\d+$/.test(value)) {
        node.setAttribute(name, value);
      } else if (["width", "height", "colspan", "rowspan", "border", "cellpadding", "cellspacing", "span"].includes(name) && /^\d{1,4}$/.test(value)) {
        node.setAttribute(name, value);
      } else if (name === "align" && /^(?:left|center|right|justify)$/.test(value)) {
        node.setAttribute(name, value);
      }
    }
    if (tag === "a" && node.hasAttribute("href")) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
    if (tag === "img") {
      if (!node.hasAttribute("src") && !node.hasAttribute("data-script-asset")) return;
      node.setAttribute("loading", "lazy");
      node.setAttribute("decoding", "async");
      node.setAttribute("referrerpolicy", "no-referrer");
    }
    Array.from(original.childNodes).forEach((child) => append(node, child));
    parent.appendChild(node);
  };
  Array.from(source.content.childNodes).forEach((node) => append(output, node));
  return output.innerHTML;
}

export function sanitizeScriptCss(rawCss) {
  const css = String(rawCss || "");
  if (css.length > 160 * 1024 || /[\\@<>]|\/\*/.test(css)) return "";
  return Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g), (match) => {
    const selectors = match[1].split(",").map((selector) => selector.trim());
    if (selectors.some((selector) => !/^\.script-reader\s+\.sheet-rolltemplate-[a-zA-Z0-9_-]+(?:[\s.:[\]="'a-zA-Z0-9_>#*+~()^$|\-]*)$/.test(selector))) return "";
    const style = sanitizeScriptStyle(match[2]);
    return style ? `${selectors.join(",")}{${style}}` : "";
  }).filter(Boolean).join("\n");
}
