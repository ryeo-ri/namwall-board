import { sanitizeHTML } from "../../shared/html-sanitizer-v2.js";
import { loadComments } from "../../shared/comments.js";
import { renderLockIcon } from "../../shared/secret-icon.js";
import { createGuestbookEntry } from "../../shared/guest-post.js";
import { deletePostsByIds } from "../../shared/post-maintenance.js";
import { isGuestCooldownPassed, touchGuestCooldown, sha256Hex } from "../../core/state.js";

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text == null ? "" : String(text);
  return div.innerHTML;
}

function formatDateTime(createdAt) {
  const d = createdAt?.toDate ? createdAt.toDate() : (createdAt ? new Date(createdAt) : null);
  if (!d || Number.isNaN(d.getTime())) return "";
  return `${d.toLocaleDateString("ko-KR")} ${d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`;
}

function getEntryBody(post) {
  const raw = post.commentHtml || post.contentHtml || post.contentText || "";
  return sanitizeHTML(raw, { allowIframes: false });
}

function canGuestWrite(board) {
  return board?.allowGuestPost === true;
}

function renderForm(board, { isAdmin }) {
  // 방명록은 항상 "누구나" 모드 — 실제 허용 여부는 게시판의 "게스트 허용"으로만 제어
  if (!isAdmin && !canGuestWrite(board)) {
    return `<div class="guestbook-form-note notice">관리자만 방명록을 남길 수 있습니다.</div>`;
  }
  return `
    <form class="guestbook-form card" autocomplete="off">
      <textarea class="guestbook-input" rows="3" placeholder="방명록 내용을 입력하세요"></textarea>
      <div class="guestbook-form-row">
        <label class="guestbook-secret-toggle"><input type="checkbox" class="gb-secret"> SECRET</label>
        <input class="gb-name" type="text" placeholder="NAME *" maxlength="40" required>
        <input class="gb-pass hidden" type="password" placeholder="PASSWORD" maxlength="40">
        <input class="gb-hp" type="text" tabindex="-1" autocomplete="off" aria-hidden="true">
        <button type="submit" class="btn primary gb-enter">ENTER</button>
      </div>
      <div class="guestbook-form-msg notice hidden"></div>
    </form>
  `;
}

function renderEntry(post, { isAdmin, unlockedSecretPostIds }) {
  const id = escapeHtml(post.id);
  const author = escapeHtml(post.authorName || "익명");
  const dateStr = escapeHtml(formatDateTime(post.createdAt));
  const isSecret = post.isSecret === true;
  const unlocked = isAdmin || unlockedSecretPostIds.has(post.id);
  const body = getEntryBody(post);

  const deleteBtn = isAdmin
    ? `<button type="button" class="guestbook-delete" data-gb-delete="${id}">삭제</button>`
    : "";

  const bodyBlock = (isSecret && !unlocked)
    ? `
      <div class="guestbook-secret" data-gb-secret="${id}">
        <span class="guestbook-secret-label">${renderLockIcon("guestbook-secret-lock-icon")} 비밀글입니다</span>
        <span class="guestbook-secret-unlock">
          <input type="password" class="guestbook-secret-input" placeholder="비밀번호">
          <button type="button" class="btn guestbook-secret-submit" data-gb-secret-submit="${id}">확인</button>
        </span>
        <span class="guestbook-secret-error hidden"></span>
      </div>
      <div class="guestbook-body hidden" data-gb-body="${id}">${body}</div>
    `
    : `<div class="guestbook-body" data-gb-body="${id}">${body}</div>`;

  return `
    <article class="guestbook-item card" data-post-id="${id}">
      <div class="guestbook-item-head">
        <span class="guestbook-author">${author}</span>
        <span class="guestbook-item-right">
          <span class="guestbook-date">${dateStr}</span>
          ${deleteBtn}
        </span>
      </div>
      ${bodyBlock}
      <details class="guestbook-comments">
        <summary class="guestbook-comments-summary">댓글 <span class="guestbook-comments-caret">▼</span></summary>
        <div id="comments-${id}" class="comments-section"></div>
      </details>
    </article>
  `;
}

export async function renderGuestbook(posts, board, options = {}) {
  const isAdmin = Boolean(options.isAdmin);
  const unlockedSecretPostIds = new Set(options.unlockedSecretPostIds || []);

  const formHtml = renderForm(board, { isAdmin });
  const listHtml = posts.length
    ? posts.map((post) => renderEntry(post, { isAdmin, unlockedSecretPostIds })).join("")
    : `<div class="notice guestbook-empty">아직 방명록이 없습니다. 첫 방명록을 남겨보세요!</div>`;

  const html = `
    <div class="guestbook">
      ${formHtml}
      <div class="guestbook-list">${listHtml}</div>
    </div>
  `;

  setTimeout(() => {
    const root = document.querySelector(".guestbook");
    if (!root) return;
    bindForm(root, board, { isAdmin });
    if (isAdmin) bindAdminDelete(root);
    bindSecretUnlock(root, posts);

    // 항목별 댓글 (log 스킨과 동일 패턴)
    Promise.all(posts.map((post) => {
      const container = document.getElementById(`comments-${post.id}`);
      if (!container) return null;
      return loadComments(post.id, container, {
        boardId: board?.id || "",
        commentScope: board?.commentScope || "all",
        manageComments: isAdmin
      }).then(() => {
        const details = container.closest(".guestbook-comments");
        const summary = details?.querySelector(".guestbook-comments-summary");
        const count = container.querySelectorAll(".comment-item").length;
        if (summary) summary.innerHTML = `댓글 ${count} <span class="guestbook-comments-caret">▼</span>`;
      });
    })).catch((error) => console.warn("Failed to load guestbook comments:", error));
  }, 60);

  return html;
}

function bindForm(root, board, { isAdmin }) {
  const form = root.querySelector(".guestbook-form");
  if (!form) return;
  const msgEl = form.querySelector(".guestbook-form-msg");
  const passInput = form.querySelector(".gb-pass");
  const secretToggle = form.querySelector(".gb-secret");
  const showMsg = (text, isError = false) => {
    if (!msgEl) return;
    msgEl.classList.remove("hidden");
    msgEl.classList.toggle("notice-error", isError);
    msgEl.textContent = text;
  };

  // 비밀번호 입력칸은 SECRET 체크 시에만 노출
  secretToggle?.addEventListener("change", () => {
    const on = secretToggle.checked;
    passInput?.classList.toggle("hidden", !on);
    if (!on && passInput) passInput.value = "";
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (form.querySelector(".gb-hp")?.value) return; // 허니팟
    const message = form.querySelector(".guestbook-input")?.value || "";
    const authorName = form.querySelector(".gb-name")?.value || "";
    const password = passInput?.value || "";
    const isSecret = Boolean(secretToggle?.checked);

    if (!authorName.trim()) return showMsg("이름을 입력해 주세요.", true);
    if (!message.trim()) return showMsg("내용을 입력해 주세요.", true);
    if (isSecret && !password) return showMsg("비밀글은 비밀번호를 입력하세요.", true);

    if (!isAdmin && !canGuestWrite(board)) {
      return showMsg("관리자만 방명록을 남길 수 있습니다.", true);
    }
    if (!isAdmin && !isGuestCooldownPassed(30)) {
      return showMsg("작성은 30초 후에 다시 가능합니다.", true);
    }

    const submitBtn = form.querySelector(".gb-enter");
    if (submitBtn) submitBtn.disabled = true;
    try {
      await createGuestbookEntry({
        boardId: board?.id || "",
        message,
        authorName,
        isSecret,
        password,
        isAdmin,
        open: true
      });
      if (!isAdmin) touchGuestCooldown();
      location.reload();
    } catch (error) {
      console.error("Failed to create guestbook entry:", error);
      showMsg(error?.message || "저장에 실패했습니다.", true);
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

function bindAdminDelete(root) {
  root.querySelectorAll("[data-gb-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.gbDelete;
      if (!id) return;
      if (!window.confirm("이 방명록을 삭제할까요?")) return;
      btn.disabled = true;
      try {
        await deletePostsByIds([id]);
        location.reload();
      } catch (error) {
        console.error("Failed to delete guestbook entry:", error);
        window.alert("삭제에 실패했습니다.");
        btn.disabled = false;
      }
    });
  });
}

function bindSecretUnlock(root, posts) {
  const postsById = new Map(posts.map((post) => [post.id, post]));
  root.querySelectorAll("[data-gb-secret]").forEach((box) => {
    const id = box.dataset.gbSecret;
    const post = postsById.get(id);
    const input = box.querySelector(".guestbook-secret-input");
    const submit = box.querySelector(".guestbook-secret-submit");
    const errorEl = box.querySelector(".guestbook-secret-error");
    const bodyEl = root.querySelector(`.guestbook-body[data-gb-body="${CSS.escape(id)}"]`);

    const tryUnlock = async () => {
      const pw = input?.value || "";
      if (!pw) return;
      const salt = String(post?.secretSalt || "");
      const expected = String(post?.secretHash || "");
      const hashed = await sha256Hex(`${salt}:${pw}`);
      if (hashed === expected) {
        box.remove();
        bodyEl?.classList.remove("hidden");
      } else if (errorEl) {
        errorEl.textContent = "비밀번호가 일치하지 않습니다.";
        errorEl.classList.remove("hidden");
      }
    };

    submit?.addEventListener("click", tryUnlock);
    input?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); tryUnlock(); }
    });
  });
}
