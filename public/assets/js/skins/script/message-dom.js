const MESSAGE_KINDS = ["general", "whisper", "desc", "emote", "rollresult", "rolltemplate"];
const STRUCTURAL_SELECTOR = ".spacer, .avatar, .by, .tstamp";
const BLOCKED_TAGS = "script,style,iframe,object,embed,form,input,button,textarea,select,link,meta,base,audio,video,canvas,svg,math,template,slot";
const ALLOWED_STYLE_PREFIXES = [
  "align", "aspect-ratio", "background", "border", "box", "clear", "color", "column", "cursor",
  "display", "float", "flex", "font", "gap", "grid", "height", "inset", "isolation", "justify",
  "left", "letter-spacing", "line-height", "list", "margin", "max-height", "max-width", "min-height",
  "min-width", "object", "opacity", "order", "overflow", "padding", "position", "right", "table-layout",
  "text", "top", "transform", "vertical-align", "visibility", "white-space", "width", "word-break",
  "overflow-wrap", "z-index"
];
const SAFE_ATTRIBUTES = new Set([
  "class", "style", "title", "colspan", "rowspan", "width", "height", "align", "valign", "role",
  "aria-label", "aria-hidden", "data-script-asset"
]);

export function isHiddenScriptMessage(message) {
  if (Array.isArray(message?.classes) && message.classes.includes("hidden-message")) return true;
  return String(message?.text || "").trim() === "This message has been hidden.";
}

export function createScriptMessageNode(message, assets = [], options = {}) {
  const node = document.createElement("article");
  const classes = Array.isArray(message?.classes)
    ? message.classes.map(cleanClassName).filter(Boolean)
    : [];
  node.className = ["script-message", ...classes].join(" ");
  node.dataset.kind = normalizeScriptMessageKind(message?.kind);
  node.innerHTML = String(message?.html || "");
  const speaker = String(message?.speaker || node.querySelector(".by")?.textContent || "")
    .replace(/\s*[:：]\s*$/, "")
    .trim();

  node.querySelectorAll(".by").forEach((by) => {
    const name = String(by.textContent || "").replace(/\s*[:：]\s*$/, "").trim();
    if (name) {
      by.textContent = name;
      applySpeakerColor(by, message?.speakerColor);
    }
    else by.remove();
  });

  if (isNarratorSpeaker(speaker, options?.narratorSpeakers)) {
    applyNarratorPresentation(node);
  } else {
    injectSpeakerAvatar(node, message, assets, options);
  }

  node.querySelectorAll("img[data-script-asset]").forEach((image) => {
    const index = Number(image.dataset.scriptAsset);
    const url = assets[index];
    if (!isSafeAssetUrl(url)) {
      image.remove();
      return;
    }
    image.loading = "lazy";
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => {
      const avatar = image.closest(".avatar");
      image.remove();
      if (avatar && !avatar.querySelector("img")) avatar.remove();
      if (!node.querySelector(".avatar img")) node.classList.add("script-message-no-avatar");
    }, { once: true });
    image.src = url;
  });

  node.querySelectorAll(".avatar").forEach((avatar) => {
    if (!avatar.querySelector("img")) avatar.remove();
  });
  if (!node.querySelector(".avatar img")) node.classList.add("script-message-no-avatar");
  return node;
}

function applySpeakerColor(by, messageColor) {
  if (!by.classList.contains("ccfolia-speaker")) return;
  const color = normalizeSpeakerColor(
    messageColor
      || by.style.getPropertyValue("--script-speaker-color")
      || by.style.borderColor
      || by.style.borderLeftColor
  );
  if (color) by.style.setProperty("--script-speaker-color", color);
  by.style.removeProperty("border-color");
  by.style.removeProperty("border-left-color");
}

function normalizeSpeakerColor(value) {
  const color = String(value || "").trim();
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return color;
  if (/^rgba?\([\d\s,.%]+\)$/i.test(color)) return color;
  return "";
}

function isNarratorSpeaker(speaker, value) {
  if (!speaker) return false;
  if (value instanceof Set) return value.has(speaker);
  return Array.isArray(value) && value.includes(speaker);
}

function applyNarratorPresentation(node) {
  node.querySelectorAll(".spacer, .avatar, .by, .tstamp").forEach((element) => element.remove());
  Array.from(node.classList).forEach((className) => {
    if (MESSAGE_KINDS.includes(className) || className.startsWith("ccfolia-roll")) {
      node.classList.remove(className);
    }
  });
  node.classList.add("desc", "ccfolia-narrator");
  node.dataset.kind = "desc";
}

function injectSpeakerAvatar(node, message, assets, options) {
  const by = node.querySelector(".by");
  if (!by || node.querySelector(".avatar img")) return;
  const speaker = String(message?.speaker || by.textContent || "").replace(/\s*[:：]\s*$/, "").trim();
  if (!speaker) return;

  const directUrl = String(options?.speakerAvatarUrl || "").trim();
  const mappedIndex = options?.speakerAvatars?.[speaker];
  const hasMappedAsset = Number.isInteger(mappedIndex)
    && mappedIndex >= 0
    && mappedIndex < assets.length;
  if (!directUrl && !hasMappedAsset) return;

  const avatar = document.createElement("span");
  avatar.className = "avatar script-speaker-avatar";
  avatar.setAttribute("aria-hidden", "true");
  const image = document.createElement("img");
  image.alt = "";
  image.loading = "lazy";
  image.decoding = "async";
  if (directUrl && isSafeLocalPreviewUrl(directUrl)) {
    image.src = directUrl;
  } else if (hasMappedAsset) {
    image.dataset.scriptAsset = String(mappedIndex);
  } else {
    return;
  }
  avatar.appendChild(image);
  by.before(avatar);
}

export function decorateScriptMessageFlow(node, speakerFlowOpen) {
  const isGeneral = node.dataset.kind === "general";
  const startsSpeakerFlow = isGeneral && Boolean(node.querySelector(".spacer, .by, .avatar"));
  const continuesSpeakerFlow = isGeneral && !startsSpeakerFlow && speakerFlowOpen;

  if (startsSpeakerFlow) node.classList.add("script-message-speaker-start");
  else if (continuesSpeakerFlow) node.classList.add("script-message-continuation");
  else node.classList.add("script-message-standalone");

  return isGeneral && (startsSpeakerFlow || continuesSpeakerFlow);
}

export function applyScriptArchiveCss(shell, rawCss) {
  const css = String(rawCss || "").trim();
  if (!shell || !css || css.length > 160 * 1024) return;
  if (/@import|url\s*\(|expression\s*\(|javascript:|behavior\s*:|<\/style/i.test(css)) return;
  const rules = Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g));
  if (!rules.length || rules.some((match) => (
    String(match[1] || "").split(",").some((selector) => !selector.trim().startsWith(".script-reader "))
  ))) return;

  shell.querySelector("style[data-script-archive-style]")?.remove();
  const style = document.createElement("style");
  style.dataset.scriptArchiveStyle = "";
  style.textContent = css;
  shell.prepend(style);
}

export function extractScriptMessageContent(rawHtml) {
  const root = document.createElement("div");
  root.innerHTML = String(rawHtml || "");
  root.querySelectorAll(STRUCTURAL_SELECTOR).forEach((node) => node.remove());
  return root.innerHTML.trim();
}

export function mergeScriptMessageContent(originalHtml, editedHtml, assetCount = 0) {
  const original = document.createElement("div");
  original.innerHTML = String(originalHtml || "");
  const structure = Array.from(original.childNodes)
    .filter((node) => node.nodeType === Node.ELEMENT_NODE && node.matches(STRUCTURAL_SELECTOR))
    .map((node) => node.outerHTML)
    .join("");
  return `${structure}${sanitizeScriptMessageContent(editedHtml, assetCount)}`.trim();
}

export function sanitizeScriptMessageContent(rawHtml, assetCount = 0) {
  const root = document.createElement("div");
  root.innerHTML = String(rawHtml || "");
  root.querySelectorAll(BLOCKED_TAGS).forEach((node) => node.remove());

  root.querySelectorAll("*").forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || name === "id" || name === "srcdoc" || !SAFE_ATTRIBUTES.has(name)) {
        if (!(element.tagName === "A" && ["href", "target", "rel"].includes(name))) {
          element.removeAttribute(attribute.name);
        }
      }
    });

    if (element.hasAttribute("class")) {
      const classes = Array.from(element.classList).map(cleanClassName).filter(Boolean).slice(0, 30);
      if (classes.length) element.className = classes.join(" ");
      else element.removeAttribute("class");
    }

    if (element.hasAttribute("style")) {
      const style = sanitizeStyle(element.getAttribute("style"));
      if (style) element.setAttribute("style", style);
      else element.removeAttribute("style");
    }

    if (element.tagName === "A") {
      const href = safeLink(element.getAttribute("href"));
      if (href) {
        element.setAttribute("href", href);
        element.setAttribute("target", "_blank");
        element.setAttribute("rel", "noopener noreferrer");
      } else {
        element.removeAttribute("href");
        element.removeAttribute("target");
        element.removeAttribute("rel");
      }
    }

    if (element.tagName === "IMG") {
      const index = Number(element.getAttribute("data-script-asset"));
      if (!Number.isInteger(index) || index < 0 || index >= assetCount) element.remove();
    }
  });

  return root.innerHTML.trim();
}

export function getScriptMessageText(rawHtml) {
  const root = document.createElement("div");
  root.innerHTML = String(rawHtml || "");
  root.querySelectorAll(".spacer, .avatar, .tstamp").forEach((node) => node.remove());
  return String(root.textContent || "").replace(/\s+/g, " ").trim();
}

export function getScriptMessageSpeaker(rawHtml) {
  const root = document.createElement("div");
  root.innerHTML = String(rawHtml || "");
  return String(root.querySelector(".by")?.textContent || "").replace(/\s*[:：]\s*$/, "").trim();
}

export function setScriptMessageKind(message, rawKind) {
  const kind = normalizeScriptMessageKind(rawKind);
  const classes = Array.isArray(message?.classes) ? message.classes.map(cleanClassName).filter(Boolean) : [];
  const filtered = classes.filter((className) => !MESSAGE_KINDS.includes(className));
  if (!filtered.includes("message")) filtered.unshift("message");
  filtered.push(kind);
  message.kind = kind;
  message.classes = Array.from(new Set(filtered));
  return message;
}

export function normalizeScriptMessageKind(value) {
  const kind = String(value || "general").trim().toLowerCase();
  return MESSAGE_KINDS.includes(kind) ? kind : "general";
}

function sanitizeStyle(rawStyle) {
  if (!rawStyle || /expression\s*\(|@import|javascript:|behavior\s*:/i.test(rawStyle)) return "";
  return rawStyle.split(";").map((declaration) => declaration.trim()).filter(Boolean).map((declaration) => {
    const separator = declaration.indexOf(":");
    if (separator < 1) return "";
    const property = declaration.slice(0, separator).trim().toLowerCase();
    if (!ALLOWED_STYLE_PREFIXES.some((prefix) => property === prefix || property.startsWith(`${prefix}-`))) return "";
    const value = declaration.slice(separator + 1).trim();
    if (/url\s*\(|expression\s*\(|javascript:/i.test(value)) return "";
    if (property === "position" && !/^(?:static|relative|absolute)$/i.test(value)) return "";
    return `${property}:${value}`;
  }).filter(Boolean).join(";");
}

function safeLink(value) {
  const href = String(value || "").replace(/[\u0000-\u001F\u007F]+/g, "").trim();
  if (!href) return "";
  if (/^[a-z][a-z0-9+.\-]*:/i.test(href) && !/^(?:https?:|mailto:)/i.test(href)) return "";
  return href;
}

function cleanClassName(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "");
}

function isSafeAssetUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_error) {
    return false;
  }
}

function isSafeLocalPreviewUrl(value) {
  try {
    return new URL(String(value || "")).protocol === "blob:";
  } catch (_error) {
    return false;
  }
}
