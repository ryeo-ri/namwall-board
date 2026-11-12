// NAMWALL Edition Copyright (c) 2026 NAMWALL — MPL-2.0 (https://mozilla.org/MPL/2.0/)
// 관리자 · 게시판 관리 (생성·수정·삭제·메뉴 순서)
import { runMutate, naruErrorMessage } from "../core/naru-client.js";
import { loadBoot, clearSiteCache, escapeHtml, formatResponsiveWidth } from "../core/site.js";
import { getValue, setValue, setText, isChecked as checked, setChecked, showNotice, bindImagePicker } from "../shared/ui.js";

const SKINS = [
  { type: "BOARD", label: "목록형 게시판" },
  { type: "GALLERY", label: "갤러리" },
  { type: "LOG", label: "로그" },
  { type: "THREAD", label: "타래" },
  { type: "SCRIPT", label: "TRPG 로그백업" },
  { type: "GUESTBOOK", label: "방명록" },
  { type: "PROFILE", label: "캐릭터 프로필" },
  { type: "BOOKMARK", label: "북마크" }
];
// 스킨별 옵션 필드
const SKIN_OPTION_FIELDS = {
  BOARD: ["boardWidth"],
  GALLERY: ["boardWidth", "columns"],
  LOG: ["boardWidth", "imageWidth", "commentPosition"],
  THREAD: ["boardWidth", "columns", "commentPosition", "detailThumb"],
  SCRIPT: ["boardWidth", "columns"],
  GUESTBOOK: ["boardWidth"],
  PROFILE: ["columns"],
  BOOKMARK: ["boardWidth", "columns", "introHtml"]
};
// 한 줄 칸 수 라벨·기본값·최대값
const COLUMN_PRESETS = {
  GALLERY: { label: "1줄 게시물 수", placeholder: "기본 4", max: 6 },
  THREAD: { label: "1줄 카드 수", placeholder: "기본 3", max: 4 },
  SCRIPT: { label: "1줄 세션 수", placeholder: "기본 3", max: 6 },
  PROFILE: { label: "1줄 게시물 수", placeholder: "기본 4", max: 6 },
  BOOKMARK: { label: "1줄 배너 수", placeholder: "기본 3", max: 6 }
};
const DRAG_HANDLE_ICON = '<svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true" focusable="false"><g fill="currentColor"><circle cx="2.5" cy="3" r="1.5"/><circle cx="7.5" cy="3" r="1.5"/><circle cx="2.5" cy="8" r="1.5"/><circle cx="7.5" cy="8" r="1.5"/><circle cx="2.5" cy="13" r="1.5"/><circle cx="7.5" cy="13" r="1.5"/></g></svg>';

let admin = null;
let boards = [];
let currentSkin = "BOARD";
let titleImageStaged = null; // { file, previewUrl }
let editorRevision = 0;
let savingBoard = false;
let pendingBoardReorders = 0;
let activeBoardDrag = false;

export async function initBoardsAdmin(adminHandle) {
  admin = adminHandle;
  renderSkinCatalog();
  applySkin("BOARD");
  bindForm();
  bindTitleImage();
  try {
    await refreshBoards();
  } catch (error) {
    showListMsg(naruErrorMessage(error, "게시판 목록을 불러오지 못했습니다."), true);
  }
  updateSummary();

  // ?board=ID — 게시판 페이지의 '게시판수정' 버튼에서 오면 그 게시판 편집을 연다
  const deepLinkBoard = new URLSearchParams(location.search).get("board");
  if (deepLinkBoard) {
    document.querySelector(`#boardsList [data-board-edit="${CSS.escape(deepLinkBoard)}"]`)?.click();
  }
}

function renderSkinCatalog() {
  const listEl = document.getElementById("skinCatalogList");
  if (!listEl) return;
  listEl.innerHTML = SKINS.map((skin) => `
    <button type="button" class="skin-chip" data-skin="${skin.type}">
      <span class="skin-chip-type">${skin.type}</span>
      <span class="skin-chip-folder">${escapeHtml(skin.label)}</span>
    </button>
  `).join("");
  listEl.querySelectorAll("[data-skin]").forEach((button) => {
    button.addEventListener("click", () => {
      applySkin(button.dataset.skin);
      updateSummary();
    });
  });
}

function applySkin(skin) {
  editorRevision += 1;
  currentSkin = SKINS.some((item) => item.type === skin) ? skin : "BOARD";
  document.querySelectorAll("#skinCatalogList .skin-chip").forEach((chip) => {
    chip.classList.toggle("is-active", chip.dataset.skin === currentSkin);
  });
  const fields = SKIN_OPTION_FIELDS[currentSkin] || [];
  const block = document.getElementById("skinOptionsBlock");
  block?.classList.toggle("hidden", fields.length === 0);
  document.querySelectorAll("#skinOptionsFields [data-skin-option]").forEach((el) => {
    el.classList.toggle("hidden", !fields.includes(el.dataset.skinOption));
  });
  const desc = document.getElementById("skinOptionsDesc");
  if (desc) desc.textContent = fields.length ? `${currentSkin} 스킨의 게시판 옵션입니다.` : "";

  // 분류는 방명록·로그 스킨에 없다
  document.getElementById("categoryBlock")?.classList.toggle("hidden", ["GUESTBOOK", "LOG"].includes(currentSkin));

  const columnsPreset = COLUMN_PRESETS[currentSkin];
  const columnsInput = document.getElementById("boardColumnsInput");
  const columnsLabel = document.querySelector('label[for="boardColumnsInput"]');
  if (columnsInput && columnsPreset) {
    columnsInput.placeholder = columnsPreset.placeholder;
    columnsInput.max = String(columnsPreset.max);
    if (columnsLabel) columnsLabel.textContent = `${columnsPreset.label} (1~${columnsPreset.max})`;
  }
  const positionLabel = document.querySelector('label[for="boardCommentPosInput"]');
  if (positionLabel) positionLabel.textContent = currentSkin === "LOG" ? "덧글 위치" : "댓글 위치";

  // 댓글 위치: LOG = 우측(기본)/하단, THREAD = 하단(기본)/좌측
  const positionSelect = document.getElementById("boardCommentPosInput");
  if (positionSelect) {
    const previous = positionSelect.value;
    positionSelect.innerHTML = currentSkin === "LOG"
      ? '<option value="default">우측 (기본)</option><option value="bottom">하단</option>'
      : '<option value="bottom">하단 (기본)</option><option value="left">좌측</option>';
    const allowed = Array.from(positionSelect.options).map((option) => option.value);
    positionSelect.value = allowed.includes(previous) ? previous : allowed[0];
  }
}

// 제목 이미지: URL 직접 입력 또는 파일(저장 시 업로드)
function bindTitleImage() {
  bindImagePicker({
    button: document.getElementById("selectTitleImageBtn"),
    input: document.getElementById("boardTitleImageFile"),
    dropZone: document.getElementById("boardTitleImageDropZone"),
    clickZone: true
  }, ([file]) => {
    if (titleImageStaged) URL.revokeObjectURL(titleImageStaged.previewUrl);
    titleImageStaged = { file, previewUrl: URL.createObjectURL(file) };
    editorRevision += 1;
    renderTitleImagePreview();
  });
  document.getElementById("boardTitleImageInput")?.addEventListener("input", renderTitleImagePreview);
}

function renderTitleImagePreview() {
  const previewEl = document.getElementById("boardTitleImagePreview");
  if (!previewEl) return;
  const url = titleImageStaged?.previewUrl || getValue("boardTitleImageInput").trim();
  previewEl.classList.toggle("hidden", !url);
  previewEl.innerHTML = url
    ? `<div class="previewItem"><img class="previewImage" src="${escapeHtml(url)}" alt="제목 이미지 미리보기">${titleImageStaged ? '<button type="button" class="admin-image-remove" id="clearTitleImageBtn" aria-label="선택 해제">&times;</button>' : ""}</div>`
    : "";
  document.getElementById("clearTitleImageBtn")?.addEventListener("click", () => {
    if (titleImageStaged) URL.revokeObjectURL(titleImageStaged.previewUrl);
    titleImageStaged = null;
    editorRevision += 1;
    renderTitleImagePreview();
  });
}

// 편집 폼 ↔ 요약 패널
function bindForm() {
  const markEdited = () => { editorRevision += 1; };
  const editor = document.getElementById("boardEditorCard");
  editor?.addEventListener("input", markEdited);
  editor?.addEventListener("change", markEdited);
  ["boardIdInput", "boardTitleInput", "menuOrderInput", "pageSizeInput",
   "boardBoardWidthInput", "boardColumnsInput", "boardCommentPosInput", "boardImageWidthInput"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", updateSummary);
  });
  ["menuVisibleInput", "boardAdminOnlyInput", "boardMemberWriteInput", "boardMemberCommentInput", "boardDetailThumbInput"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", updateSummary);
  });

  document.getElementById("autoBoardIdBtn")?.addEventListener("click", () => {
    setValue("boardIdInput", `b${Date.now().toString(36)}`);
    editorRevision += 1;
    updateSummary();
  });

  document.getElementById("resetBoardBtn")?.addEventListener("click", () => resetForm());
  document.getElementById("saveBoardBtn")?.addEventListener("click", save);

  document.getElementById("createBoardBtn")?.addEventListener("click", () => {
    resetForm();
    openEditor("게시판 생성");
  });
  document.getElementById("closeBoardEditorBtn")?.addEventListener("click", closeEditor);
}

function openEditor(title) {
  setText("boardEditorTitle", title);
  document.getElementById("boardMsg")?.classList.add("hidden");
  const card = document.getElementById("boardEditorCard");
  card?.classList.remove("hidden");
  card?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeEditor() {
  document.getElementById("boardEditorCard")?.classList.add("hidden");
}

function updateSummary() {
  const id = getValue("boardIdInput").trim();
  const title = getValue("boardTitleInput").trim();
  setText("boardSummaryTitle", title || "새 게시판");
  setText("boardSummaryId", id || "-");
  setText("boardSummarySkin", currentSkin);
  setText("boardSummaryOrder", getValue("menuOrderInput").trim() || "0");
  setText("boardSummaryPageSize", getValue("pageSizeInput").trim() || "기본");
  setText("boardSummaryBoardWidth", formatResponsiveWidth(getValue("boardBoardWidthInput").trim()) || "기본");
  setText("boardSummaryColumns", getValue("boardColumnsInput").trim() || "-");
  const positionValue = getValue("boardCommentPosInput");
  setText("boardSummaryCommentPosition", positionValue === "left" ? "좌측" : positionValue === "default" ? "우측" : "하단");
  const imageWidth = getValue("boardImageWidthInput").trim();
  setText("boardSummaryImageWidth", imageWidth === "" ? "-" : (imageWidth === "0" ? "제한 없음" : `${imageWidth}px`));

  const chips = [
    { label: "메뉴 노출", on: checked("menuVisibleInput") },
    { label: "관리자 전용", on: checked("boardAdminOnlyInput") },
    { label: "글쓰기 허용", on: checked("boardMemberWriteInput") },
    { label: "덧글 제한", on: checked("boardMemberCommentInput") }
  ];
  const chipsEl = document.getElementById("boardSummaryChips");
  if (chipsEl) {
    chipsEl.innerHTML = chips
      .map((chip) => `<span class="summary-chip ${chip.on ? "is-on" : "is-off"}">${chip.label} ${chip.on ? "ON" : "OFF"}</span>`)
      .join("");
  }
}

function resetForm() {
  editorRevision += 1;
  ["boardIdInput", "boardTitleInput", "boardTitleImageInput", "boardDescInput", "boardCategoriesInput",
   "pageSizeInput", "menuOrderInput", "boardBoardWidthInput", "boardColumnsInput", "boardImageWidthInput",
   "boardIntroHtmlInput"].forEach((id) => setValue(id, ""));
  document.getElementById("boardIdInput").readOnly = false;
  setValue("boardCommentPosInput", "bottom");
  setChecked("boardDetailThumbInput", true);
  setChecked("menuVisibleInput", true);
  setChecked("boardAdminOnlyInput", false);
  setChecked("boardMemberWriteInput", false);
  setChecked("boardMemberCommentInput", false);
  if (titleImageStaged) URL.revokeObjectURL(titleImageStaged.previewUrl);
  titleImageStaged = null;
  renderTitleImagePreview();
  applySkin("BOARD");
  updateSummary();
}

async function save() {
  if (savingBoard) return;
  if (pendingBoardReorders) return showMsg("메뉴 순서 저장이 끝난 뒤 다시 저장해 주세요.", true);
  if (activeBoardDrag) return showMsg("순서 이동을 마친 뒤 저장해 주세요.", true);
  const id = getValue("boardIdInput").trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return showMsg("게시판 ID는 영문·숫자·_- 1~64자입니다.", true);

  const revision = editorRevision;
  const stagedImage = titleImageStaged;
  savingBoard = true;
  updateBoardBusyState();
  try {
    const options = {};
    const fields = SKIN_OPTION_FIELDS[currentSkin] || [];
    if (fields.includes("boardWidth")) {
      const boardWidth = Number(getValue("boardBoardWidthInput").trim());
      if (Number.isFinite(boardWidth) && boardWidth >= 1) options.boardWidth = Math.round(boardWidth);
    }
    if (fields.includes("columns")) {
      const maxColumns = COLUMN_PRESETS[currentSkin]?.max || 4;
      const columns = Number(getValue("boardColumnsInput"));
      if (columns >= 1 && columns <= maxColumns) options.galleryColumns = columns;
    }
    if (fields.includes("commentPosition")) {
      const position = getValue("boardCommentPosInput");
      if (position === "left" || (currentSkin === "LOG" && position === "bottom")) {
        options.commentPosition = position;
      }
      // 기본값(LOG 우측, THREAD 하단)은 저장하지 않는다
    }
    if (fields.includes("detailThumb") && !checked("boardDetailThumbInput")) {
      options.detailThumb = false;
    }
    if (fields.includes("imageWidth")) {
      const imageWidthRaw = getValue("boardImageWidthInput").trim();
      if (imageWidthRaw !== "") options.imageWidth = Number(imageWidthRaw);
    }
    if (fields.includes("introHtml")) {
      const introHtml = getValue("boardIntroHtmlInput").trim();
      if (introHtml) options.introHtml = introHtml;
    }
    // 분류: | 로 구분해 입력
    const categoriesRaw = ["GUESTBOOK", "LOG"].includes(currentSkin) ? "" : getValue("boardCategoriesInput").trim();
    if (categoriesRaw) {
      const categories = categoriesRaw.split("|").map((item) => item.trim()).filter(Boolean);
      if (categories.length) options.categories = categories;
    }
    // 덧글 제한: 로그인 회원만 댓글·방명록 작성
    if (checked("boardMemberCommentInput")) options.memberComment = true;

    // 업로드 중 입력이 바뀌어도 저장 시작 시점의 값만 쓴다
    const payload = {
      id,
      title: getValue("boardTitleInput").trim() || id,
      description: getValue("boardDescInput").trim(),
      titleImage: getValue("boardTitleImageInput").trim(),
      skin: currentSkin,
      menuOrder: Number(getValue("menuOrderInput")) || 0,
      pageSize: Number(getValue("pageSizeInput")) || 0,
      menuVisible: checked("menuVisibleInput"),
      isPublic: !checked("boardAdminOnlyInput"),
      memberWrite: checked("boardMemberWriteInput"),
      options
    };
    if (stagedImage) {
      showMsg("제목 이미지 업로드 중…");
      const uploaded = await admin.media.upload(stagedImage.file, { keepOriginal: true });
      payload.titleImage = uploaded.url;
    }
    await runMutate("site:saveBoard", payload);
    clearSiteCache();
    if (editorRevision === revision) {
      resetForm();
      closeEditor();
    }
    try {
      await refreshBoards();
      showListMsg("저장했습니다.");
    } catch (error) {
      showListMsg(`게시판은 저장했습니다. ${naruErrorMessage(error, "목록을 다시 불러오지 못했습니다.")}`, true);
    }
  } catch (error) {
    const message = naruErrorMessage(error, "저장에 실패했습니다.");
    if (editorRevision === revision) showMsg(message, true);
    else showListMsg(`게시판 "${id}": ${message}`, true);
  } finally {
    savingBoard = false;
    updateBoardBusyState();
  }
}

async function refreshBoards() {
  clearSiteCache();
  const boot = await loadBoot();
  // loadBoot는 통신 실패도 빈 boards로 돌려주므로 기존 목록을 덮어쓰지 않는다
  if (boot.failed) {
    const error = new Error("게시판 목록을 불러오지 못했습니다. 연결을 확인하고 페이지를 새로고침해 주세요.");
    error.code = "UNAVAILABLE";
    throw error;
  }
  const previousOrders = new Map(boards.map((board) => [board.id, board.menuOrder]));
  boards = boot.boards;
  syncEditingMenuOrder(previousOrders);
  const listEl = document.getElementById("boardsList");
  if (!listEl) return;

  // 한 줄 행: 드래그 손잡이 · 순서 · ID(새 창) · 제목 · 설명 · 스킨 · 상태 (메뉴에서 꺼진 게시판은 흐리게)
  listEl.innerHTML = boards.length
    ? boards.map((board) => {
        const skinInfo = SKINS.find((item) => item.type === board.skinType);
        const skinLabel = skinInfo ? skinInfo.label : board.skinType;
        return `
        <div class="board-list-item board-line ${board.menuVisible ? "" : "is-menu-off"}" data-board-id="${escapeHtml(board.id)}"${board.menuVisible ? "" : ' title="메뉴에서 꺼져 있음"'}>
          <button type="button" class="board-line-handle" data-board-drag aria-label="${escapeHtml(board.title || board.id)} 순서 이동 (드래그 또는 위·아래 화살표)" title="드래그해서 순서 변경">${DRAG_HANDLE_ICON}</button>
          <span class="board-line-order" title="메뉴 순서">${Number(board.menuOrder) || 0}</span>
          <a class="board-line-id" href="board.html?bo=${encodeURIComponent(board.id)}" target="_blank" rel="noopener noreferrer" title="게시판을 새 창에서 열기">${escapeHtml(board.id)}</a>
          <strong class="board-line-title">${escapeHtml(board.title || board.id)}</strong>
          <span class="board-line-desc" title="${escapeHtml(board.description || "")}">${escapeHtml(board.description || "")}</span>
          <span class="summary-chip is-on board-line-skin" title="${escapeHtml(board.skinType)}">${escapeHtml(skinLabel)}</span>
          ${board.isPublic ? "" : '<span class="summary-chip is-off">관리자 전용</span>'}
          ${board.memberWrite ? '<span class="summary-chip is-on">회원쓰기</span>' : ""}
          ${board.options?.memberComment ? '<span class="summary-chip is-on">덧글 제한</span>' : ""}
          <span class="board-row-actions">
            <button type="button" class="btn small" data-board-edit="${escapeHtml(board.id)}">수정</button>
            <button type="button" class="btn small" data-board-delete="${escapeHtml(board.id)}">삭제</button>
          </span>
        </div>
      `;
      }).join("")
    : '<div class="notice small">게시판이 없습니다. 아래 게시판 생성 버튼으로 추가하세요.</div>';

  bindBoardReorder(listEl);

  listEl.querySelectorAll("[data-board-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const board = boards.find((item) => item.id === button.dataset.boardEdit);
      if (!board) return;
      resetForm();
      setValue("boardIdInput", board.id);
      document.getElementById("boardIdInput").readOnly = true;
      setValue("boardTitleInput", board.title);
      setValue("boardTitleImageInput", board.titleImageUrl || "");
      setValue("boardDescInput", board.description || "");
      setValue("boardCategoriesInput", (board.options?.categories || []).join("|"));
      setValue("pageSizeInput", board.pageSize || "");
      setValue("menuOrderInput", board.menuOrder || 0);
      setChecked("menuVisibleInput", board.menuVisible);
      setChecked("boardAdminOnlyInput", !board.isPublic);
      setChecked("boardMemberWriteInput", board.memberWrite);
      setChecked("boardMemberCommentInput", board.options?.memberComment === true);
      setValue("boardBoardWidthInput", board.options?.boardWidth ?? "");
      setValue("boardColumnsInput", board.options?.galleryColumns ?? "");
      setChecked("boardDetailThumbInput", board.options?.detailThumb !== false);
      setValue("boardImageWidthInput", board.options?.imageWidth ?? "");
      setValue("boardIntroHtmlInput", board.options?.introHtml ?? "");
      applySkin(board.skinType);
      // 댓글 위치는 스킨별 선택지를 만든 뒤에 복원
      const savedPosition = board.options?.commentPosition || "";
      document.getElementById("boardCommentPosInput").value =
        board.skinType === "LOG" ? (savedPosition === "bottom" ? "bottom" : "default")
                                 : (savedPosition === "left" ? "left" : "bottom");
      renderTitleImagePreview();
      updateSummary();
      openEditor("게시판 수정");
    });
  });

  listEl.querySelectorAll("[data-board-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.boardDelete;
      if (!window.confirm(`게시판 "${id}"을 삭제할까요?\n이 게시판의 글·댓글·방명록도 DB에서 모두 삭제됩니다. 되돌릴 수 없습니다.`)) return;
      try {
        await runMutate("site:removeBoard", { id });
        clearSiteCache();
        try {
          await refreshBoards();
          showListMsg("게시판과 글을 모두 삭제했습니다.");
        } catch (error) {
          showListMsg(`게시판과 글은 삭제했습니다. ${naruErrorMessage(error, "목록을 다시 불러오지 못했습니다.")}`, true);
        }
      } catch (error) {
        showListMsg(naruErrorMessage(error, "삭제에 실패했습니다."), true);
      }
    });
  });
}

// 메뉴 순서: 손잡이를 드래그하거나 위·아래 화살표로 옮기면 바로 저장
function bindBoardReorder(listEl) {
  const rows = () => Array.from(listEl.querySelectorAll(".board-line"));
  const currentIds = () => rows().map((row) => row.dataset.boardId);

  listEl.querySelectorAll("[data-board-drag]").forEach((handle) => {
    const row = handle.closest(".board-line");

    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || savingBoard || activeBoardDrag) return;
      event.preventDefault();
      activeBoardDrag = true;
      updateBoardBusyState();
      const before = currentIds().join("\n");
      const pointerId = event.pointerId;
      row.classList.add("is-dragging");
      document.body.classList.add("is-board-dragging");

      // 가운데선이 포인터보다 아래인 첫 행 앞에 끼운다. 행을 옮기면 포인터 캡처가 풀리므로 document에서 받는다.
      const onMove = (moveEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        const next = rows().find((other) => {
          if (other === row) return false;
          const rect = other.getBoundingClientRect();
          return moveEvent.clientY < rect.top + rect.height / 2;
        });
        if (next) {
          if (next !== row.nextElementSibling) listEl.insertBefore(row, next);
        } else if (row !== rows().at(-1)) {
          rows().at(-1).after(row);
        }
      };
      const onEnd = (endEvent) => {
        if (endEvent.pointerId !== pointerId) return;
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onEnd);
        document.removeEventListener("pointercancel", onEnd);
        activeBoardDrag = false;
        row.classList.remove("is-dragging");
        document.body.classList.remove("is-board-dragging");
        if (currentIds().join("\n") !== before) saveBoardOrder(listEl, currentIds());
        else updateBoardBusyState();
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onEnd);
      document.addEventListener("pointercancel", onEnd);
    });

    handle.addEventListener("keydown", (event) => {
      if (savingBoard || activeBoardDrag) return;
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      const sibling = event.key === "ArrowUp" ? row.previousElementSibling : row.nextElementSibling;
      if (!sibling?.classList.contains("board-line")) return;
      if (event.key === "ArrowUp") sibling.before(row);
      else sibling.after(row);
      handle.focus();
      saveBoardOrder(listEl, currentIds());
    });
  });
  updateBoardBusyState();
}

let reorderSaving = Promise.resolve();
let reorderRevision = 0;
function saveBoardOrder(listEl, ids) {
  if (savingBoard) {
    showListMsg("게시판 저장이 끝난 뒤 순서를 바꿔 주세요.", true);
    return;
  }
  pendingBoardReorders += 1;
  updateBoardBusyState();
  const revision = ++reorderRevision;
  // 화면 번호는 바로 바꾸고, 저장은 앞선 저장이 끝난 뒤 차례로 (연속 이동에도 마지막 순서가 남게)
  listEl.querySelectorAll(".board-line").forEach((row, index) => {
    const orderEl = row.querySelector(".board-line-order");
    if (orderEl) orderEl.textContent = String(index);
  });
  reorderSaving = reorderSaving.catch(() => {}).then(async () => {
    try {
      await runMutate("site:reorderBoards", { ids });
      clearSiteCache();
      const previousOrders = new Map(boards.map((board) => [board.id, board.menuOrder]));
      ids.forEach((id, index) => {
        const board = boards.find((item) => item.id === id);
        if (board) board.menuOrder = index;
      });
      boards.sort((a, b) => a.menuOrder - b.menuOrder);
      // 앞선 실패 복구가 목록을 다시 그렸을 수 있으니 마지막 저장 순서를 화면에 맞춘다 (뒤에 남은 이동이 없을 때만)
      if (revision === reorderRevision) {
        const rows = new Map(Array.from(listEl.querySelectorAll(".board-line"), (row) => [row.dataset.boardId, row]));
        const displayedIds = Array.from(rows.keys());
        const needsMove = displayedIds.length !== ids.length || displayedIds.some((id, index) => id !== ids[index]);
        const focused = document.activeElement;
        const restoreFocus = needsMove && listEl.contains(focused);
        ids.forEach((id, index) => {
          const row = rows.get(id);
          if (!row) return;
          if (needsMove) listEl.append(row);
          const orderEl = row.querySelector(".board-line-order");
          if (orderEl) orderEl.textContent = String(index);
        });
        if (restoreFocus) focused.focus({ preventScroll: true });
      }
      // 편집 중인 게시판의 '메뉴 순서' 칸도 새 값으로 (그대로 저장해 옛 순서로 돌아가지 않게)
      syncEditingMenuOrder(previousOrders);
      showListMsg("메뉴 순서를 저장했습니다.");
    } catch (error) {
      const saveError = naruErrorMessage(error, "순서 저장에 실패했습니다.");
      showListMsg(saveError, true);
      try {
        await refreshBoards();
      } catch (refreshError) {
        const refreshMessage = naruErrorMessage(refreshError, "목록을 다시 불러오지 못했습니다.");
        showListMsg(`${saveError} ${refreshMessage} 페이지를 새로고침해 주세요.`, true);
      }
    } finally {
      pendingBoardReorders -= 1;
      updateBoardBusyState();
    }
  });
}

function updateBoardBusyState() {
  const saveBtn = document.getElementById("saveBoardBtn");
  if (saveBtn) saveBtn.disabled = savingBoard || pendingBoardReorders > 0 || activeBoardDrag;
  document.querySelectorAll("#boardsList [data-board-drag]").forEach((handle) => {
    handle.disabled = savingBoard;
  });
}

function syncEditingMenuOrder(previousOrders) {
  if (!document.getElementById("boardIdInput")?.readOnly) return;
  const id = getValue("boardIdInput").trim();
  const editing = boards.find((item) => item.id === id);
  // 직접 고친 값은 두고, 이전 저장값 그대로인 칸만 맞춘다
  if (!editing || !previousOrders.has(id) || Number(getValue("menuOrderInput")) !== Number(previousOrders.get(id))) return;
  setValue("menuOrderInput", editing.menuOrder);
  updateSummary();
}

const showMsg = (text, isError = false) => showNotice("boardMsg", text, isError);
const showListMsg = (text, isError = false) => showNotice("boardListMsg", text, isError);
