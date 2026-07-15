const MAX_SOURCE_BYTES = 100 * 1024 * 1024;
const MAX_ARCHIVE_CSS_BYTES = 160 * 1024;
const BLOCKED_TAGS = "script,style,iframe,object,embed,form,input,button,textarea,select,link,meta,base,audio,video,canvas,svg,math,template,slot";
const ALLOWED_STYLE_PREFIXES = [
  "align", "aspect-ratio", "background", "border", "box", "clear", "color", "column", "cursor",
  "display", "float", "flex", "font", "gap", "grid", "height", "inset", "isolation", "justify",
  "left", "letter-spacing", "line-height", "list", "margin", "max-height", "max-width", "min-height",
  "min-width", "object", "opacity", "order", "overflow", "padding", "position", "right", "table-layout",
  "text", "top", "transform", "vertical-align", "visibility", "white-space", "width", "word-break",
  "overflow-wrap", "z-index"
];

const SOURCE_TYPES = new Set(["auto", "roll20", "ccfolia"]);

export async function processScriptHtml(file, { sourceType = "auto" } = {}) {
  if (!(file instanceof File)) throw new Error("가져올 HTML 파일을 선택하세요.");
  if (file.size > MAX_SOURCE_BYTES) throw new Error("원본 HTML은 100MB 이하만 가져올 수 있습니다.");

  const source = await file.text();
  const requestedType = normalizeSourceType(sourceType);
  const resolvedType = requestedType === "auto" ? detectScriptLogSource(source) : requestedType;
  if (resolvedType === "roll20") return processRoll20Source(file, source);
  if (resolvedType === "ccfolia") return processCocofoliaSource(file, source);
  throw new Error("지원하지 않는 로그 형식입니다.");
}

export function detectScriptLogSource(source) {
  const html = String(source || "");
  if (!html.trim()) throw new Error("HTML 파일 내용이 비어 있습니다.");

  if (/(?:id\s*=\s*["']textchat["']|class\s*=\s*["'][^"']*textchatcontainer)/i.test(html)
    && /class\s*=\s*["'][^"']*\bmessage\b/i.test(html)) {
    return "roll20";
  }
  if (/<title\b[^>]*>[^<]*ccfolia\s*-\s*logs[^<]*<\/title>/i.test(html)) {
    return "ccfolia";
  }

  const parsed = new DOMParser().parseFromString(html, "text/html");
  if (parsed.querySelector("#textchat .message, .textchatcontainer .message")) return "roll20";
  const paragraphs = Array.from(parsed.body?.querySelectorAll("p") || []);
  const ccfoliaMessages = getCocofoliaMessageElements(parsed);
  if (ccfoliaMessages.length >= 3 && ccfoliaMessages.length >= paragraphs.length * 0.75) return "ccfolia";
  throw new Error("로그 형식을 자동으로 판별하지 못했습니다. Roll20 또는 코코포리아를 직접 선택해 주세요.");
}

export function getScriptSourceLabel(sourceType) {
  if (sourceType === "roll20") return "Roll20";
  if (sourceType === "ccfolia") return "코코포리아";
  return "자동 감지";
}

export async function processRoll20Html(file) {
  return processScriptHtml(file, { sourceType: "roll20" });
}

function normalizeSourceType(value) {
  const normalized = String(value || "auto").trim().toLowerCase();
  return SOURCE_TYPES.has(normalized) ? normalized : "auto";
}

async function processRoll20Source(file, source) {
  const scopedSource = extractChatMarkup(source);
  const parsed = new DOMParser().parseFromString(scopedSource, "text/html");
  const chatRoot = parsed.querySelector("#textchat .content, .textchatcontainer .content, #textchat");
  if (!chatRoot) throw new Error("Roll20 채팅 로그 영역을 찾지 못했습니다.");
  const archiveCss = extractRollTemplateStyles(source, chatRoot);

  const assetUrls = [];
  const assetIndexes = new Map();
  chatRoot.querySelectorAll(BLOCKED_TAGS).forEach((node) => node.remove());
  const directMessages = Array.from(chatRoot.children).filter((node) => node.classList.contains("message"));
  const candidates = directMessages.length
    ? directMessages
    : Array.from(chatRoot.querySelectorAll(".message")).filter((node) => !node.parentElement?.closest(".message"));
  if (!candidates.length) throw new Error("가져올 채팅 메시지가 없습니다.");

  const messages = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const message = cleanMessage(candidates[index], assetUrls, assetIndexes);
    if (message) messages.push(message);
    if (index && index % 300 === 0) await yieldToBrowser();
  }
  const archive = {
    version: 1,
    source: "roll20",
    title: String(extractDocumentTitle(source) || file.name.replace(/\.html?$/i, "")).trim(),
    createdAt: new Date().toISOString(),
    css: archiveCss,
    assets: assetUrls,
    messages
  };
  return buildProcessResult(file, archive, "roll20");
}

async function processCocofoliaSource(file, source) {
  const parsed = new DOMParser().parseFromString(source, "text/html");
  const candidates = getCocofoliaMessageElements(parsed);
  if (!candidates.length) throw new Error("코코포리아 로그 메시지를 찾지 못했습니다.");

  const messages = [];
  let previousSpeaker = "";
  let previousChannel = "";
  let previousKind = "";
  for (let index = 0; index < candidates.length; index += 1) {
    const paragraph = candidates[index];
    const spans = getDirectSpanChildren(paragraph);
    const channel = normalizeText(spans[0]?.textContent);
    const speaker = normalizeText(spans[1]?.textContent);
    const contentRoot = spans[2]?.cloneNode(true);
    if (!contentRoot) continue;

    contentRoot.querySelectorAll(BLOCKED_TAGS).forEach((node) => node.remove());
    contentRoot.querySelectorAll("img").forEach((node) => node.remove());
    contentRoot.querySelectorAll("*").forEach((node) => sanitizeElement(node, [], new Map()));
    const contentHtml = String(contentRoot.innerHTML || "").trim();
    const contentText = normalizeText(contentRoot.textContent);
    if (!contentHtml && !contentText) continue;

    const kind = looksLikeDiceResult(contentText) ? "rollresult" : "general";
    const speakerColor = normalizeCocofoliaColor(paragraph.style?.color || "");
    const continuesSpeaker = kind === "general"
      && previousKind === "general"
      && speaker
      && speaker === previousSpeaker
      && channel === previousChannel;
    const speakerStyle = speakerColor ? ` style="--script-speaker-color:${speakerColor}"` : "";
    const speakerHtml = speaker && !continuesSpeaker
      ? `<span class="by ccfolia-speaker"${speakerStyle}>${escapeHtml(speaker)}</span>`
      : "";
    const rollClass = kind === "rollresult" ? resolveCocofoliaRollClass(contentText) : "";
    const classes = ["message", kind, "ccfolia-message"];
    if (kind === "rollresult") classes.push("ccfolia-roll");
    if (rollClass) classes.push(rollClass);

    messages.push({
      kind,
      classes,
      html: `${speakerHtml}${kind === "rollresult" ? `<span class="ccfolia-roll-content">${contentHtml}</span>` : contentHtml}`.trim(),
      text: [speaker, contentText].filter(Boolean).join(" "),
      channel,
      speaker,
      speakerColor
    });
    previousSpeaker = speaker;
    previousChannel = channel;
    previousKind = kind;
    if (index && index % 300 === 0) await yieldToBrowser();
  }

  if (!messages.length) throw new Error("가져올 코코포리아 로그 메시지가 없습니다.");
  const archive = {
    version: 1,
    source: "ccfolia",
    title: String(file.name || "ccfolia-log").replace(/\.html?$/i, "").trim(),
    createdAt: new Date().toISOString(),
    css: "",
    assets: [],
    speakerAvatars: {},
    narratorSpeakers: [],
    messages
  };
  return buildProcessResult(file, archive, "ccfolia");
}

function buildProcessResult(file, archive, sourceType) {
  const normalizedBytes = new TextEncoder().encode(JSON.stringify(archive)).byteLength;
  return {
    archive,
    sourceType,
    sourceLabel: getScriptSourceLabel(sourceType),
    originalBytes: file.size,
    normalizedBytes,
    messageCount: archive.messages.length,
    assetCount: archive.assets.length,
    sourceFileName: file.name
  };
}

function getCocofoliaMessageElements(parsed) {
  return Array.from(parsed.body?.querySelectorAll("p") || []).filter((paragraph) => {
    const spans = getDirectSpanChildren(paragraph);
    if (spans.length !== 3) return false;
    return /^\s*\[[^\]]+\]\s*$/.test(String(spans[0].textContent || ""));
  });
}

function getDirectSpanChildren(element) {
  return Array.from(element?.children || []).filter((child) => child.tagName === "SPAN");
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeCocofoliaColor(value) {
  const color = String(value || "").trim();
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return color;
  if (/^rgba?\([\d\s,.%]+\)$/i.test(color)) return color;
  return "";
}

function looksLikeDiceResult(text) {
  const value = String(text || "");
  const hasDiceCommand = /(?:^|[\s(])(?:\d+)?d\d+|\bCC\s*[<>=]|\bCBR\s*\(|\bchoice\s*\[|\bRES\s*\(/i.test(value);
  return hasDiceCommand && /(?:＞|>|→)\s*[^\s]/.test(value);
}

function resolveCocofoliaRollClass(text) {
  const value = String(text || "");
  if (/펌블|fumble|大失敗/i.test(value)) return "ccfolia-roll-fumble";
  if (/크리티컬|critical|대단한 성공|극단적 성공|決定的成功/i.test(value)) return "ccfolia-roll-critical";
  if (/실패|failure|失敗/i.test(value)) return "ccfolia-roll-fail";
  if (/성공|success|成功/i.test(value)) return "ccfolia-roll-success";
  return "";
}

function escapeHtml(value) {
  const node = document.createElement("span");
  node.textContent = String(value || "");
  return node.innerHTML;
}

function extractChatMarkup(source) {
  const textchatMatch = source.match(/<div[^>]+id=["']textchat["'][^>]*>/i);
  if (!textchatMatch || textchatMatch.index == null) return source;
  const afterTextchat = source.slice(textchatMatch.index + textchatMatch[0].length);
  const contentMatch = afterTextchat.match(/<div[^>]+class=["'][^"']*\bcontent\b[^"']*["'][^>]*>/i);
  if (!contentMatch || contentMatch.index == null) return source;

  const contentStart = textchatMatch.index + textchatMatch[0].length + contentMatch.index + contentMatch[0].length;
  const remainder = source.slice(contentStart);
  const templateMatch = remainder.match(/<script[^>]+id=["']tmpl_chatmessage/i);
  const bodyMatch = remainder.match(/<\/body\s*>/i);
  const contentEnd = templateMatch?.index ?? bodyMatch?.index ?? remainder.length;
  return `<div id="textchat"><div class="content">${remainder.slice(0, contentEnd)}</div></div>`;
}

function extractDocumentTitle(source) {
  const match = source.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return "";
  const probe = document.createElement("textarea");
  probe.innerHTML = match[1];
  return probe.value.replace(/\s+/g, " ").trim();
}

function cleanMessage(sourceNode, assetUrls, assetIndexes) {
  sanitizeElement(sourceNode, assetUrls, assetIndexes);
  sourceNode.querySelectorAll("*").forEach((node) => sanitizeElement(node, assetUrls, assetIndexes));
  sourceNode.querySelectorAll(".avatar").forEach((avatar) => {
    if (!avatar.querySelector("img")) avatar.remove();
  });

  const classes = Array.from(sourceNode.classList)
    .map((value) => value.replace(/[^a-zA-Z0-9_-]/g, ""))
    .filter(Boolean)
    .slice(0, 8);
  const kind = resolveMessageKind(classes);
  const text = String(sourceNode.textContent || "").replace(/\s+/g, " ").trim();
  const html = sourceNode.innerHTML.trim();
  if (!html && !text) return null;
  // Roll20 숨김 메시지 플레이스홀더 제외 (hidden-message 클래스 또는 문구 단독)
  if (classes.includes("hidden-message") || text === "This message has been hidden.") return null;
  return { kind, classes, html, text };
}

function sanitizeElement(element, assetUrls, assetIndexes) {
  Array.from(element.attributes || []).forEach((attribute) => {
    const name = attribute.name.toLowerCase();
    if (name.startsWith("on") || name === "id" || name === "srcdoc") {
      element.removeAttribute(attribute.name);
      return;
    }
    if (["src", "href", "xlink:href", "action", "formaction", "poster", "background"].includes(name)
      && !((element.tagName === "A" && name === "href") || (element.tagName === "IMG" && name === "src"))) {
      element.removeAttribute(attribute.name);
      return;
    }
    if (name === "style") {
      const style = sanitizeStyle(attribute.value);
      if (style) element.setAttribute("style", style);
      else element.removeAttribute("style");
      return;
    }
    if (name.startsWith("data-") && name !== "data-script-asset") {
      element.removeAttribute(attribute.name);
    }
  });

  if (element.tagName === "A") {
    const href = normalizeLink(element.getAttribute("href"));
    if (href) {
      element.setAttribute("href", href);
      element.setAttribute("target", "_blank");
      element.setAttribute("rel", "noopener noreferrer");
    } else {
      element.removeAttribute("href");
    }
  }

  if (element.tagName === "IMG") {
    const src = normalizeAssetUrl(element.getAttribute("src"));
    element.removeAttribute("srcset");
    if (!src) {
      element.remove();
      return;
    }
    let index = assetIndexes.get(src);
    if (index == null) {
      index = assetUrls.length;
      assetIndexes.set(src, index);
      assetUrls.push(src);
    }
    element.removeAttribute("src");
    element.setAttribute("data-script-asset", String(index));
    element.setAttribute("loading", "lazy");
    element.setAttribute("decoding", "async");
  }
}

function sanitizeStyle(rawStyle) {
  if (!rawStyle || /expression\s*\(|@import|javascript:|behavior\s*:/i.test(rawStyle)) return "";
  return rawStyle.split(";").map((declaration) => declaration.trim()).filter(Boolean).map((declaration) => {
    const separator = declaration.indexOf(":");
    if (separator < 1) return "";
    const normalized = declaration.slice(0, separator).trim().toLowerCase();
    if (!ALLOWED_STYLE_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}-`))) return "";
    const value = declaration.slice(separator + 1).trim();
    if (/url\s*\(|expression\s*\(|javascript:/i.test(value)) return "";
    if (normalized === "position" && !/^(?:static|relative|absolute)$/i.test(value)) return "";
    return `${normalized}:${value}`;
  }).filter(Boolean).join(";");
}

function extractRollTemplateStyles(source, chatRoot) {
  const usedClasses = new Set();
  chatRoot.querySelectorAll("[class]").forEach((element) => {
    element.classList.forEach((className) => usedClasses.add(className));
  });
  const usedTemplates = new Set(Array.from(usedClasses).filter((className) => className.startsWith("sheet-rolltemplate-")));
  if (!usedTemplates.size) return "";

  const output = [];
  const stylePattern = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  for (const styleMatch of source.matchAll(stylePattern)) {
    const cssText = String(styleMatch[1] || "");
    if (!/\.sheet-rolltemplate-/i.test(cssText)) continue;
    const withoutComments = cssText.replace(/\/\*[\s\S]*?\*\//g, "");
    const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
    for (const ruleMatch of withoutComments.matchAll(rulePattern)) {
      const declarations = sanitizeStyle(ruleMatch[2]);
      if (!declarations) continue;
      const selectors = String(ruleMatch[1] || "")
        .split(",")
        .map((selector) => sanitizeRollTemplateSelector(selector, usedTemplates))
        .filter(Boolean);
      if (!selectors.length) continue;
      output.push(`${selectors.join(",")}{${declarations}}`);
      if (output.join("").length >= MAX_ARCHIVE_CSS_BYTES) break;
    }
    if (output.join("").length >= MAX_ARCHIVE_CSS_BYTES) break;
  }
  return output.join("\n").slice(0, MAX_ARCHIVE_CSS_BYTES);
}

function sanitizeRollTemplateSelector(rawSelector, usedTemplates) {
  const selector = String(rawSelector || "").trim();
  if (!selector || selector.length > 1000 || /[@{}]|:root|\b(?:html|body)\b/i.test(selector)) return "";
  const templateClasses = Array.from(selector.matchAll(/\.([a-zA-Z0-9_-]*sheet-rolltemplate-[a-zA-Z0-9_-]+)/g), (match) => match[1]);
  if (!templateClasses.some((className) => usedTemplates.has(className))) return "";
  return `.script-reader ${selector}`;
}

function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function normalizeLink(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return "";
  if (/^mailto:/i.test(value)) return value;
  try {
    const url = new URL(value, "https://app.roll20.net/");
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch (_error) {
    return "";
  }
}

function normalizeAssetUrl(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value || /^data:/i.test(value) || /^blob:/i.test(value)) return "";
  try {
    const url = new URL(value, "https://app.roll20.net/");
    if (!["http:", "https:"].includes(url.protocol)) return "";
    if (url.hostname === "app.roll20.net" && /^\/users\/avatar\//i.test(url.pathname)) return "";
    return url.href;
  } catch (_error) {
    return "";
  }
}

function resolveMessageKind(classes) {
  const kinds = ["whisper", "desc", "emote", "rollresult", "rolltemplate", "general"];
  return kinds.find((kind) => classes.includes(kind)) || "general";
}
