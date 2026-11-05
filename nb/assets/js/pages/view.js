// 게시물 상세 + 댓글 — 비밀글은 서버가 비밀번호를 확인한 뒤에만 본문을 준다.
// 스킨 분기: THREAD(좌/우 분할), GALLERY(댓글 없음 · 출처 · 첨부 다운로드),
//            SCRIPT(세션 정보 + 아카이브 뷰어), PROFILE(네임카드 + 상세 패널)
import { runQuery, runMutate, naruErrorMessage } from "../core/naru-client.js";
import { renderHeader, getBoardById, applyBoardWidth, escapeHtml, formatDate, ownerDisplayName } from "../core/site.js";
import { sanitizeHTML } from "../shared/sanitizer.js";
import { loadComments } from "../shared/comments.js";
import { normalizeSkinType } from "../shared/skins.js";
import { renderThreadDetail, bindThreadDetail } from "../skins/thread.js";
import { renderSourceLinks } from "../skins/gallery.js";

async function init() {
  const params = new URLSearchParams(location.search);
  const postId = Number(params.get("id")) || 0;
  const boardId = params.get("bo") || "";

  const boot = await renderHeader();
  const listUrl = `board.html?bo=${encodeURIComponent(boardId)}`;

  // 비밀글: 서버가 거절하면 비밀번호를 물어 다시 요청한다.
  let post = null;
  let password;
  for (;;) {
    try {
      post = await runQuery("board:post", password ? { id: postId, password } : { id: postId });
      break;
    } catch (error) {
      if (error?.details?.secret) {
        const input = window.prompt(error.details.wrong ? "비밀번호가 일치하지 않습니다. 다시 입력하세요." : "비밀글입니다. 비밀번호를 입력하세요.");
        if (input === null) {
          location.href = listUrl;
          return;
        }
        password = input;
        continue;
      }
      if (error?.details?.memberOnly) {
        setText("viewTitle", "회원 공개 글");
        const contentEl = document.getElementById("viewContent");
        if (contentEl) contentEl.innerHTML = '<div class="notice">회원만 볼 수 있는 글입니다. 상단의 login 버튼으로 로그인해 주세요.</div>';
        return;
      }
      setText("viewTitle", "게시물을 찾을 수 없습니다.");
      const contentEl = document.getElementById("viewContent");
      if (contentEl) contentEl.innerHTML = `<div class="notice">${escapeHtml(naruErrorMessage(error, "게시물을 찾을 수 없습니다."))}</div>`;
      return;
    }
  }

  const board = getBoardById(boot.boards, post.boardId);
  const skinType = board ? normalizeSkinType(board) : "BOARD";
  applyBoardWidth(board, ""); // 상세 화면: 게시판 가로만 적용, 기본폭·LOG 여백 보정 없음 (원본과 동일)
  document.title = post.title || "게시물 보기";

  // THREAD 스킨: 좌/우 분할 상세 레이아웃으로 교체
  if (skinType === "THREAD") {
    renderThreadMode(post, board, listUrl);
    return;
  }

  // SCRIPT 스킨: 세션 정보(hero) + 아카이브 뷰어, 댓글 없음
  const scriptSkin = skinType === "SCRIPT"
    ? await import("../skins/script.js")
    : null;
  if (scriptSkin) document.body.classList.add("script-view-page");

  // PROFILE 스킨: 전신 이미지 + 네임카드 + 외형/성격/기타 패널, 댓글·태그줄 없음
  const profileSkin = skinType === "PROFILE"
    ? await import("../skins/profile.js")
    : null;

  setText("viewTitle", post.title || (post.logNo ? String(post.logNo) : "(제목 없음)"));
  const author = post.isOwnerPost ? ownerDisplayName() : (post.nickname || "익명");
  setText("viewMeta", `${board?.title || post.boardId} · ${author} · ${formatDate(post.createdAt)}${post.memberOnly ? " · 회원 공개" : ""}`);

  // 태그 — PROFILE은 네임카드 안에 표시하므로 상단 태그줄 생략
  const tagsEl = document.getElementById("viewTags");
  if (tagsEl && !profileSkin && Array.isArray(post.tags) && post.tags.length) {
    tagsEl.innerHTML = post.tags
      .map((tag) => `<a class="tag" href="search.html?tag=${encodeURIComponent(tag)}">${escapeHtml(tag)}</a>`)
      .join("");
  }

  // 수정·삭제 — 관리자 또는 작성자 본인 (서버가 다시 한 번 확인한다)
  const toolsEl = document.getElementById("viewAdminTools");
  if (toolsEl && post.editable) {
    toolsEl.classList.remove("hidden");
    toolsEl.innerHTML = `
      <a class="text-action" href="write.html?id=${encodeURIComponent(post.id)}&bo=${encodeURIComponent(post.boardId)}" title="수정">E</a>
      <button type="button" class="text-action danger" id="deletePostBtn" title="삭제">D</button>
    `;
    document.getElementById("deletePostBtn")?.addEventListener("click", async () => {
      if (!window.confirm(`게시물 "${post.title || post.id}"을 삭제할까요?`)) return;
      try {
        await runMutate("post:remove", { id: post.id });
        location.href = listUrl;
      } catch (error) {
        window.alert(naruErrorMessage(error, "삭제에 실패했습니다."));
      }
    });
  }

  // 대표 이미지 (클릭 = 라이트박스) — SCRIPT는 세션 정보(hero), PROFILE은 네임카드로 대체
  const imageEl = document.getElementById("viewImage");
  if (imageEl && scriptSkin) {
    imageEl.innerHTML = scriptSkin.renderScriptHero(post);
  } else if (imageEl && profileSkin) {
    imageEl.innerHTML = profileSkin.renderProfileHero(post);
  } else if (imageEl && post.thumb) {
    imageEl.innerHTML = `
      <button type="button" class="view-image-button" onclick="openLightbox('${escapeJsString(post.thumb)}')" aria-label="원본 이미지 보기">
        <img class="view-image" src="${escapeHtml(post.thumb)}" alt="${escapeHtml(post.title || "")}">
      </button>
    `;
  }

  // 본문 + 추가 이미지 — SCRIPT는 아카이브 뷰어, PROFILE은 상세 패널로 대체
  const contentEl = document.getElementById("viewContent");
  if (contentEl && scriptSkin) {
    contentEl.innerHTML = scriptSkin.renderScriptReader(post);
  } else if (contentEl && profileSkin) {
    contentEl.innerHTML = profileSkin.renderProfilePanels(post);
  } else if (contentEl) {
    const imagesHtml = Array.isArray(post.images) && post.images.length
      ? `<div class="view-images">${post.images.map((url) => `
          <button type="button" class="view-inline-image" onclick="openLightbox('${escapeJsString(url)}')" aria-label="원본 이미지 보기">
            <img src="${escapeHtml(url)}" alt="" loading="lazy">
          </button>`).join("")}</div>`
      : "";
    contentEl.innerHTML = `
      <div class="view-body">${sanitizeHTML(String(post.body || "").replace(/\n/g, "<br>"), { allowIframes: true })}</div>
      ${imagesHtml}
    `;
  }

  // 추가 첨부 — 상세 하단 다운로드 링크 (갤러리 기획)
  const attachmentsEl = document.getElementById("viewAttachments");
  if (attachmentsEl && Array.isArray(post.attachments) && post.attachments.length) {
    attachmentsEl.innerHTML = `
      <div class="view-attachments">
        <div class="muted small">첨부 ${post.attachments.length}개</div>
        ${post.attachments.map((item, index) => `
          <a class="view-attachment-link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" download>
            ${escapeHtml(item.name || `첨부 ${index + 1}`)}
          </a>
        `).join("")}
      </div>
    `;
  }

  // 출처
  if (post.source) {
    const sourceEl = document.getElementById("viewSource");
    if (sourceEl && skinType === "GALLERY") {
      // 갤러리 목록 카드와 같은 [라벨]URL 표시
      sourceEl.innerHTML = `출처 ${renderSourceLinks(post.source)}`;
    } else if (sourceEl) {
      const url = getHttpUrl(post.source);
      sourceEl.innerHTML = url
        ? `출처 <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`
        : `출처 ${escapeHtml(post.source)}`;
    }
  }

  // 댓글 — GALLERY·SCRIPT·PROFILE 스킨은 댓글 없음
  const commentsWrap = document.getElementById("viewCommentsWrap");
  if (skinType === "GALLERY" || scriptSkin || profileSkin) {
    commentsWrap?.classList.add("hidden");
  } else {
    const commentsEl = document.getElementById("viewComments");
    if (commentsEl) await loadComments(post.id, commentsEl, {});
  }

  // SCRIPT: 아카이브 로드 (메시지 300개씩)
  if (scriptSkin && contentEl) await scriptSkin.bindScriptViewer(contentEl, post);
}

function renderThreadMode(post, board, listUrl) {
  document.body.classList.add("thread-view-page");
  const main = document.querySelector("main.container");
  if (!main) return;

  const toolsHtml = post.editable
    ? `
      <a class="text-action" href="write.html?id=${encodeURIComponent(post.id)}&bo=${encodeURIComponent(post.boardId)}" title="수정">E</a>
      <button type="button" class="text-action danger" id="deletePostBtn" title="삭제">D</button>
    `
    : "";
  main.innerHTML = renderThreadDetail(post, board, { listUrl, toolsHtml });

  document.getElementById("deletePostBtn")?.addEventListener("click", async () => {
    if (!window.confirm(`게시물 "${post.title || post.id}"을 삭제할까요?`)) return;
    try {
      await runMutate("post:remove", { id: post.id });
      location.href = listUrl;
    } catch (error) {
      window.alert(naruErrorMessage(error, "삭제에 실패했습니다."));
    }
  });

  bindThreadDetail(main, board);
  const commentsEl = main.querySelector("#threadComments");
  if (commentsEl) {
    loadComments(post.id, commentsEl, { dateFirstHeader: true, allowImages: true });
  }
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function getHttpUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function escapeJsString(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

init();
