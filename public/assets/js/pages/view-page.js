import { db } from "../core/firebase.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { sanitizeHTML } from "../shared/html-sanitizer-v2.js";
import { loadComments } from "../shared/comments.js";
import { deletePostsByIds } from "../shared/post-maintenance.js";
import { getPostCoverMedia, normalizeVideoEmbedInput, renderPostVideoFrame } from "../shared/post-cover.js";
import { renderLockIcon } from "../shared/secret-icon.js";
import { getAuthSnapshot, sha256Hex } from "../core/state.js";
import { isAdminOnlyBoard, renderAdminOnlyBoardNotice } from "../shared/board-access.js";
import { showInputModal } from "../shared/ui-modal.js";
import { formatResponsiveWidth, getSiteTitle, loadSiteMainSettings, renderTopNav } from "../shared/boards-render.js";
import { findSkinTypeByAlias, getBoardSkinOption, getPostSkinData, getSkin, getSkinEditor } from "../skins/registry.js";
import "../shared/lightbox.js";

const params = new URLSearchParams(window.location.search);
const postId = params.get("id");
const viewAdminToolsEl = document.getElementById("viewAdminTools");
let currentSiteTitle = getSiteTitle();

async function loadCurrentSiteTitle() {
  try {
    currentSiteTitle = getSiteTitle(await loadSiteMainSettings());
  } catch (error) {
    console.warn("Failed to load site title:", error);
    currentSiteTitle = getSiteTitle();
  }
  return currentSiteTitle;
}

function setDocumentTitle(title) {
  document.title = `${title} - ${currentSiteTitle}`;
}

function dateToString(createdAt) {
  const d = createdAt?.toDate ? createdAt.toDate() : (createdAt ? new Date(createdAt) : new Date());
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("ko-KR");
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}

function isImageAttachment(attachment) {
  const mimeType = String(attachment?.mimeType || "").toLowerCase();
  if (mimeType.startsWith("image/")) return true;
  if (String(attachment?.mode || "").toLowerCase() === "video") return false;

  const url = String(attachment?.url || attachment?.path || "").toLowerCase();
  return /\.(png|jpe?g|gif|webp|svg|ico)(\?|#|$)/i.test(url);
}

function isVideoAttachment(attachment) {
  return String(attachment?.mode || "").toLowerCase() === "video"
    || Boolean(attachment?.embedHtml || attachment?.thumbnailEmbedHtml || attachment?.embedSrc || attachment?.thumbnailEmbedSrc);
}

function renderAttachmentLinks(attachments) {
  if (!Array.isArray(attachments) || !attachments.length) return "";
  const links = attachments
    .filter((item) => item?.url && !isImageAttachment(item) && !isVideoAttachment(item))
    .map((item) => {
      const name = escapeHtml(item.name || "download");
      const url = escapeHtml(item.url);
      return `<li><a class="previewName" title="${name}" href="${url}" target="_blank" rel="noopener noreferrer" download>${name}</a></li>`;
    })
    .join("");
  if (!links) return "";
  return `
    <div class="mt-md">
      <h3>첨부 다운로드</h3>
      <ul class="grid tight">${links}</ul>
    </div>
  `;
}

function renderInlineAttachments(attachments, align = "left") {
  if (!Array.isArray(attachments) || !attachments.length) return "";
  const imageItems = attachments.filter((item) => item?.url && isImageAttachment(item));
  const videoItems = attachments.filter((item) => isVideoAttachment(item));
  if (!imageItems.length && !videoItems.length) return "";

  const alignValue = ["left", "center", "right"].includes(align) ? align : "left";
  return `
    <div class="view-inline-gallery mt-md" data-align="${alignValue}">
      ${imageItems.map((item) => {
        const url = escapeHtml(item.url);
        const name = escapeHtml(item.name || "첨부 이미지");
        return `
          <button
            type="button"
            class="view-inline-image"
            onclick="openLightbox('${escapeJsString(item.url)}')"
            aria-label="${name} 원본 보기"
          >
            <img src="${url}" alt="${name}" loading="lazy">
          </button>
        `;
      }).join("")}
      ${videoItems.map((item) => {
        const videoSource = item.embedHtml || item.thumbnailEmbedHtml || item.embedSrc || item.thumbnailEmbedSrc || "";
        const videoHtml = videoSource ? normalizeVideoEmbedInput(videoSource).html : "";
        return videoHtml ? `
          <div class="view-inline-video">
            ${renderPostVideoFrame(videoHtml)}
          </div>
        ` : "";
      }).join("")}
    </div>
  `;
}

function renderSkinDetailResult(detail = {}, skinData = {}) {
  if (detail.hideTags) {
    const viewTagsEl = document.getElementById("viewTags");
    if (viewTagsEl) viewTagsEl.innerHTML = "";
  }
  document.getElementById("viewImage").innerHTML = detail.imageHtml || "";
  document.getElementById("viewSource").textContent = detail.sourceText || (skinData.source ? `출처: ${skinData.source}` : "");
  document.getElementById("viewContent").innerHTML = detail.contentHtml || "";
}

function applyViewWidth(board = {}, skin = null) {
  const mainEl = document.querySelector("body.site-page main.container");
  if (!mainEl) return;
  document.body?.classList.toggle("page-raw-view", skin?.type === "PAGE");
  document.body?.classList.toggle("script-view-page", skin?.type === "SCRIPT");
  const fallback = skin?.type === "PAGE" ? 900 : "";
  const width = formatResponsiveWidth(getBoardSkinOption(board, "boardWidth", fallback));
  if (width) {
    mainEl.style.setProperty("--board-page-w", width);
  } else {
    mainEl.style.removeProperty("--board-page-w");
  }
  mainEl.style.setProperty("--board-page-extra-w", "0px");
}

function renderBoardAccessDeniedPage(board = {}, fallbackBoardId = "") {
  const mainEl = document.querySelector("main.container");
  const viewNavEl = document.getElementById("viewNav");
  if (viewNavEl) {
    viewNavEl.innerHTML = `<a href="admin/login.html">관리자 로그인</a>`;
  }
  if (!mainEl) return;

  mainEl.classList.add("access-denied-shell");
  mainEl.innerHTML = renderAdminOnlyBoardNotice(board?.title || board?.name || fallbackBoardId);
  setDocumentTitle("관리자 전용 게시판입니다.");
}

async function unlockSecretIfNeeded(post, isAdmin) {
  if (!post.isSecret || isAdmin) return { unlocked: true, cancelled: false };

  const pw = await showInputModal({
    title: "잠금 해제",
    description: "비밀번호를 입력하세요.",
    placeholder: "비밀번호",
    inputType: "password",
    confirmText: "확인"
  });

  if (pw === null) return { unlocked: false, cancelled: true };
  if (!pw) return { unlocked: false, cancelled: false };
  const hashed = await sha256Hex(`${post.secretSalt || ""}:${pw}`);
  return { unlocked: hashed === post.secretHash, cancelled: false };
}

async function loadPage() {
  await loadCurrentSiteTitle();

  if (!postId) {
    document.getElementById("viewTitle").textContent = "잘못된 접근";
    return;
  }

  let boardId = params.get("bo") || "board";
  let board = { id: boardId };

  try {
    const postSnap = await getDoc(doc(db, "posts", postId));
    if (!postSnap.exists()) {
      document.getElementById("viewTitle").textContent = "게시물을 찾을 수 없습니다.";
      return;
    }

    const post = { id: postSnap.id, ...postSnap.data() };
    boardId = params.get("bo") || post.boardId || "board";
    board = { id: boardId };
    try {
      const boardSnap = await getDoc(doc(db, "boards", boardId));
      if (boardSnap.exists()) {
        board = { id: boardSnap.id, ...boardSnap.data() };
      }
      document.getElementById("viewNav").innerHTML = `<a href="board.html?bo=${encodeURIComponent(boardId)}">목록으로</a>`;
    } catch (boardError) {
      const permissionDenied = boardError?.code === "permission-denied" || /permission/i.test(boardError?.message || "");
      if (permissionDenied) {
        renderBoardAccessDeniedPage({ title: boardId }, boardId);
        return;
      }
      document.getElementById("viewNav").innerHTML = `<a href="board.html?bo=${encodeURIComponent(boardId)}">목록으로</a>`;
    }

    const auth = await getAuthSnapshot();
    if (isAdminOnlyBoard(board) && !auth?.isAdmin) {
      renderBoardAccessDeniedPage(board, boardId);
      return;
    }

    let skin = await getSkin(findSkinTypeByAlias(boardId));
    try {
      skin = await getSkin(board);
    } catch (_error) {
      // keep the alias skin fallback
    }
    applyViewWidth(board, skin);
    if (skin?.type === "PAGE") {
      await renderTopNav(document.getElementById("viewNav"));
    }
    const skinEditor = await resolveAvailableSkinEditor(auth, post, board, skin, boardId);
    renderAdminTools(auth, post, boardId, skinEditor);
    const secretAccess = await unlockSecretIfNeeded(post, auth.isAdmin);
    const secretUnlocked = secretAccess.unlocked;
    if (post.isSecret && secretAccess.cancelled) {
      location.replace(`board.html?bo=${encodeURIComponent(boardId)}`);
      return;
    }
    const skinData = getPostSkinData(post);
    const profileData = skinData.profile || {};

    const title = post.title || profileData.nameKo || skinData.logNo || post.logNo || post.contentText || "(제목 없음)";
    const detailCaps = skin?.capabilities?.detail || {};
    setDocumentTitle(title);
    document.getElementById("viewTitle").textContent = title;
    const boardLabel = board.title || board.name || boardId;
    document.getElementById("viewMeta").innerHTML = `
      <span class="view-meta-date">${escapeHtml(dateToString(post.createdAt) || "날짜 없음")}</span>
      <span class="view-meta-dot">·</span>
      <a class="view-meta-board" href="board.html?bo=${encodeURIComponent(boardId)}">${escapeHtml(boardLabel)}</a>
    `;

    const tags = (post.tags || []).map((tag) => `<a class="tag" href="search.html?tag=${encodeURIComponent(tag)}">${escapeHtml(tag)}</a>`).join("");
    document.getElementById("viewTags").innerHTML = tags;

    if (typeof skin?.renderDetail === "function") {
      const detail = await skin.renderDetail(post, board, { secretUnlocked, isAdmin: auth.isAdmin });
      renderSkinDetailResult(detail, skinData);
    } else {
      const cover = getPostCoverMedia(post);
      const hideLogCover = skin?.type === "LOG" && post.isSecret && !secretUnlocked;
      document.getElementById("viewImage").innerHTML = detailCaps.showThumbnail && !hideLogCover
        ? (cover.mode === "video" && cover.embedHtml
          ? `<div class="view-video">${renderPostVideoFrame(cover.embedHtml)}</div>`
          : cover.imageUrl
            ? `<img src="${escapeHtml(cover.imageUrl)}" alt="${escapeHtml(title)}" class="view-image">`
            : "")
        : (hideLogCover
          ? `<div class="notice secret-cover-lock" aria-label="비밀글 잠금">${renderLockIcon("secret-cover-lock-icon")}</div>`
          : "");

      document.getElementById("viewSource").textContent = skinData.source ? `출처: ${skinData.source}` : "";

      if (!secretUnlocked) {
        document.getElementById("viewContent").innerHTML = '<div class="notice">비밀번호가 일치하지 않아 내용을 표시할 수 없습니다.</div>';
      } else {
        const body = post.contentHtml || post.commentHtml || post.contentText || "";
        const extraImageAlign = skin?.type === "BOARD" ? (skinData.extraImageAlign || "left") : "left";
        const inlineAttachments = renderInlineAttachments(post.extraAttachments || [], extraImageAlign);
        const attachmentLinks = renderAttachmentLinks(post.extraAttachments || []);
        document.getElementById("viewContent").innerHTML =
          `<div class="view-content-body">${sanitizeHTML(body, { allowIframes: true })}</div>${inlineAttachments}${attachmentLinks}`;
      }
    }

    if (typeof skin?.bindDetail === "function") {
      await skin.bindDetail({
        post,
        board,
        container: document.getElementById("viewContent"),
        secretUnlocked,
        isAdmin: auth.isAdmin
      });
    }

    const showComments = Boolean(detailCaps.supportsComments);
    const commentWrap = document.getElementById("viewCommentsWrap");
    if (!showComments) {
      commentWrap.classList.add("hidden");
    } else {
      await loadComments(post.id, document.getElementById("viewComments"), {
        boardId,
        commentScope: board.commentScope || "all"
      });
    }
  } catch (error) {
    console.error("Failed to load view page:", error);
    const permissionDenied = error?.code === "permission-denied" || /permission/i.test(error?.message || "");
    if (permissionDenied) {
      try {
        const auth = await getAuthSnapshot();
        const boardSnap = await getDoc(doc(db, "boards", boardId));
        const boardData = boardSnap.exists() ? { id: boardSnap.id, ...boardSnap.data() } : board;
        if (isAdminOnlyBoard(boardData) && !auth?.isAdmin) {
          renderBoardAccessDeniedPage(boardData, boardId);
          return;
        }
      } catch (_boardLookupError) {
        // fall through to the existing private-post message
      }
    }
    document.getElementById("viewTitle").textContent = permissionDenied ? "비공개 게시물입니다." : "오류가 발생했습니다.";
    document.getElementById("viewImage").innerHTML = "";
    document.getElementById("viewSource").textContent = "";
    document.getElementById("viewContent").innerHTML = permissionDenied
      ? `
        <div class="notice">
          <div>비공개 게시물은 관리자만 볼 수 있습니다.</div>
          <div class="mt-sm"><a class="btn" href="admin/login.html">로그인</a></div>
        </div>
      `
      : '<div class="notice">게시물을 불러오는 중 오류가 발생했습니다.</div>';
  }
}

async function resolveAvailableSkinEditor(auth, post, board, skin, boardId) {
  if (!auth?.isAdmin || !skin?.type) return null;
  try {
    const editor = await getSkinEditor(skin.type);
    if (!editor) return null;
    if (typeof editor.canEdit === "function") {
      const canEdit = await editor.canEdit({ post, board, skin, postId: post.id, boardId });
      if (!canEdit) return null;
    }
    return editor;
  } catch (error) {
    console.warn(`Skin editor ${skin.type} is unavailable for this post.`, error);
    return null;
  }
}

function renderAdminTools(auth, post, boardId, skinEditor = null) {
  if (!viewAdminToolsEl) return;

  if (!auth?.isAdmin || !post?.id) {
    viewAdminToolsEl.classList.add("hidden");
    viewAdminToolsEl.innerHTML = "";
    return;
  }

  const editorPath = String(skinEditor?.route || "skin-editor.html").trim();
  const editorLink = skinEditor
    ? `<a class="view-meta-action" href="${escapeHtml(editorPath)}?id=${encodeURIComponent(post.id)}&bo=${encodeURIComponent(boardId)}" aria-label="스킨 데이터 편집">${escapeHtml(skinEditor.label || "데이터 편집")}</a>`
    : "";
  viewAdminToolsEl.classList.remove("hidden");
  viewAdminToolsEl.innerHTML = `
    ${editorLink}
    <a class="view-meta-action" href="write.html?id=${encodeURIComponent(post.id)}&bo=${encodeURIComponent(boardId)}" aria-label="게시물 수정">수정</a>
    <button type="button" class="view-meta-action" id="deleteViewPostBtn" aria-label="게시물 삭제">삭제</button>
  `;

  document.getElementById("deleteViewPostBtn")?.addEventListener("click", async () => {
    const postLabel = post.title || post.contentText || post.id;
    if (!window.confirm(`게시물 "${postLabel}"을 삭제할까요?`)) return;

    try {
      await deletePostsByIds([post.id]);
      location.href = `board.html?bo=${encodeURIComponent(boardId)}`;
    } catch (error) {
      console.error("Failed to delete post from view page:", error);
      window.alert(error.message || "게시물 삭제 중 오류가 발생했습니다.");
    }
  });
}

loadPage();

function escapeJsString(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
}
