// 검색 — 제목·본문·출처·태그·댓글 (서버 쿼리, 원본 search-item-card 마크업)
import { runQuery, naruErrorMessage } from "../core/naru-client.js";
import { renderHeader, escapeHtml, formatDate } from "../core/site.js";

let searchInput = null;
let tagInput = null;
let resultsEl = null;
let metaEl = null;

async function init() {
  await renderHeader();
  searchInput = document.getElementById("searchInput");
  tagInput = document.getElementById("tagInput");
  resultsEl = document.getElementById("searchResults");
  metaEl = document.getElementById("searchMeta");
  if (!searchInput || !resultsEl) return;

  const params = new URLSearchParams(location.search);
  if (params.get("q")) searchInput.value = params.get("q");
  if (params.get("tag")) tagInput.value = params.get("tag");

  document.getElementById("searchBtn")?.addEventListener("click", runSearch);
  searchInput?.addEventListener("keypress", (event) => { if (event.key === "Enter") runSearch(); });
  tagInput?.addEventListener("keypress", (event) => { if (event.key === "Enter") runSearch(); });

  if (searchInput.value || tagInput.value) await runSearch();
}

async function runSearch() {
  const q = searchInput.value.trim();
  const tag = tagInput.value.trim();

  const next = new URLSearchParams();
  if (q) next.set("q", q);
  if (tag) next.set("tag", tag);
  history.replaceState(null, "", `search.html?${next.toString()}`);

  if (!q && !tag) {
    resultsEl.innerHTML = '<div class="notice">검색어를 입력해 주세요.</div>';
    metaEl.textContent = "";
    return;
  }

  try {
    const items = await runQuery("board:search", { q, tag });
    metaEl.textContent = `결과 ${items.length}개`;
    if (!items.length) {
      resultsEl.innerHTML = '<div class="notice">검색 결과가 없습니다.</div>';
      return;
    }

    resultsEl.innerHTML = items.map((item) => {
      const title = escapeHtml(item.title || (item.logNo ? String(item.logNo) : "(제목 없음)"));
      const content = String(item.excerpt || "").replace(/<[^>]*>/g, " ").trim();
      const excerpt = escapeHtml(content.length > 200 ? `${content.substring(0, 200)}...` : content);
      // 댓글에서 일치한 경우: 일치한 댓글 발췌를 한 줄 보여준다
      const commentText = String(item.commentMatch || "").replace(/<[^>]*>/g, " ").trim();
      const commentLine = commentText
        ? `<p class="search-excerpt muted small">댓글: ${escapeHtml(commentText.length > 120 ? `${commentText.substring(0, 120)}...` : commentText)}</p>`
        : "";
      const tagsHtml = (item.tags || [])
        .map((t) => `<a class="tag" href="search.html?tag=${encodeURIComponent(t)}">${escapeHtml(t)}</a>`)
        .join("");
      const metaDate = formatDate(item.updatedAt || item.createdAt);
      const logLabel = item.logNo ? ` · ${escapeHtml(String(item.logNo))}` : "";
      const viewUrl = `view.html?id=${encodeURIComponent(item.id)}&bo=${encodeURIComponent(item.boardId)}`;

      return `
        <article class="search-item search-item-card${item.thumb ? "" : " no-thumb"}">
          <div class="search-copy">
            <div class="search-meta-line">
              <span>${escapeHtml(metaDate)}</span>
              <span>${escapeHtml(item.boardTitle || item.boardId)}${logLabel}</span>
            </div>
            <a href="${viewUrl}" class="search-title">${item.isSecret ? "🔒 " : ""}${title}</a>
            ${excerpt ? `<p class="search-excerpt">${excerpt}</p>` : ""}
            ${commentLine}
            ${tagsHtml ? `<div class="search-tags">${tagsHtml}</div>` : ""}
          </div>
          ${item.thumb ? `
            <a class="search-thumb" href="${viewUrl}" aria-label="${title}">
              <img src="${escapeHtml(item.thumb)}" alt="${title}" loading="lazy">
            </a>
          ` : ""}
        </article>
      `;
    }).join("");
  } catch (error) {
    resultsEl.innerHTML = `<div class="notice">${escapeHtml(naruErrorMessage(error, "검색 중 오류가 발생했습니다."))}</div>`;
    metaEl.textContent = "";
  }
}

init();
