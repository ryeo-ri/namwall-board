export function sanitizeHTML(html, options = {}) {
  if (!html) return "";

  const allowIframes = Boolean(options.allowIframes);
  const allowedTags = ["b", "i", "u", "br", "p", "a", "img", "span", "blockquote", "code", "strong", "em", "pre"];
  if (allowIframes) allowedTags.push("iframe");

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
      if (attrName === "src" && tagName === "iframe" && !isSafeIframeSource(attr.value)) return;
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

function isSafeLink(value) {
  const trimmed = String(value || "").trim().toLowerCase();
  return Boolean(trimmed) && !trimmed.startsWith("javascript:");
}

function isSafeMediaSource(value) {
  const trimmed = String(value || "").trim().toLowerCase();
  return Boolean(trimmed) && !trimmed.startsWith("javascript:") && !trimmed.startsWith("data:text/html");
}

function isSafeIframeSource(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return false;

  try {
    const parsed = new URL(trimmed, window.location.origin);
    return parsed.protocol === "https:";
  } catch (_error) {
    return false;
  }
}
