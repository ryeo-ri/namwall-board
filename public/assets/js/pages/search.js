import { db } from "../core/firebase.js";
import { loadBoardTitleMap } from "../shared/boards-render.js";
import { getPostCoverMedia, renderPostVideoFrame } from "../shared/post-cover.js";
import { getPostSkinData, isProfilePost } from "../skins/registry.js";
import {
  collection,
  query,
  getDocs,
  where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuthSnapshot } from "../core/state.js";

const searchInput = document.getElementById("searchInput");
const tagInput = document.getElementById("tagInput");
const searchBtn = document.getElementById("searchBtn");
const resultsEl = document.getElementById("searchResults");
const metaEl = document.getElementById("searchMeta");

const params = new URLSearchParams(window.location.search);
if (params.get("q")) searchInput.value = params.get("q");
if (params.get("tag")) tagInput.value = params.get("tag");

function normalizeText(value) {
  return (value || "").toString().toLowerCase();
}

function dateToString(createdAt) {
  const d = createdAt?.toDate ? createdAt.toDate() : (createdAt ? new Date(createdAt) : new Date());
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("ko-KR");
}

function getPostDateValue(post) {
  const value = post?.updatedAt?.toDate ? post.updatedAt.toDate() : post?.updatedAt ? new Date(post.updatedAt) : null;
  if (value && !Number.isNaN(value.getTime())) return value;
  const createdAt = post?.createdAt?.toDate ? post.createdAt.toDate() : new Date(post?.createdAt || 0);
  return Number.isNaN(createdAt.getTime()) ? new Date(0) : createdAt;
}

function isPermissionDenied(error) {
  const code = String(error?.code || error?.name || "").toLowerCase();
  return code.includes("permission-denied") || code.includes("permission denied");
}

async function loadSearchPosts(isAdmin) {
  try {
    const snapshot = await getDocs(collection(db, "posts"));
    return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  } catch (error) {
    if (isAdmin || !isPermissionDenied(error)) throw error;
    const snapshot = await getDocs(query(collection(db, "posts"), where("isPublic", "in", [true, null])));
    return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  }
}

async function runSearch() {
  const queryText = searchInput.value.trim();
  const tagFilter = tagInput.value.trim().toLowerCase();

  const next = new URLSearchParams();
  if (queryText) next.set("q", queryText);
  if (tagFilter) next.set("tag", tagInput.value.trim());
  history.replaceState(null, "", `/search.html?${next.toString()}`);

  try {
    const auth = await getAuthSnapshot();
    const [posts, boardTitleMap] = await Promise.all([
      loadSearchPosts(auth.isAdmin),
      loadBoardTitleMap()
    ]);

    const visiblePosts = posts
      .filter((post) => !isProfilePost(post))
      .sort((a, b) => getPostDateValue(b) - getPostDateValue(a));

    const filtered = visiblePosts.filter((post) => {
      const skinData = getPostSkinData(post);
      const tags = (post.tags || []).map((t) => normalizeText(t));
      if (tagFilter && !tags.includes(tagFilter)) return false;
      if (!queryText) return true;

      const corpus = [
        normalizeText(post.title),
        normalizeText(post.contentHtml),
        normalizeText(post.contentText),
        normalizeText(post.commentHtml),
        normalizeText(post.comment),
        normalizeText(post.imageUrl),
        normalizeText(post.thumbnailEmbedSrc),
        normalizeText(post.thumbnailMode),
        normalizeText(skinData.source || post.source),
        normalizeText(skinData.logNo || post.logNo || post.logNumber),
        normalizeText(tags.join(" "))
      ].join(" ");

      return corpus.includes(normalizeText(queryText));
    });

    metaEl.textContent = `결과 ${filtered.length}개`;

    if (!filtered.length) {
      resultsEl.innerHTML = '<div class="notice">검색 결과가 없습니다.</div>';
      return;
    }

    resultsEl.innerHTML = filtered.map((post) => {
      const skinData = getPostSkinData(post);
      const boardId = post.boardId || "board";
      const boardName = boardTitleMap.get(String(boardId).toLowerCase()) || boardId;
      const title = escapeHtml(post.title || skinData.logNo || post.logNo || post.contentText || "(제목 없음)");
      const content = (post.contentText || post.contentHtml || post.commentHtml || post.comment || "").replace(/<[^>]*>/g, " ");
      const excerpt = escapeHtml(content.length > 200 ? `${content.substring(0, 200)}...` : content);
      const tagsHtml = (post.tags || []).map((t) => `<a class="tag" href="/search.html?q=${encodeURIComponent(t)}&tag=${encodeURIComponent(t)}">${escapeHtml(t)}</a>`).join("");
      const cover = getPostCoverMedia(post);
      const hasVideoCover = cover.mode === "video" && cover.embedHtml;
      const thumbUrl = cover.imageUrl || "";
      const metaDate = dateToString(post.updatedAt || post.createdAt);
      const logLabel = skinData.logNo || post.logNo ? ` · ${escapeHtml(String(skinData.logNo || post.logNo))}` : "";

      return `
        <article class="search-item search-item-card${thumbUrl || hasVideoCover ? "" : " no-thumb"}">
          <div class="search-copy">
            <div class="search-meta-line">
              <span>${escapeHtml(metaDate)}</span>
              <span>${escapeHtml(boardName)}${logLabel}</span>
            </div>
            <a href="/view.html?id=${post.id}&bo=${encodeURIComponent(boardId)}" class="search-title">${title}</a>
            ${excerpt ? `<p class="search-excerpt">${excerpt}</p>` : ""}
            ${tagsHtml ? `<div class="search-tags">${tagsHtml}</div>` : ""}
          </div>
          ${hasVideoCover ? `
            <div class="search-thumb search-thumb-video">
              ${renderPostVideoFrame(cover.embedHtml, "search-thumb-video-frame")}
            </div>
          ` : thumbUrl ? `
            <a class="search-thumb" href="/view.html?id=${post.id}&bo=${encodeURIComponent(boardId)}" aria-label="${title}">
              <img src="${escapeHtml(thumbUrl)}" alt="${title}" loading="lazy">
            </a>
          ` : ""}
        </article>
      `;
    }).join("");
  } catch (error) {
    console.error("Search failed:", error);
    resultsEl.innerHTML = '<div class="notice">검색 중 오류가 발생했습니다.</div>';
    metaEl.textContent = "";
  }
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}

searchBtn?.addEventListener("click", runSearch);
searchInput?.addEventListener("keypress", (e) => { if (e.key === "Enter") runSearch(); });
tagInput?.addEventListener("keypress", (e) => { if (e.key === "Enter") runSearch(); });

if (searchInput.value || tagInput.value) runSearch();
