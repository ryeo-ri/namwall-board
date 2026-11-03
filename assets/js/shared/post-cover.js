export function getPostCoverMedia(post = {}) {
  const thumbMode = String(post.thumbnailMode || "").trim().toLowerCase();
  const embedHtmlRaw = String(post.thumbnailEmbedHtml || "").trim();
  const embedSrcRaw = String(post.thumbnailEmbedSrc || "").trim();
  const imageUrl = String(post.imageUrl || post.thumbnailAttachment?.url || "").trim();

  if (thumbMode === "text") {
    return {
      mode: "text",
      imageUrl: "",
      embedHtml: "",
      embedSrc: "",
      previewUrl: ""
    };
  }

  if (thumbMode === "video" || embedHtmlRaw) {
    const normalized = normalizeVideoEmbedInput(embedHtmlRaw || embedSrcRaw);
    return {
      mode: "video",
      imageUrl: "",
      embedHtml: normalized.html,
      embedSrc: normalized.src,
      previewUrl: ""
    };
  }

  return {
    mode: imageUrl ? (thumbMode || (post.thumbnailAttachment?.url ? "file" : "url")) : "",
    imageUrl,
    embedHtml: "",
    embedSrc: "",
    previewUrl: imageUrl
  };
}

export function renderPostVideoFrame(embedHtml, className = "") {
  const frame = normalizeVideoIframeFrame(embedHtml);
  if (!frame.html) return "";
  const extraClass = className ? ` ${className}` : "";
  return `<div class="post-cover-video-frame${extraClass}" style="--video-frame-width:${frame.width}px; --video-frame-height:${frame.height}px; aspect-ratio:${frame.width} / ${frame.height};">${frame.html}</div>`;
}

export function normalizeVideoIframeHtml(embedHtml) {
  return normalizeVideoIframeFrame(embedHtml).html;
}

export function normalizeVideoEmbedInput(embedInput) {
  const raw = String(embedInput || "").trim();
  if (!raw) return { html: "", src: "", width: 560, height: 315 };

  const iframeFrame = normalizeVideoIframeFrame(raw);
  if (iframeFrame.html) {
    return {
      html: iframeFrame.html,
      src: extractIframeSrc(iframeFrame.html),
      width: iframeFrame.width,
      height: iframeFrame.height
    };
  }

  const embedSrc = buildYoutubeEmbedUrl(raw);
  if (!embedSrc) return { html: "", src: "", width: 560, height: 315 };

  const generatedHtml = normalizeVideoIframeHtml(buildVideoIframeMarkup(embedSrc));
  return {
    html: generatedHtml,
    src: embedSrc,
    width: 560,
    height: 315
  };
}

function normalizeVideoIframeFrame(embedHtml) {
  const rawHtml = String(embedHtml || "").trim();
  if (!rawHtml) return { html: "", width: 560, height: 315 };

  const temp = document.createElement("div");
  temp.innerHTML = rawHtml;
  const nodes = Array.from(temp.childNodes).filter((node) => {
    if (node.nodeType === Node.TEXT_NODE) return Boolean(String(node.textContent || "").trim());
    return true;
  });
  if (nodes.length !== 1) return { html: "", width: 560, height: 315 };

  const iframe = nodes[0];
  if (!iframe || iframe.nodeType !== Node.ELEMENT_NODE || iframe.tagName.toLowerCase() !== "iframe") {
    return { html: "", width: 560, height: 315 };
  }

  if (!isSafeIframeSource(iframe.getAttribute("src"))) {
    return { html: "", width: 560, height: 315 };
  }

  const allowedAttributes = new Set(["src", "title", "width", "height", "allow", "allowfullscreen", "frameborder", "referrerpolicy", "loading"]);
  const hasUnsafeAttribute = Array.from(iframe.attributes).some((attr) => {
    const name = attr.name.toLowerCase();
    return name.startsWith("on") || !allowedAttributes.has(name);
  });
  if (hasUnsafeAttribute) return { html: "", width: 560, height: 315 };

  const width = normalizeVideoDimension(iframe.getAttribute("width"), 560);
  const height = normalizeVideoDimension(iframe.getAttribute("height"), 315);
  return {
    html: rawHtml,
    width,
    height
  };
}

function normalizeVideoDimension(value, fallback) {
  const n = Number(String(value || "").trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

function buildVideoIframeMarkup(src) {
  const safeSrc = String(src || "").trim();
  if (!safeSrc) return "";
  return `<iframe width="560" height="315" src="${safeSrc}" title="YouTube video player" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen frameborder="0" loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
}

function buildYoutubeEmbedUrl(value) {
  const videoId = extractYoutubeVideoId(value);
  return videoId ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}` : "";
}

function extractYoutubeVideoId(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";

  try {
    const parsed = new URL(trimmed, window.location.origin);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    const path = parsed.pathname || "";

    if (host === "youtu.be") {
      return (path.split("/").filter(Boolean)[0] || "").trim();
    }

    if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
      const videoIdFromQuery = parsed.searchParams.get("v") || "";
      const embedMatch = path.match(/\/embed\/([^/]+)/i);
      const shortsMatch = path.match(/\/shorts\/([^/]+)/i);
      return (videoIdFromQuery || embedMatch?.[1] || shortsMatch?.[1] || "").trim();
    }
  } catch (_error) {
    return "";
  }

  return "";
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

export function extractIframeSrc(html) {
  const temp = document.createElement("div");
  temp.innerHTML = String(html || "").trim();
  return temp.querySelector("iframe")?.getAttribute("src") || "";
}

export function getYoutubeThumbnailUrl(embedSrc) {
  const src = String(embedSrc || "").trim();
  if (!src) return "";

  try {
    const parsed = new URL(src, window.location.origin);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    const path = parsed.pathname || "";
    let videoId = "";

    if (host === "youtu.be") {
      videoId = path.split("/").filter(Boolean)[0] || "";
    } else if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
      const embedMatch = path.match(/\/embed\/([^/]+)/i);
      const shortsMatch = path.match(/\/shorts\/([^/]+)/i);
      videoId = (embedMatch?.[1] || shortsMatch?.[1] || "").trim();
    }

    return videoId ? `https://img.youtube.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg` : "";
  } catch (_error) {
    return "";
  }
}
