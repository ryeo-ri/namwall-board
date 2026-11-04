// 스킨 — BOARD(목록형) · GUESTBOOK(방명록) 렌더러 (원본 남월보드 마크업)
import { runMutate, naruErrorMessage } from "../core/naru-client.js";
import { promptNickname, escapeHtml, formatDate, formatDateTime, ownerDisplayName } from "../core/site.js";
import { sanitizeHTML } from "./sanitizer.js";
import { renderLockIcon } from "./secret-icon.js";
import { bindReveal } from "./comments.js";

export function normalizeSkinType(board) {
  return String(board?.skinType || "BOARD").trim().toUpperCase();
}

/* ── BOARD: 제목 + 날짜 한 줄 목록 (원본 board-line-list) ───────── */

export function renderBoardList(posts, board, opts = {}) {
  if (!posts.length) return '<div class="notice">게시물이 없습니다.</div>';
  return `
    <div class="board-list board-line-list">
      ${posts.map((post) => {
        const title = escapeHtml(post.title || "(제목 없음)");
        const url = `view.html?id=${encodeURIComponent(post.id)}&bo=${encodeURIComponent(board.id)}`;
        const count = post.commentCount > 0 ? ` <span class="muted small">[${post.commentCount}]</span>` : "";
        const author = post.isOwnerPost ? "" : `<span class="muted small">${escapeHtml(post.nickname || "익명")}</span> `;
        // 관리자 모드(ADMIN 토글): 체크박스·번호 + 날짜·수정·삭제 — GALLERY와 같은 형식(투명 배경)
        const check = opts.selectable
          ? `<label class="gallery-delete-check"><input type="checkbox" data-post-select="${post.id}" aria-label="선택"></label>`
          : "";
        const no = opts.selectable ? `<span class="gallery-manage-no">${post.id}</span> ` : "";
        const manage = (opts.showManage && post.editable)
          ? ` <a class="gallery-manage-button gallery-edit-button" href="write.html?id=${encodeURIComponent(post.id)}&bo=${encodeURIComponent(board.id)}" aria-label="게시물 수정">수정</a> <button type="button" class="gallery-manage-button gallery-delete-button" data-del-post="${post.id}" aria-label="게시물 삭제">삭제</button>`
          : "";
        return `
          <article class="search-item board-line-item" data-post-id="${post.id}">
            ${check}
            <a href="${url}" class="board-line-title">${post.isSecret ? renderLockIcon("board-line-lock-icon") : ""}${title}${count}</a>
            <span class="board-line-date">${no}${author}${escapeHtml(formatDate(post.createdAt))}${manage}</span>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

/* ── GUESTBOOK: 인라인 작성 폼 + 항목 목록 (원본 guestbook 마크업) ── */

export function renderGuestbook(entries, board, boot) {
  // 로그인(관리자·회원) 시 이름 입력 생략 — 별도 안내 문구 없음
  const identityFields = (boot.owner || boot.me)
    ? ""
    : `
        <input class="gb-name" type="text" placeholder="NAME *" maxlength="40" required>
        <input class="gb-pass" type="password" placeholder="PASSWORD" maxlength="64">
      `;
  const formHtml = `
    <form class="guestbook-form card" autocomplete="off" data-as-member="${boot.owner || boot.me ? "1" : ""}">
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
  const name = entry.isOwnerEntry ? ownerDisplayName() : (entry.name || "익명");
  const deleteBtn = (entry.deletable || entry.hasPassword)
    ? `<button type="button" class="guestbook-delete" data-gb-delete="${entry.id}" data-ask-pass="${entry.deletable ? "" : "1"}" title="삭제">D</button>`
    : "";

  let bodyHtml;
  if (entry.body != null) {
    bodyHtml = `<div class="guestbook-body">${sanitizeHTML(String(entry.body).replace(/\n/g, "<br>"), { allowIframes: false })}</div>`;
  } else if (entry.hasPassword) {
    bodyHtml = `
      <div class="guestbook-secret" data-reveal-box="${entry.id}">
        <span class="guestbook-secret-label">${renderLockIcon("guestbook-secret-lock-icon")} 비밀글입니다</span>
        <span class="guestbook-secret-unlock">
          <input type="password" class="guestbook-secret-input" placeholder="비밀번호">
          <button type="button" class="btn guestbook-secret-submit" data-reveal="${entry.id}" data-reveal-kind="board:guestbookReveal" data-reveal-class="guestbook-body">확인</button>
        </span>
        <span class="guestbook-secret-error small hidden"></span>
      </div>
    `;
  } else {
    bodyHtml = `<div class="guestbook-secret"><span class="guestbook-secret-label">${renderLockIcon("guestbook-secret-lock-icon")} 비밀글입니다 (작성자·관리자만)</span></div>`;
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
    </article>
  `;
}

export function bindGuestbook(root, board, boot, reload) {
  const form = root.querySelector(".guestbook-form");
  if (form) {
    const msgEl = form.querySelector(".gb-msg");
    const showMsg = (text) => {
      if (!msgEl) return;
      msgEl.textContent = text;
      msgEl.classList.remove("hidden");
    };
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const body = form.querySelector(".gb-message")?.value.trim() || "";
      const isSecret = Boolean(form.querySelector(".gb-secret")?.checked);
      if (!body) return showMsg("내용을 입력해 주세요.");

      const payload = { board: board.id, body, secret: isSecret };
      if (!form.dataset.asMember) {
        payload.name = form.querySelector(".gb-name")?.value.trim() || "";
        payload.password = form.querySelector(".gb-pass")?.value || "";
        if (!payload.name) return showMsg("이름을 입력해 주세요.");
        if (isSecret && !payload.password) return showMsg("비밀글은 비밀번호를 입력하세요.");
      }
      try {
        await runMutate("guestbook:add", payload);
        await reload();
      } catch (error) {
        if (error?.details?.needProfile) {
          await promptNickname("방명록을 쓰려면 닉네임이 필요합니다. 사용할 닉네임을 입력하세요.");
          return;
        }
        showMsg(naruErrorMessage(error, "저장에 실패했습니다."));
      }
    });
  }

  // 게스트 비밀글 열람 (서버 확인 후 그 자리에서 교체)
  bindReveal(root);

  // 삭제 — 관리자·작성자는 바로, 게스트 글은 비밀번호 확인
  root.querySelectorAll("[data-gb-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = Number(button.dataset.gbDelete);
      const askPass = button.dataset.askPass === "1";
      let password;
      if (askPass) {
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
