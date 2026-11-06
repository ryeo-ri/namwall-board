// 게시판 메뉴 통합 관리 뷰 — admin.js(해시 라우터)가 initBoardsAdmin(관리자 핸들)으로 초기화한다.
import { runMutate, naruErrorMessage } from "../core/naru-client.js";
import { loadBoot, clearSiteCache, escapeHtml } from "../core/site.js";

const SKINS = [
  { type: "BOARD", label: "목록형 게시판" },
  { type: "GALLERY", label: "갤러리" },
  { type: "LOG", label: "로그" },
  { type: "THREAD", label: "타래" },
  { type: "SCRIPT", label: "TRPG 로그백업" },
  { type: "GUESTBOOK", label: "방명록" },
  { type: "PROFILE", label: "캐릭터 프로필" }
];
// 스킨별로 쓰는 옵션 필드 (원본 boardOptionsSchema 기준 — 게시판 가로는 PROFILE 제외 공통)
const SKIN_OPTION_FIELDS = {
  BOARD: ["boardWidth"],
  GALLERY: ["boardWidth", "columns"],
  LOG: ["boardWidth", "imageWidth", "commentPosition"],
  THREAD: ["boardWidth", "columns", "commentPosition", "detailThumb"],
  SCRIPT: ["boardWidth", "columns"],
  GUESTBOOK: ["boardWidth"],
  PROFILE: ["columns"]
};
// 1줄 수 라벨·기본값·최대값도 원본 스킨 정의를 따른다
const COLUMN_PRESETS = {
  GALLERY: { label: "1줄 게시물 수", placeholder: "기본 4", max: 6 },
  THREAD: { label: "1줄 카드 수", placeholder: "기본 3", max: 4 },
  SCRIPT: { label: "1줄 세션 수", placeholder: "기본 3", max: 6 },
  PROFILE: { label: "1줄 게시물 수", placeholder: "기본 4", max: 6 }
};
const BOARD_WIDTH_PLACEHOLDERS = {
  THREAD: "기본 1100 / 100 이하는 %",
  SCRIPT: "기본 1100 / 100 이하는 %"
};

let admin = null;
let boards = [];
let currentSkin = "BOARD";
let titleImageStaged = null; // { file, previewUrl }

export async function initBoardsAdmin(adminHandle) {
  admin = adminHandle;
  renderSkinCatalog();
  applySkin("BOARD");
  bindForm();
  bindTitleImage();
  await refreshBoards();
  updateSummary();
}

/* ── 스킨 빠른 선택 칩 ── */
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

  // 카테고리 블록: 방명록·로그 스킨에는 없음, 나머지 스킨은 표시
  document.getElementById("categoryBlock")?.classList.toggle("hidden", ["GUESTBOOK", "LOG"].includes(currentSkin));

  // 스킨별 라벨·기본값 (원본 그대로)
  const columnsPreset = COLUMN_PRESETS[currentSkin];
  const columnsInput = document.getElementById("boardColumnsInput");
  const columnsLabel = document.querySelector('label[for="boardColumnsInput"]');
  if (columnsInput && columnsPreset) {
    columnsInput.placeholder = columnsPreset.placeholder;
    columnsInput.max = String(columnsPreset.max);
    if (columnsLabel) columnsLabel.textContent = `${columnsPreset.label} (1~${columnsPreset.max})`;
  }
  const widthInput = document.getElementById("boardBoardWidthInput");
  if (widthInput) widthInput.placeholder = BOARD_WIDTH_PLACEHOLDERS[currentSkin] || "기본 800 / 100 이하는 %";
  const positionLabel = document.querySelector('label[for="boardCommentPosInput"]');
  if (positionLabel) positionLabel.textContent = currentSkin === "LOG" ? "덧글 위치" : "댓글 위치";

  // 댓글 위치 선택지는 스킨마다 다르다: LOG = 우측(기본)/하단, THREAD = 하단(기본)/좌측
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

/* ── 제목 이미지: URL 직접 입력 또는 파일(저장 시 업로드) ── */
function bindTitleImage() {
  const dropZone = document.getElementById("boardTitleImageDropZone");
  const fileInput = document.getElementById("boardTitleImageFile");
  const pick = (file) => {
    if (!file || !/^image\//i.test(file.type || "")) return;
    if (titleImageStaged) URL.revokeObjectURL(titleImageStaged.previewUrl);
    titleImageStaged = { file, previewUrl: URL.createObjectURL(file) };
    renderTitleImagePreview();
  };
  document.getElementById("selectTitleImageBtn")?.addEventListener("click", () => fileInput?.click());
  dropZone?.addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    fileInput?.click();
  });
  fileInput?.addEventListener("change", () => { pick(fileInput.files?.[0]); fileInput.value = ""; });
  dropZone?.addEventListener("dragover", (event) => event.preventDefault());
  dropZone?.addEventListener("drop", (event) => {
    event.preventDefault();
    pick(event.dataTransfer?.files?.[0]);
  });
  dropZone?.addEventListener("paste", (event) => {
    const file = Array.from(event.clipboardData?.files || []).find((item) => /^image\//i.test(item.type || ""));
    if (file) { event.preventDefault(); pick(file); }
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
    renderTitleImagePreview();
  });
}

/* ── 폼 ↔ 요약 패널 ── */
function bindForm() {
  ["boardIdInput", "boardTitleInput", "menuOrderInput", "pageSizeInput",
   "boardBoardWidthInput", "boardColumnsInput", "boardCommentPosInput", "boardImageWidthInput"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", updateSummary);
  });
  ["menuVisibleInput", "boardAdminOnlyInput", "boardMemberWriteInput", "boardMemberCommentInput", "boardDetailThumbInput"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", updateSummary);
  });

  document.getElementById("autoBoardIdBtn")?.addEventListener("click", () => {
    setValue("boardIdInput", `b${Date.now().toString(36)}`);
    updateSummary();
  });

  document.getElementById("resetBoardBtn")?.addEventListener("click", () => resetForm());
  document.getElementById("saveBoardBtn")?.addEventListener("click", save);

  // 목록 아래 '게시판 생성' 버튼 → 빈 폼으로 편집 카드 열기
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

function resetForm(message = "") {
  ["boardIdInput", "boardTitleInput", "boardTitleImageInput", "boardDescInput", "boardCategoriesInput",
   "pageSizeInput", "menuOrderInput", "boardBoardWidthInput", "boardColumnsInput", "boardImageWidthInput"].forEach((id) => setValue(id, ""));
  document.getElementById("boardIdInput").readOnly = false;
  document.getElementById("boardCommentPosInput").value = "bottom";
  document.getElementById("boardDetailThumbInput").checked = true;
  document.getElementById("menuVisibleInput").checked = true;
  document.getElementById("boardAdminOnlyInput").checked = false;
  document.getElementById("boardMemberWriteInput").checked = false;
  document.getElementById("boardMemberCommentInput").checked = false;
  if (titleImageStaged) URL.revokeObjectURL(titleImageStaged.previewUrl);
  titleImageStaged = null;
  renderTitleImagePreview();
  applySkin("BOARD");
  updateSummary();
  if (message) showMsg(message);
}

/* ── 저장 ── */
async function save() {
  const id = getValue("boardIdInput").trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return showMsg("게시판 ID는 영문·숫자·_- 1~64자입니다.", true);

  const saveBtn = document.getElementById("saveBoardBtn");
  if (saveBtn) saveBtn.disabled = true;
  try {
    let titleImage = getValue("boardTitleImageInput").trim();
    if (titleImageStaged) {
      showMsg("제목 이미지 업로드 중…");
      const uploaded = await admin.media.upload(titleImageStaged.file);
      titleImage = uploaded.url;
    }

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
      // LOG의 '우측(기본)'과 THREAD의 '하단(기본)'은 저장하지 않음 (기본값)
    }
    if (fields.includes("detailThumb") && !checked("boardDetailThumbInput")) {
      options.detailThumb = false;
    }
    if (fields.includes("imageWidth")) {
      const imageWidthRaw = getValue("boardImageWidthInput").trim();
      if (imageWidthRaw !== "") options.imageWidth = Number(imageWidthRaw);
    }
    // 카테고리(분류): | 로 구분해 입력 — 비우면 사용 안 함, 방명록·로그 스킨은 제외
    const categoriesRaw = ["GUESTBOOK", "LOG"].includes(currentSkin) ? "" : getValue("boardCategoriesInput").trim();
    if (categoriesRaw) {
      const categories = categoriesRaw.split("|").map((item) => item.trim()).filter(Boolean);
      if (categories.length) options.categories = categories;
    }
    // 덧글 제한: 스킨과 무관하게 저장 (로그인 회원만 댓글·방명록 작성)
    if (checked("boardMemberCommentInput")) options.memberComment = true;

    await runMutate("site:saveBoard", {
      id,
      title: getValue("boardTitleInput").trim() || id,
      description: getValue("boardDescInput").trim(),
      titleImage,
      skin: currentSkin,
      menuOrder: Number(getValue("menuOrderInput")) || 0,
      pageSize: Number(getValue("pageSizeInput")) || 0,
      menuVisible: checked("menuVisibleInput"),
      isPublic: !checked("boardAdminOnlyInput"),
      memberWrite: checked("boardMemberWriteInput"),
      options
    });
    clearSiteCache();
    resetForm();
    closeEditor();
    await refreshBoards();
    showListMsg("저장했습니다.");
  } catch (error) {
    showMsg(naruErrorMessage(error, "저장에 실패했습니다."), true);
  }
  if (saveBtn) saveBtn.disabled = false;
}

/* ── 게시판 목록 ── */
async function refreshBoards() {
  clearSiteCache();
  const boot = await loadBoot();
  boards = boot.boards;
  const listEl = document.getElementById("boardsList");
  if (!listEl) return;

  // 한 줄 행: 램프(메뉴 노출) · 순서 · ID(새 창 바로가기) · 제목 · 설명 · 스킨 · 상태
  // 메뉴에서 꺼진 게시판은 행 전체를 흐리게(불꺼짐) 표시한다.
  listEl.innerHTML = boards.length
    ? boards.map((board) => {
        const skinInfo = SKINS.find((item) => item.type === board.skinType);
        const skinLabel = skinInfo ? skinInfo.label : board.skinType;
        return `
        <div class="board-list-item board-line ${board.menuVisible ? "" : "is-menu-off"}">
          <span class="board-line-lamp" title="${board.menuVisible ? "메뉴에 노출 중" : "메뉴에서 꺼져 있음"}"></span>
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
      document.getElementById("menuVisibleInput").checked = board.menuVisible;
      document.getElementById("boardAdminOnlyInput").checked = !board.isPublic;
      document.getElementById("boardMemberWriteInput").checked = board.memberWrite;
      document.getElementById("boardMemberCommentInput").checked = board.options?.memberComment === true;
      setValue("boardBoardWidthInput", board.options?.boardWidth ?? "");
      setValue("boardColumnsInput", board.options?.galleryColumns ?? "");
      document.getElementById("boardDetailThumbInput").checked = board.options?.detailThumb !== false;
      setValue("boardImageWidthInput", board.options?.imageWidth ?? "");
      applySkin(board.skinType);
      // 댓글 위치는 스킨별 선택지를 구성한 뒤에 복원 (LOG 기본=우측, THREAD 기본=하단)
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
        await refreshBoards();
        showListMsg("게시판과 글을 모두 삭제했습니다.");
      } catch (error) {
        showListMsg(naruErrorMessage(error, "삭제에 실패했습니다."), true);
      }
    });
  });
}

function formatResponsiveWidth(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "";
  return n <= 100 ? `${Math.round(n)}%` : `${Math.round(n)}px`;
}
function checked(id) { return document.getElementById(id)?.checked === true; }
function getValue(id) { return document.getElementById(id)?.value || ""; }
function setValue(id, value) { const el = document.getElementById(id); if (el) el.value = value ?? ""; }
function setText(id, value) { const el = document.getElementById(id); if (el) el.textContent = value; }
function showMsg(text, isError = false) {
  const el = document.getElementById("boardMsg");
  if (!el) return;
  el.textContent = text;
  el.classList.remove("hidden");
  el.classList.toggle("notice-error", isError);
}
// 편집 카드가 닫혀 있을 때(목록 화면)의 메시지
function showListMsg(text, isError = false) {
  const el = document.getElementById("boardListMsg");
  if (!el) return;
  el.textContent = text;
  el.classList.remove("hidden");
  el.classList.toggle("notice-error", isError);
}
