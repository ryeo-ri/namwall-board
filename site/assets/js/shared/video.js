// NARU BOARD Copyright (c) 2026 NAMWALL — MPL-2.0 (https://mozilla.org/MPL/2.0/)
// 대표 VIDEO — 유튜브 링크·iframe 코드 → 임베드 주소, 영상 프레임 렌더
// 영상 글은 thumb에 임베드 주소, skinData.cover에 "video"를 둔다
import { escapeHtml } from "../core/site.js";

// iframe 코드는 src만 읽는다
export function toVideoEmbedSrc(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  const parsed = new DOMParser().parseFromString(raw, "text/html");
  const iframeSrc = parsed.querySelector("iframe")?.getAttribute("src") || "";
  const candidate = iframeSrc || raw;
  const youtubeId = extractYoutubeId(candidate);
  if (youtubeId) return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtubeId)}`;
  if (!iframeSrc) return "";
  return safeVideoSrc(iframeSrc);
}

function safeVideoSrc(value) {
  const raw = String(value || "").trim();
  if (!raw || /[\s\u0000-\u001f\u007f\\]/.test(raw)) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}

export function isVideoPost(post) {
  return post?.skinData?.cover === "video" && Boolean(post.thumb);
}

export function renderVideoFrame(src, className = "") {
  const safeSrc = safeVideoSrc(src);
  if (!safeSrc) return "";
  return `
    <div class="post-cover-video-frame${className ? ` ${escapeHtml(className)}` : ""}" style="--video-frame-width:560px; aspect-ratio:560 / 315;">
      <iframe src="${escapeHtml(safeSrc)}" title="VIDEO" width="560" height="315" loading="lazy" allowfullscreen frameborder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        referrerpolicy="strict-origin-when-cross-origin"></iframe>
    </div>
  `;
}

// 카드 썸네일용 정지 화면 — 유튜브만 가능, 그 외 영상은 ""
export function videoStillUrl(src) {
  const id = extractYoutubeId(src);
  return id ? `https://img.youtube.com/vi/${encodeURIComponent(id)}/hqdefault.jpg` : "";
}

function extractYoutubeId(value) {
  try {
    const safe = safeVideoSrc(value);
    if (!safe) return "";
    const url = new URL(safe);
    const host = url.hostname.replace(/^www\.|^m\./, "").toLowerCase();
    if (host === "youtu.be") return url.pathname.split("/").filter(Boolean)[0] || "";
    if (host === "youtube.com" || host === "youtube-nocookie.com") {
      return url.searchParams.get("v")
        || url.pathname.match(/\/(?:embed|shorts|live)\/([^/?#]+)/i)?.[1]
        || "";
    }
  } catch { /* 주소가 아니면 영상 아님 */ }
  return "";
}
