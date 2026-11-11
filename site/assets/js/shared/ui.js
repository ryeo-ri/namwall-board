// NAMWALL Edition Copyright (c) 2026 NAMWALL — MPL-2.0 (https://mozilla.org/MPL/2.0/)
// 화면 공용 조각 — 입력칸·알림 헬퍼, 잠금 아이콘, 관리자 모드 줄, 비밀번호 열람, 이미지 받기
import { naruErrorMessage } from "../core/naru-client.js";
import { escapeHtml } from "../core/site.js";

export const getValue = (id) => document.getElementById(id)?.value || "";
export const isChecked = (id) => document.getElementById(id)?.checked === true;

export function setValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value ?? "";
}

export function setChecked(id, value) {
  const el = document.getElementById(id);
  if (el) el.checked = Boolean(value);
}

export function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

// el: 요소 또는 id
export function showNotice(el, text, isError = false) {
  const target = typeof el === "string" ? document.getElementById(el) : el;
  if (!target) return;
  target.textContent = text;
  target.classList.remove("hidden");
  target.classList.toggle("notice-error", isError);
}

export function renderLockIcon(className = "") {
  return `<svg viewBox="0 0 24 24" class="secret-lock-icon${className ? ` ${className}` : ""}" role="img" aria-label="비밀글" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 11V8a4 4 0 1 1 8 0v3"></path><rect x="5" y="11" width="14" height="9" rx="2"></rect></svg>`;
}

// 목록 관리자 모드 줄: 선택 체크박스 · 라벨(날짜 등) · 수정/삭제. 삭제는 board.js가 [data-del-post]로 처리한다.
export function renderManageBar(post, board, { selectable = false, canManage = false, label = "", noun = "게시물" } = {}) {
  if (!selectable && !canManage) return "";
  const editUrl = `write.html?id=${encodeURIComponent(post.id)}&bo=${encodeURIComponent(board?.id || "")}`;
  return `
    <div class="gallery-delete-topbar">
      <div class="gallery-delete-left">
        ${selectable ? `<label class="gallery-delete-check"><input type="checkbox" data-post-select="${post.id}" aria-label="선택"></label>` : ""}
        <span class="gallery-delete-date">${escapeHtml(label)}</span>
      </div>
      ${canManage ? `
        <div class="gallery-manage-actions">
          <a class="gallery-manage-button gallery-edit-button" href="${editUrl}" aria-label="${noun} 수정">수정</a>
          <button type="button" class="gallery-manage-button gallery-delete-button" data-del-post="${post.id}" aria-label="${noun} 삭제">삭제</button>
        </div>` : ""}
    </div>
  `;
}

// 비밀번호 칸 + 확인 버튼: 클릭·Enter로 onSubmit(비밀번호), 실패하면 errorEl에 메시지
export function bindPasswordPrompt(button, input, errorEl, onSubmit) {
  const run = async () => {
    try {
      await onSubmit(input?.value || "");
    } catch (error) {
      if (!errorEl) return;
      errorEl.textContent = naruErrorMessage(error, "열람에 실패했습니다.");
      errorEl.classList.remove("hidden");
    }
  };
  button.addEventListener("click", run);
  input?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); run(); }
  });
}

// 이미지 파일 받기 — 버튼(과 clickZone이면 드롭존) 클릭, 드래그 앤 드롭, 드롭존에 붙여넣기
export function bindImagePicker({ button, input, dropZone, clickZone = false }, onFiles) {
  const deliver = (files) => {
    const images = Array.from(files || []).filter((file) => /^image\//i.test(file?.type || ""));
    if (images.length) onFiles(images);
    return images.length > 0;
  };
  button?.addEventListener("click", () => input?.click());
  input?.addEventListener("change", () => {
    deliver(input.files);
    input.value = "";
  });
  if (!dropZone) return;
  if (clickZone) {
    dropZone.addEventListener("click", (event) => {
      if (!event.target.closest("button, input")) input?.click();
    });
  }
  dropZone.addEventListener("dragover", (event) => event.preventDefault());
  dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    deliver(event.dataTransfer?.files);
  });
  dropZone.addEventListener("paste", (event) => {
    if (deliver(event.clipboardData?.files)) event.preventDefault();
  });
}
