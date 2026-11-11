// NARU BOARD Copyright (c) 2026 NAMWALL — MPL-2.0 (https://mozilla.org/MPL/2.0/)
import { getHttpUrl } from "../core/site.js";
import { sanitizeHTML } from "./sanitizer.js";

// 줄바꿈을 <br>로 바꾼 안전한 HTML
export function renderPlainHtml(body, allowIframes = false) {
  return sanitizeHTML(String(body || "").replace(/\r\n?/g, "\n").replace(/\n/g, "<br>"), { allowIframes });
}

// 본문·댓글: 안전한 HTML + 링크 문법 (#12 → 이 게시판의 로그 12번, [제목]URL → 굵은 링크)
// a·code·pre 안의 글자는 건드리지 않는다
export function renderRichText(body, { boardId, allowIframes = false } = {}) {
  const html = renderPlainHtml(body, allowIframes);
  if (!/#\d|\]https?:/i.test(html)) return html;
  const root = document.createElement("div");
  root.innerHTML = html;
  const targetBoard = String(boardId ?? new URLSearchParams(location.search).get("bo") ?? "");
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => node.parentElement?.closest("a, code, pre") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) linkifyText(node, targetBoard);
  return root.innerHTML;
}

function linkifyText(node, boardId) {
  const text = node.nodeValue || "";
  // URL 자체의 #숫자는 로그 참조로 바꾸지 않는다.
  const pattern = /\[([^\]\r\n]{1,80})\](https?:\/\/[^\s<>"']+)|https?:\/\/[^\s<>"']+|#(\d+)/gi;
  const fragment = document.createDocumentFragment();
  let lastIndex = 0;
  let match;
  while ((match = pattern.exec(text))) {
    const [matched, label, rawUrl, logNo] = match;
    if (match.index > lastIndex) fragment.append(text.slice(lastIndex, match.index));
    if (rawUrl) {
      const href = getHttpUrl(rawUrl);
      if (href) {
        const link = document.createElement("a");
        link.href = href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.className = "comment-named-link";
        const strong = document.createElement("strong");
        strong.textContent = label;
        link.append(strong);
        fragment.append(link);
      } else fragment.append(matched);
    } else if (logNo) {
      const link = document.createElement("a");
      link.href = `board.html?bo=${encodeURIComponent(boardId)}&log=${encodeURIComponent(logNo)}`;
      link.className = "log-tag comment-log-tag";
      link.textContent = logNo;
      fragment.append(link);
    } else fragment.append(matched);
    lastIndex = match.index + matched.length;
  }
  if (!lastIndex) return;
  if (lastIndex < text.length) fragment.append(text.slice(lastIndex));
  node.replaceWith(fragment);
}
