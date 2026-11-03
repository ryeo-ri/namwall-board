export function sanitizeHTML(html, options = {}) {
  if (!html) return "";

  // allowIframes: false(차단) | true(https 전체 허용) | "youtube"(유튜브 embed만 허용)
  const iframePolicy = normalizeIframePolicy(options.allowIframes);
  const allowedTags = ["b", "i", "u", "br", "p", "a", "img", "span", "blockquote", "code", "strong", "em", "pre"];
  if (iframePolicy !== "none") allowedTags.push("iframe");

  const allowedAttributes = {
    a: ["href", "title", "target"],
    img: ["src", "alt", "title", "width", "height", "border"],
    iframe: ["src", "title", "width", "height", "allow", "allowfullscreen", "frameborder", "referrerpolicy", "loading"]
  };

  const temp = document.createElement("div");
  temp.innerHTML = html;

  function sanitizeNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.cloneNode(true);
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }

    const tagName = node.tagName.toLowerCase();
    if (!allowedTags.includes(tagName)) {
      const fragment = document.createDocumentFragment();
      Array.from(node.childNodes).forEach((child) => {
        const sanitized = sanitizeNode(child);
        if (sanitized) fragment.appendChild(sanitized);
      });
      return fragment;
    }

    const newNode = document.createElement(tagName);
    const allowedAttrs = allowedAttributes[tagName] || [];

    Array.from(node.attributes).forEach((attr) => {
      const attrName = attr.name.toLowerCase();
      if (attrName.startsWith("on")) return;
      if (!allowedAttrs.includes(attrName)) return;
      if (attrName === "href" && !isSafeLink(attr.value)) return;
      if (attrName === "src" && tagName === "img" && !isSafeMediaSource(attr.value)) return;
      if (attrName === "src" && tagName === "iframe" && !isSafeIframeSource(attr.value, iframePolicy)) return;
      newNode.setAttribute(attrName, attr.value);
    });

    if (tagName === "a" && newNode.getAttribute("href")) {
      newNode.setAttribute("target", "_blank");
      newNode.setAttribute("rel", "noopener noreferrer");
    }

    if (tagName === "iframe") {
      if (!newNode.getAttribute("src")) return null;
      if (!newNode.getAttribute("loading")) newNode.setAttribute("loading", "lazy");
      if (!newNode.getAttribute("referrerpolicy")) {
        newNode.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
      }
    }

    Array.from(node.childNodes).forEach((child) => {
      const sanitized = sanitizeNode(child);
      if (!sanitized) return;
      if (sanitized.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
        Array.from(sanitized.childNodes).forEach((nested) => newNode.appendChild(nested));
      } else {
        newNode.appendChild(sanitized);
      }
    });

    return newNode;
  }

  const sanitized = document.createDocumentFragment();
  Array.from(temp.childNodes).forEach((node) => {
    const cleaned = sanitizeNode(node);
    if (!cleaned) return;
    if (cleaned.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
      Array.from(cleaned.childNodes).forEach((child) => sanitized.appendChild(child));
    } else {
      sanitized.appendChild(cleaned);
    }
  });

  const result = document.createElement("div");
  result.appendChild(sanitized);
  return result.innerHTML;
}

// 제어문자(탭/개행 등)를 제거해 "ja\tvascript:" 류 스킴 우회를 막는다.
function stripControlChars(value) {
  return String(value || "").replace(/[\u0000-\u001F\u007F]+/g, "");
}

function isSafeLink(value) {
  const cleaned = stripControlChars(value).trim();
  if (!cleaned) return false;
  const lower = cleaned.toLowerCase();
  // 스킴이 명시된 경우 허용 목록(http/https/mailto)만 통과.
  // javascript:, data:, vbscript: 등은 차단.
  if (/^[a-z][a-z0-9+.\-]*:/.test(lower)) {
    return /^(https?:|mailto:)/.test(lower);
  }
  // 스킴 없음 = 상대경로/앵커/쿼리 → 허용
  return true;
}

function isSafeMediaSource(value) {
  const cleaned = stripControlChars(value).trim();
  if (!cleaned) return false;
  const lower = cleaned.toLowerCase();
  if (/^[a-z][a-z0-9+.\-]*:/.test(lower)) {
    // 이미지 소스는 http/https 와 data:image/* 만 허용 (data:text/html 등 차단)
    return /^https?:/.test(lower) || /^data:image\//.test(lower);
  }
  return true;
}

function normalizeIframePolicy(value) {
  if (value === true || value === "all") return "all";
  if (value === "youtube") return "youtube";
  return "none";
}

const YOUTUBE_EMBED_HOSTS = new Set([
  "www.youtube.com",
  "youtube.com",
  "www.youtube-nocookie.com",
  "youtube-nocookie.com"
]);

function isSafeIframeSource(value, policy = "all") {
  const trimmed = stripControlChars(value).trim();
  if (!trimmed) return false;

  try {
    const parsed = new URL(trimmed, window.location.origin);
    if (parsed.protocol !== "https:") return false;
    if (policy === "youtube") {
      return YOUTUBE_EMBED_HOSTS.has(parsed.hostname.toLowerCase())
        && parsed.pathname.startsWith("/embed/");
    }
    return true;
  } catch (_error) {
    return false;
  }
}
