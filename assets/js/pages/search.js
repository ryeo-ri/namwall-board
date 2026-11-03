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
import { navigatePublic } from "../core/spa-navigation.js";

let searchInput = null;
let tagInput = null;
let searchBtn = null;
let resultsEl = null;
let metaEl = null;
let activeSearchContext = null;

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

async function loadSearchPosts(isAdmin) {
  const postsCollection = collection(db, "posts");
  const source = isAdmin
    ? postsCollection
    : query(postsCollection, where("isPublic", "==", true));
  const snapshot = await getDocs(source);
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

function isVisibleInSearch(post, isAdmin) {
  if (isAdmin) return true;

  const hasPublicFlag = Object.prototype.hasOwnProperty.call(post || {}, "isPublic");
  if (hasPublicFlag && post.isPublic !== true) return false;
  if (post?.isSecret === true) return false;

  const status = String(post?.status || "").trim().toUpperCase();
  return status !== "PRIVATE" && status !== "SECRET";
}

async function runSearch(context = activeSearchContext || {}) {
  const queryText = searchInput.value.trim();
  const tagFilter = tagInput.value.trim().toLowerCase();

  const next = new URLSearchParams();
  if (queryText) next.set("q", queryText);
  if (tagFilter) next.set("tag", tagInput.value.trim());
  navigatePublic(`search.html?${next.toString()}`, { replace: true, render: false, scroll: false });

  try {
    const auth = await getAuthSnapshot();
    const [posts, boardTitleMap] = await Promise.all([
      loadSearchPosts(auth.isAdmin),
      loadBoardTitleMap()
    ]);
    if (isInactive(context)) return;

    const visiblePosts = posts
      .filter((post) => isVisibleInSearch(post, auth.isAdmin))
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
      const tagsHtml = (post.tags || []).map((t) => `<a class="tag" href="search.html?q=${encodeURIComponent(t)}&tag=${encodeURIComponent(t)}">${escapeHtml(t)}</a>`).join("");
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
            <a href="view.html?id=${post.id}&bo=${encodeURIComponent(boardId)}" class="search-title">${title}</a>
            ${excerpt ? `<p class="search-excerpt">${excerpt}</p>` : ""}
            ${tagsHtml ? `<div class="search-tags">${tagsHtml}</div>` : ""}
          </div>
          ${hasVideoCover ? `
            <div class="search-thumb search-thumb-video">
              ${renderPostVideoFrame(cover.embedHtml, "search-thumb-video-frame")}
            </div>
          ` : thumbUrl ? `
            <a class="search-thumb" href="view.html?id=${post.id}&bo=${encodeURIComponent(boardId)}" aria-label="${title}">
              <img src="${escapeHtml(thumbUrl)}" alt="${title}" loading="lazy">
            </a>
          ` : ""}
        </article>
      `;
    }).join("");
  } catch (error) {
    if (isInactive(context)) return;
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

export async function initializeSearchPage(context = {}) {
  activeSearchContext = context;
  searchInput = document.getElementById("searchInput");
  tagInput = document.getElementById("tagInput");
  searchBtn = document.getElementById("searchBtn");
  resultsEl = document.getElementById("searchResults");
  metaEl = document.getElementById("searchMeta");

  const params = new URLSearchParams(window.location.search);
  if (params.get("q")) searchInput.value = params.get("q");
  if (params.get("tag")) tagInput.value = params.get("tag");
  searchBtn?.addEventListener("click", () => runSearch());
  searchInput?.addEventListener("keypress", (e) => { if (e.key === "Enter") runSearch(); });
  tagInput?.addEventListener("keypress", (e) => { if (e.key === "Enter") runSearch(); });

  if (searchInput.value || tagInput.value) await runSearch();
}

export function cleanupSearchPage() {
  activeSearchContext = null;
  searchInput = null;
  tagInput = null;
  searchBtn = null;
  resultsEl = null;
  metaEl = null;
}

function isInactive(context = {}) {
  return Boolean(context.signal?.aborted || (context.isActive && !context.isActive()));
}
