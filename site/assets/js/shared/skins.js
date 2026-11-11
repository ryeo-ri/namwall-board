// NAMWALL Edition Copyright (c) 2026 NAMWALL — MPL-2.0 (https://mozilla.org/MPL/2.0/)
// 스킨 — BOARD(한 줄 목록) · GUESTBOOK(방명록)
import { runMutate, naruErrorMessage } from "../core/naru-client.js";
import { promptNickname, escapeHtml, formatDate, formatDateTime, ownerDisplayName } from "../core/site.js";
import { renderPlainHtml } from "./rich-text.js";
import { renderLockIcon, showNotice } from "./ui.js";
import { bindReveal, loadComments } from "./comments.js";

// BOARD: 제목 + 작성자·날짜 한 줄 목록. 관리자 모드에서는 선택 체크박스와 수정·삭제
export function renderBoardList(posts, board, opts = {}) {
  if (!posts.length) return '<div class="notice">게시물이 없습니다.</div>';
  return `
    <div class="board-list board-line-list">
      ${posts.map((post) => {
        const title = escapeHtml(post.title || "(제목 없음)");
        const url = `view.html?id=${encodeURIComponent(post.id)}&bo=${encodeURIComponent(board.id)}`;
        const count = post.commentCount > 0 ? ` <span class="muted small">[${post.commentCount}]</span>` : "";
        const author = post.isOwnerPost ? "" : `<span class="muted small">${escapeHtml(post.nickname || "익명")}</span> `;
        const check = opts.selectable
          ? `<label class="gallery-delete-check"><input type="checkbox" data-post-select="${post.id}" aria-label="선택"></label>`
          : "";
        const manage = (opts.showManage && post.editable)
          ? ` <a class="gallery-manage-button gallery-edit-button" href="write.html?id=${encodeURIComponent(post.id)}&bo=${encodeURIComponent(board.id)}" aria-label="게시물 수정">수정</a> <button type="button" class="gallery-manage-button gallery-delete-button" data-del-post="${post.id}" aria-label="게시물 삭제">삭제</button>`
          : "";
        return `
          <article class="search-item board-line-item" data-post-id="${post.id}">
            ${check}
            <a href="${url}" class="board-line-title">${post.isSecret ? renderLockIcon("board-line-lock-icon") : ""}${title}${count}</a>
            <span class="board-line-date">${author}${escapeHtml(formatDate(post.createdAt))}${manage}</span>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

// GUESTBOOK: 작성 폼 + 항목 목록. 로그인하면 이름 칸 생략, 비밀번호 칸은 SECRET 체크 시에만
export function renderGuestbook(entries, board, boot) {
  const signedIn = Boolean(boot.owner || boot.me);
  const identityFields = signedIn
    ? ""
    : `
        <input class="gb-name" type="text" placeholder="NAME *" maxlength="40" required>
        <input class="gb-pass hidden" type="password" placeholder="PASSWORD" maxlength="64">
      `;
  const formHtml = board?.options?.memberComment === true && !signedIn
    ? '<div class="notice small guestbook-member-only">로그인한 회원만 방명록을 쓸 수 있습니다.</div>'
    : `
    <form class="guestbook-form card" autocomplete="off" data-as-member="${signedIn ? "1" : ""}">
      <textarea class="guestbook-input gb-message" rows="3" placeholder="방명록 내용을 입력하세요" required></textarea>
      <div class="guestbook-form-row">
        <label class="guestbook-secret-toggle"><input type="checkbox" class="gb-secret"> SECRET</label>
        ${identityFields}
        <button type="submit" class="btn primary gb-enter">ENTER</button>
      </div>
      <div class="gb-msg notice small hidden"></div>
    </form>
  `;

  const listHtml = entries.length
    ? entries.map((entry) => renderGuestbookEntry(entry)).join("")
    : '<div class="notice guestbook-empty">아직 방명록이 없습니다. 첫 방명록을 남겨보세요!</div>';

  return `<div class="guestbook">${formHtml}<div class="guestbook-list">${listHtml}</div></div>`;
}

function renderGuestbookEntry(entry) {
  // 내용을 볼 수 있는 항목에만 '댓글 N ▼' — 처음 펼칠 때 댓글을 불러온다
  const commentsHtml = entry.body != null
    ? `
      <details class="guestbook-comments" data-gb-comments="${entry.id}">
        <summary class="guestbook-comments-summary">댓글 <span data-gb-comment-count>${Number(entry.commentCount) || 0}</span> <span class="guestbook-comments-caret">▼</span></summary>
        <div class="comments-section"></div>
      </details>
    `
    : "";
  const name = entry.isOwnerEntry ? ownerDisplayName() : (entry.name || "익명");
  const deleteBtn = (entry.deletable || entry.hasPassword)
    ? `<button type="button" class="guestbook-delete" data-gb-delete="${entry.id}" data-ask-pass="${entry.deletable ? "" : "1"}" title="삭제">D</button>`
    : "";
  const lockLabel = (text) => `<span class="guestbook-secret-label">${renderLockIcon("guestbook-secret-lock-icon")} ${text}</span>`;

  let bodyHtml;
  if (entry.body != null) {
    bodyHtml = `<div class="guestbook-body">${renderPlainHtml(entry.body)}</div>`;
  } else if (entry.hasPassword) {
    bodyHtml = `
      <div class="guestbook-secret" data-reveal-box="${entry.id}">
        ${lockLabel("비밀글입니다")}
        <span class="guestbook-secret-unlock">
          <input type="password" class="guestbook-secret-input" placeholder="비밀번호">
          <button type="button" class="btn guestbook-secret-submit" data-reveal="${entry.id}" data-reveal-kind="board:guestbookReveal" data-reveal-class="guestbook-body">확인</button>
        </span>
        <span class="guestbook-secret-error small hidden"></span>
      </div>
    `;
  } else {
    bodyHtml = `<div class="guestbook-secret">${lockLabel("비밀글입니다 (작성자·관리자만)")}</div>`;
  }

  return `
    <article class="guestbook-item card" data-entry-id="${entry.id}">
      <div class="guestbook-item-head">
        <strong class="guestbook-author">${escapeHtml(name)}</strong>
        <span class="guestbook-item-right">
          <span class="guestbook-date">${escapeHtml(formatDateTime(entry.createdAt))}</span>
          ${deleteBtn}
        </span>
      </div>
      ${bodyHtml}
      ${commentsHtml}
    </article>
  `;
}

export function bindGuestbook(root, board, reload) {
  const form = root.querySelector(".guestbook-form");
  if (form) {
    const msgEl = form.querySelector(".gb-msg");
    const secretBox = form.querySelector(".gb-secret");
    const passInput = form.querySelector(".gb-pass");
    secretBox?.addEventListener("change", () => {
      passInput?.classList.toggle("hidden", !secretBox.checked);
      if (!secretBox.checked && passInput) passInput.value = "";
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const body = form.querySelector(".gb-message")?.value.trim() || "";
      const isSecret = Boolean(secretBox?.checked);
      if (!body) return showNotice(msgEl, "내용을 입력해 주세요.");

      const payload = { board: board.id, body, secret: isSecret };
      if (!form.dataset.asMember) {
        payload.name = form.querySelector(".gb-name")?.value.trim() || "";
        payload.password = passInput?.value || "";
        if (!payload.name) return showNotice(msgEl, "이름을 입력해 주세요.");
        if (isSecret && !payload.password) return showNotice(msgEl, "비밀글은 비밀번호를 입력하세요.");
      }
      try {
        await runMutate("guestbook:add", payload);
        await reload();
      } catch (error) {
        if (error?.details?.needProfile) {
          await promptNickname("방명록을 쓰려면 닉네임이 필요합니다. 사용할 닉네임을 입력하세요.");
          return;
        }
        showNotice(msgEl, naruErrorMessage(error, "저장에 실패했습니다."));
      }
    });
  }

  bindReveal(root);

  // 항목별 댓글 — 처음 펼칠 때 불러오고, 다 불러온 뒤 '댓글 N'을 실제 개수로 맞춘다
  root.querySelectorAll("[data-gb-comments]").forEach((details) => {
    const id = Number(details.dataset.gbComments);
    const section = details.querySelector(".comments-section");
    const countEl = details.querySelector("[data-gb-comment-count]");
    let loaded = false;
    details.addEventListener("toggle", () => {
      if (!details.open || loaded) return;
      loaded = true;
      loadComments(id, section, {
        guestbook: true,
        allowReplies: true,
        memberOnly: board?.options?.memberComment === true,
        onRendered: (container) => {
          const more = !container.querySelector(".comment-pagination")?.classList.contains("hidden");
          if (!more && countEl) countEl.textContent = String(container.querySelectorAll(".comment-item").length);
        }
      });
    });
  });

  // 삭제 — 관리자·작성자는 확인 후 바로, 게스트 글은 비밀번호
  root.querySelectorAll("[data-gb-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = Number(button.dataset.gbDelete);
      let password;
      if (button.dataset.askPass === "1") {
        password = window.prompt("비밀번호를 입력하세요.");
        if (password === null) return;
      } else if (!window.confirm("이 방명록을 삭제할까요?")) {
        return;
      }
      try {
        await runMutate("guestbook:remove", password != null ? { id, password } : { id });
        await reload();
      } catch (error) {
        window.alert(naruErrorMessage(error, "삭제에 실패했습니다."));
      }
    });
  });
}
