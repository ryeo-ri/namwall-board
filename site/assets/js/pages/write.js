// NAMWALL Edition Copyright (c) 2026 NAMWALL — MPL-2.0 (https://mozilla.org/MPL/2.0/)
// 글쓰기/수정 — 관리자 또는 (회원 글쓰기가 켜진 게시판의) 회원
// 파일은 staged 목록에 들고 있다가 저장할 때 업로드한다
import { getAdminSession, getMemberSession, signInAdmin, signInMember, runQuery, runMutate, naruErrorMessage } from "../core/naru-client.js";
import { renderHeader, getBoardById, promptNickname, escapeHtml, ownerDisplayName, normalizeSkinType } from "../core/site.js";
import { createMediaUploadSession } from "../shared/media-budget.js";
import { toVideoEmbedSrc, renderVideoFrame } from "../shared/video.js";
import { getValue, setValue, setText, showNotice, bindImagePicker } from "../shared/ui.js";

// 대표 칸 VIDEO·TEXT를 쓸 수 있는 스킨 (SCRIPT·PROFILE·BOOKMARK는 이미지만)
const VIDEO_SKINS = ["BOARD", "GALLERY", "LOG", "THREAD"];
const TEXT_SKINS = ["GALLERY", "LOG"];

let uploader = null;          // media.upload 핸들 (관리자 또는 회원)
let editingId = 0;
let currentBoard = null;
let thumbStaged = null;       // { blob?, url?, previewUrl }
let extraStaged = [];         // [{ blob?, url?, name, previewUrl }]
let scriptWriter = null;      // SCRIPT 스킨 모듈 (필요할 때만 로드)
let editingScriptData = null;
let saving = false;
const disabledBeforeSave = new Map();
const MAX_EXTRA_ITEMS = 24;   // post:write의 이미지·첨부 개수 한도
const MAX_IMAGE_URL = 2048;
const profileImageStaged = { full: null, head: null }; // PROFILE 전신/두상 { blob, previewUrl }

// 아카이브 업로드 결과 중 글에 저장할 키
const SCRIPT_ARCHIVE_KEYS = [
  "archiveUrl", "archiveId", "archiveEncoding", "archiveVersion", "sourceType", "sourceFileName",
  "messageCount", "assetCount", "archivedAssetCount", "originalBytes", "normalizedBytes", "archiveBytes"
];

async function init() {
  const params = new URLSearchParams(location.search);
  const boardId = params.get("bo") || "";
  const postId = Number(params.get("id")) || 0;
  const formEl = document.getElementById("writeForm");
  const msgEl = document.getElementById("writeMsg");
  formEl?.addEventListener("input", clearInvalidField);
  formEl?.addEventListener("change", clearInvalidField);

  const [boot, admin, member] = await Promise.all([renderHeader(), getAdminSession(), getMemberSession()]);
  uploader = admin || member;

  const writableBoards = boot.boards.filter((board) => {
    if (board.skinType === "GUESTBOOK") return false;
    if (boot.owner) return true;
    return Boolean(member) && board.memberWrite;
  });

  if (!uploader || (!boot.owner && !writableBoards.length && !postId)) {
    const gate = document.getElementById("writeGate");
    gate?.classList.remove("hidden");
    const gateText = document.getElementById("writeGateText");
    if (gateText && uploader) gateText.textContent = "이 사이트에는 회원이 글을 쓸 수 있는 게시판이 없습니다.";
    const alertFail = (error) => window.alert(naruErrorMessage(error, "로그인을 시작하지 못했습니다."));
    document.getElementById("writeLoginBtn")?.addEventListener("click", () => signInMember().catch(alertFail));
    document.getElementById("writeAdminLoginBtn")?.addEventListener("click", () => signInAdmin().catch(alertFail));
    return;
  }

  if (!boot.owner && boot.me && !boot.me.nickname) {
    await promptNickname("글을 쓰려면 닉네임이 필요합니다. 사용할 닉네임을 입력하세요.");
    return;
  }

  formEl?.classList.remove("hidden");
  setText("authorCurrentValue", boot.owner ? ownerDisplayName() : (boot.me?.nickname || "회원"));

  // 게시판: bo 파라미터가 있으면 고정, 없으면 선택창
  const boardSelect = document.getElementById("boardSelect");
  if (boardSelect) {
    boardSelect.innerHTML = writableBoards
      .map((board) => `<option value="${escapeHtml(board.id)}"${board.id === boardId ? " selected" : ""}>${escapeHtml(board.title || board.id)}</option>`)
      .join("");
  }
  const fixedBoard = getBoardById(writableBoards, boardId);
  if (fixedBoard) {
    setText("boardCurrentValue", fixedBoard.title || fixedBoard.id);
  } else {
    document.getElementById("boardCurrentValue")?.classList.add("hidden");
    boardSelect?.classList.remove("hidden");
    boardSelect?.addEventListener("change", () => applySkinFields(boot));
  }
  currentBoard = fixedBoard || getBoardById(writableBoards, boardSelect?.value || "");
  applySkinFields(boot);

  // 수정 모드 — 서버가 작성자·관리자 여부를 확인한다
  if (postId) {
    try {
      const post = await runQuery("board:post", { id: postId });
      if (!post.editable) {
        showNotice(msgEl, "이 글을 수정할 권한이 없습니다.");
        formEl?.classList.add("hidden");
        return;
      }
      editingId = post.id;
      setText("writeHeading", "게시물 수정");
      setValue("titleInput", post.title);
      setValue("contentInput", post.body);
      setValue("tagsInput", (post.tags || []).join(", "));
      setValue("sourceInput", post.source || "");
      setValue("bookmarkLinkInput", post.source || "");
      if (post.logNo) setValue("logNumberInput", String(post.logNo));
      currentBoard = getBoardById(boot.boards, post.boardId) || currentBoard;
      setText("boardCurrentValue", currentBoard?.title || post.boardId);
      // 수정 중인 글은 원래 게시판에 고정
      document.getElementById("boardCurrentValue")?.classList.remove("hidden");
      boardSelect?.classList.add("hidden");
      document.getElementById("visibilityInput").value = post.isSecret ? "secret" : (post.memberOnly ? "members" : "public");
      document.getElementById("secretPwWrap")?.classList.toggle("hidden", !post.isSecret);
      // 대표 칸 복원: VIDEO / 이미지 / 이미지 없음 = TEXT (갤러리는 본문, 예전 글은 제목)
      const editSkin = normalizeSkinType(currentBoard || {});
      if (post.skinData?.cover === "video" && post.thumb) {
        setThumbMode("video");
        setValue("thumbVideoInput", post.thumb);
      } else if (post.thumb) {
        thumbStaged = { url: post.thumb, previewUrl: post.thumb };
        setValue("imageUrlInput", post.thumb);
      } else if (TEXT_SKINS.includes(editSkin)) {
        setThumbMode("text");
        if (editSkin === "GALLERY") setValue("thumbTextInput", String(post.body || "").trim() || post.title);
      }
      const existingExtras = currentBoard && normalizeSkinType(currentBoard) === "GALLERY"
        ? (post.attachments || []).map((item) => ({ url: item.url, name: item.name || "", previewUrl: item.url }))
        : (post.images || []).map((url) => ({ url, name: "", previewUrl: url }));
      extraStaged = existingExtras;
      if (post.skinData && post.skinData.script) {
        editingScriptData = post.skinData.script;
        setValue("scriptSystemInput", editingScriptData.system || "");
        setValue("scriptScenarioInput", editingScriptData.scenario || "");
        setValue("scriptGmInput", editingScriptData.gm || "");
        setValue("scriptPlayedAtInput", editingScriptData.playedAt || "");
        setValue("scriptPlayersInput", editingScriptData.players || "");
        setValue("scriptSummaryInput", editingScriptData.summary || "");
      }
      if (post.skinData && post.skinData.profile) {
        const profile = post.skinData.profile;
        const meta = profile.meta || {};
        setValue("profileNameEnInput", profile.nameEn || "");
        setValue("profileAgeInput", meta.age || "");
        setValue("profileGenderInput", meta.gender || "");
        setValue("profileHeightInput", meta.height || "");
        setValue("profileOneLineInput", profile.oneLine || "");
        setValue("profileFullBodyInput", profile.fullBodyImage || "");
        setValue("profileHeadInput", profile.headImage || "");
        setValue("profileAppearanceInput", profile.appearance || "");
        setValue("profilePersonalityInput", profile.personality || "");
        setValue("profileEtcInput", profile.etc || "");
        const etcHtml = document.getElementById("profileEtcHtmlInput");
        if (etcHtml) etcHtml.checked = profile.etcIsHtml === true;
        renderProfileImagePreview("full");
        renderProfileImagePreview("head");
      }
      applySkinFields(boot);
      applyCategoryField(post.category || "");
      renderThumbPreview();
      renderExtraList();
    } catch (error) {
      showNotice(msgEl, naruErrorMessage(error, "게시물을 불러오지 못했습니다."));
      return;
    }
  }

  bindThumbControls();
  bindExtraControls();
  bindVisibility();
  bindProfileImageControls();
  document.getElementById("saveBtn")?.addEventListener("click", () => save(msgEl));
  const cancel = document.getElementById("cancelBtn");
  if (cancel && currentBoard) cancel.href = `board.html?bo=${encodeURIComponent(currentBoard.id)}`;
}

// 스킨별 필드: GALLERY(제목·본문 없음, 출처) / LOG(로그번호, 제목 없음) / SCRIPT(세션 정보)
// / PROFILE(프로필 정보) / BOOKMARK(이름·배너 이미지·링크만)
function applySkinFields(boot) {
  if (saving) return;
  const boardSelect = document.getElementById("boardSelect");
  if (!currentBoard || (boardSelect && !boardSelect.classList.contains("hidden"))) {
    currentBoard = getBoardById(boot.boards, boardSelect?.value || "") || currentBoard;
  }
  const skin = currentBoard ? normalizeSkinType(currentBoard) : "BOARD";
  const isBookmark = skin === "BOOKMARK";
  const isGallery = skin === "GALLERY";
  // 갤러리·LOG는 제목 칸을 숨긴다 (예전 글의 제목은 숨긴 칸에 남아 그대로 저장된다)
  document.getElementById("titleFields")?.classList.toggle("hidden", isGallery || skin === "LOG");
  document.getElementById("logOnlyFields")?.classList.toggle("hidden", skin !== "LOG");
  document.getElementById("galleryOnlyFields")?.classList.toggle("hidden", skin !== "GALLERY");
  document.getElementById("bookmarkOnlyFields")?.classList.toggle("hidden", !isBookmark);
  document.getElementById("visibilityInnerFields")?.classList.toggle("hidden", isBookmark);
  document.getElementById("tagFields")?.classList.toggle("hidden", isBookmark);
  const titleInput = document.getElementById("titleInput");
  if (titleInput) {
    titleInput.placeholder = skin === "PROFILE" ? "캐릭터 이름"
      : (isBookmark ? "배너 이름 (예: 사이트·운영자 이름)" : "제목");
  }
  const titleLabel = document.querySelector('label[for="titleInput"]');
  if (titleLabel) titleLabel.textContent = isBookmark ? "이름" : "제목";
  const thumbLabel = document.querySelector("#thumbSection .write-label");
  if (thumbLabel) thumbLabel.textContent = isBookmark ? "배너 이미지" : "대표이미지";
  if (!editingId) setText("writeHeading", isBookmark ? "배너 등록" : "게시물 작성");
  // 쓸 수 없는 대표 칸 방식이 골라져 있으면 파일로 되돌린다
  const allowVideo = VIDEO_SKINS.includes(skin);
  const allowText = TEXT_SKINS.includes(skin);
  document.getElementById("thumbModeVideoLabel")?.classList.toggle("hidden", !allowVideo);
  document.getElementById("thumbModeTextLabel")?.classList.toggle("hidden", !allowText);
  if ((getThumbMode() === "video" && !allowVideo) || (getThumbMode() === "text" && !allowText)) setThumbMode("file");
  // 북마크 배너 이미지는 URL 입력이 기본
  if (isBookmark && !thumbStaged?.blob && getThumbMode() !== "url") setThumbMode("url");
  // TEXT: 갤러리는 카드 텍스트 입력, LOG는 이미지 없이 본문만
  document.getElementById("thumbTextInput")?.classList.toggle("hidden", !isGallery);
  document.getElementById("thumbTextLabel")?.classList.toggle("hidden", !isGallery);
  document.getElementById("thumbTextNote")?.classList.toggle("hidden", isGallery);
  applyThumbMode();

  const isScript = skin === "SCRIPT";
  const isProfile = skin === "PROFILE";
  document.getElementById("scriptFields")?.classList.toggle("hidden", !isScript);
  document.getElementById("profileFields")?.classList.toggle("hidden", !isProfile);
  document.getElementById("contentFields")?.classList.toggle("hidden", isScript || isProfile || isBookmark || isGallery);
  document.getElementById("extraFields")?.classList.toggle("hidden", isScript || isBookmark);
  document.body.classList.toggle("script-write-page", isScript);
  if (isScript) {
    import("../skins/script-writer.js").then((module) => {
      scriptWriter = module;
      module.bindScriptWriter(document.getElementById("scriptFields"), editingScriptData);
      if (saving) module.setScriptWriterBusy(document.getElementById("scriptFields"), true);
    });
  }
  applyCategoryField();
}

// 분류: 게시판 설정(options.categories)이 있으면 드롭다운
function applyCategoryField(selected = "") {
  const row = document.getElementById("categoryFields");
  const select = document.getElementById("categorySelect");
  if (!row || !select) return;
  const categories = Array.isArray(currentBoard?.options?.categories) ? currentBoard.options.categories : [];
  row.classList.toggle("hidden", !categories.length);
  if (!categories.length) {
    select.innerHTML = "";
    return;
  }
  const current = selected || select.value;
  select.innerHTML = [
    '<option value="">선택 안 함</option>',
    ...categories.map((cat) => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`)
  ].join("");
  if (categories.includes(current)) select.value = current;
}

// PROFILE 전신/두상 이미지 — URL 직접 입력 또는 파일(저장 시 업로드)
const PROFILE_IMAGE_IDS = {
  full: { input: "profileFullBodyInput", button: "profileFullBodyFileBtn", file: "profileFullBodyFile", preview: "profileFullBodyPreview" },
  head: { input: "profileHeadInput", button: "profileHeadFileBtn", file: "profileHeadFile", preview: "profileHeadPreview" }
};

function bindProfileImageControls() {
  Object.entries(PROFILE_IMAGE_IDS).forEach(([slot, ids]) => {
    bindImagePicker({ button: document.getElementById(ids.button), input: document.getElementById(ids.file) }, ([file]) => {
      if (saving) return;
      if (profileImageStaged[slot]) URL.revokeObjectURL(profileImageStaged[slot].previewUrl);
      profileImageStaged[slot] = { blob: file, previewUrl: URL.createObjectURL(file) };
      renderProfileImagePreview(slot);
    });
    document.getElementById(ids.input)?.addEventListener("input", () => {
      if (saving) return;
      if (profileImageStaged[slot]) {
        URL.revokeObjectURL(profileImageStaged[slot].previewUrl);
        profileImageStaged[slot] = null;
      }
      renderProfileImagePreview(slot);
    });
  });
}

function renderProfileImagePreview(slot) {
  const ids = PROFILE_IMAGE_IDS[slot];
  const previewEl = document.getElementById(ids.preview);
  if (!previewEl) return;
  const url = profileImageStaged[slot]?.previewUrl || getValue(ids.input).trim();
  previewEl.classList.toggle("hidden", !url);
  previewEl.innerHTML = url
    ? `<div class="previewItem"><img class="previewImage" src="${escapeHtml(url)}" alt="이미지 미리보기"></div>`
    : "";
}

// staged 파일이 있으면 업로드, 없으면 입력된 URL (snapshot = 저장 시작 시점의 { staged, url })
async function resolveProfileImage(snapshot, msgEl, label) {
  if (snapshot.staged?.blob) return (await uploadStaged(snapshot.staged, msgEl, label)).url;
  return snapshot.url;
}

// staged 파일 업로드 — 등록이 실패해 다시 저장할 때 같은 파일을 또 올리지 않게 결과를 기억한다
async function uploadStaged(item, msgEl, label, uploadSession = null) {
  if (!item.uploaded) {
    showNotice(msgEl, `${label} 업로드 중…`);
    item.uploaded = await (uploadSession ? uploadSession.upload(item.blob) : uploader.media.upload(item.blob));
  }
  return item.uploaded;
}

// 대표 칸: 파일 / URL / VIDEO / TEXT
const THUMB_MODES = ["file", "url", "video", "text"];

function getThumbMode() {
  return document.querySelector('input[name="thumbMode"]:checked')?.value || "file";
}

function setThumbMode(mode) {
  const radio = document.getElementById(`thumbMode${mode.charAt(0).toUpperCase()}${mode.slice(1)}`);
  if (radio) radio.checked = true;
  applyThumbMode();
}

function applyThumbMode() {
  const mode = getThumbMode();
  THUMB_MODES.forEach((item) => {
    const fields = document.getElementById(`thumb${item.charAt(0).toUpperCase()}${item.slice(1)}Fields`);
    fields?.classList.toggle("hidden", item !== mode);
  });
  renderThumbPreview();
}

function bindThumbControls() {
  const fileRadio = document.getElementById("thumbModeFile");
  document.querySelectorAll('input[name="thumbMode"]').forEach((radio) => {
    radio.addEventListener("change", applyThumbMode);
  });
  document.getElementById("thumbVideoInput")?.addEventListener("input", renderThumbPreview);

  const pickFile = (file) => {
    if (saving || !file) return;
    if (thumbStaged?.blob && thumbStaged.previewUrl) URL.revokeObjectURL(thumbStaged.previewUrl);
    thumbStaged = { blob: file, previewUrl: URL.createObjectURL(file) };
    document.getElementById("clearThumbFileBtn")?.classList.remove("hidden");
    renderThumbPreview();
  };
  bindImagePicker({
    button: document.getElementById("selectThumbFileBtn"),
    input: document.getElementById("thumbFileInput"),
    dropZone: document.getElementById("thumbDropZone")
  }, ([file]) => pickFile(file));
  // Ctrl+V: 페이지 어디서든 클립보드 이미지를 대표 이미지로 (추가 이미지 칸에 붙여넣으면 그쪽이 먼저)
  document.addEventListener("paste", (event) => {
    if (saving || event.defaultPrevented) return;
    const file = Array.from(event.clipboardData?.files || []).find((item) => /^image\//i.test(item.type || ""));
    if (!file) return;
    // 입력칸에 글자와 그림이 함께 붙여넣어지면(Word·Excel) 글자 우선
    const typing = event.target instanceof Element && event.target.closest("input, textarea, [contenteditable]");
    if (typing && Array.from(event.clipboardData.types || []).includes("text/plain")) return;
    event.preventDefault();
    if (!fileRadio?.checked) setThumbMode("file");
    pickFile(file);
  });
  document.getElementById("clearThumbFileBtn")?.addEventListener("click", () => {
    if (saving) return;
    if (thumbStaged?.blob && thumbStaged.previewUrl) URL.revokeObjectURL(thumbStaged.previewUrl);
    thumbStaged = null;
    document.getElementById("clearThumbFileBtn")?.classList.add("hidden");
    renderThumbPreview();
  });
  document.getElementById("imageUrlInput")?.addEventListener("change", (event) => {
    if (saving) return;
    const url = String(event.target.value || "").trim();
    thumbStaged = url ? { url, previewUrl: url } : null;
    renderThumbPreview();
  });
}

function renderThumbPreview() {
  const preview = document.getElementById("thumbPreview");
  if (!preview) return;
  const mode = getThumbMode();
  if (mode === "video") {
    const src = toVideoEmbedSrc(getValue("thumbVideoInput"));
    preview.innerHTML = src ? renderVideoFrame(src) : "";
    return;
  }
  preview.innerHTML = mode !== "text" && thumbStaged
    ? `<div class="previewItem"><img class="previewImage" src="${escapeHtml(thumbStaged.previewUrl)}" alt="썸네일 미리보기"></div>`
    : "";
}

// 추가 이미지: 파일은 고르는 즉시 목록에 담고, URL은 '추가' 버튼으로 담는다 (저장 시 업로드)
function bindExtraControls() {
  const fileRadio = document.getElementById("extraModeFile");
  const urlRadio = document.getElementById("extraModeUrl");
  const fileFields = document.getElementById("extraFileFields");
  const urlFields = document.getElementById("extraUrlFields");
  const addBtn = document.getElementById("addExtraItemBtn");
  const addRow = addBtn?.closest(".write-extra-add-row");
  const applyMode = () => {
    const isFile = !urlRadio?.checked;
    fileFields?.classList.toggle("hidden", !isFile);
    urlFields?.classList.toggle("hidden", isFile);
    addRow?.classList.toggle("hidden", isFile);
  };
  fileRadio?.addEventListener("change", applyMode);
  urlRadio?.addEventListener("change", applyMode);
  applyMode();

  bindImagePicker({
    button: document.getElementById("selectExtraFileBtn"),
    input: document.getElementById("extraFileInput"),
    dropZone: document.getElementById("extraDropZone")
  }, (incoming) => {
    if (saving) return;
    if (extraStaged.length + incoming.length > MAX_EXTRA_ITEMS) {
      return showUploadMsg(`추가 이미지는 ${MAX_EXTRA_ITEMS}개까지입니다.`);
    }
    incoming.forEach((file) => {
      extraStaged.push({ blob: file, name: file.name || "", previewUrl: URL.createObjectURL(file) });
    });
    showUploadMsg("");
    renderExtraList();
  });

  addBtn?.addEventListener("click", () => {
    if (saving) return;
    const urlInput = document.getElementById("extraImageUrlInput");
    const url = String(urlInput?.value || "").trim();
    if (!url) return showUploadMsg("URL을 입력하세요.");
    if (extraStaged.length >= MAX_EXTRA_ITEMS) return showUploadMsg(`추가 이미지는 ${MAX_EXTRA_ITEMS}개까지입니다.`);
    if (url.length > MAX_IMAGE_URL) return showUploadMsg(`이미지 주소는 ${MAX_IMAGE_URL}자까지입니다.`);
    extraStaged.push({ url, name: url.split("/").pop() || "", previewUrl: url });
    if (urlInput) urlInput.value = "";
    showUploadMsg("");
    renderExtraList();
  });
}

function renderExtraList() {
  const listEl = document.getElementById("extraItems");
  const countEl = document.getElementById("extraItemCount");
  if (countEl) countEl.textContent = extraStaged.length ? `${extraStaged.length}개` : "";
  if (!listEl) return;
  listEl.innerHTML = extraStaged.map((item, index) => `
    <div class="previewItem">
      <img class="previewImage" src="${escapeHtml(item.previewUrl)}" alt="">
      <span class="previewName">${escapeHtml(item.name || `이미지 ${index + 1}`)}</span>
      <button type="button" class="btn small" data-extra-remove="${index}">삭제</button>
    </div>
  `).join("");
  listEl.querySelectorAll("[data-extra-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      if (saving) return;
      const index = Number(button.dataset.extraRemove);
      const [removed] = extraStaged.splice(index, 1);
      if (removed?.blob && removed.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      renderExtraList();
    });
  });
}

function bindVisibility() {
  const select = document.getElementById("visibilityInput");
  select?.addEventListener("change", () => {
    document.getElementById("secretPwWrap")?.classList.toggle("hidden", select.value !== "secret");
  });
}

// 저장: staged 파일 업로드 → post:write
async function save(msgEl) {
  if (saving) return;
  document.querySelectorAll('#writeForm [aria-invalid="true"]').forEach((field) => field.removeAttribute("aria-invalid"));
  if (!currentBoard) return alertMsg(msgEl, "게시판을 선택하세요.", "#boardSelect");
  const skin = normalizeSkinType(currentBoard);
  const boardId = currentBoard.id;
  const editId = editingId;
  // 대표 칸: 파일·URL = 이미지, VIDEO = 영상 임베드 주소, TEXT = 없음
  const thumbMode = getThumbMode();
  const thumbnail = thumbMode === "file" || thumbMode === "url" ? thumbStaged : null;
  const videoSrc = thumbMode === "video" ? toVideoEmbedSrc(getValue("thumbVideoInput")) : "";
  const extraItems = skin === "SCRIPT" || skin === "BOOKMARK" ? [] : extraStaged.slice();
  // 갤러리: 본문 = TEXT 칸, 제목은 예전 글의 값만 그대로 둔다
  const isGallery = skin === "GALLERY";
  const title = isGallery && thumbMode === "text" ? "" : getValue("titleInput").trim();
  const body = isGallery ? (thumbMode === "text" ? getValue("thumbTextInput") : "") : getValue("contentInput");
  const source = skin === "BOOKMARK" ? getValue("bookmarkLinkInput").trim() : getValue("sourceInput").trim();
  const visibility = skin === "BOOKMARK" ? "public" : (document.getElementById("visibilityInput")?.value || "public");
  const isSecret = visibility === "secret";
  const secretPw = getValue("secretPwInput");

  if (skin === "BOOKMARK") {
    if (!title) return alertMsg(msgEl, "이름을 입력하세요.", "#titleInput");
    if (!thumbnail) return alertMsg(msgEl, "배너 이미지를 선택하세요.", thumbnailFocusTarget());
    if (!source) return alertMsg(msgEl, "링크 주소를 입력하세요.", "#bookmarkLinkInput");
    if (!/^https?:\/\//i.test(source)) return alertMsg(msgEl, "링크 주소는 http:// 또는 https://로 시작해야 합니다.", "#bookmarkLinkInput");
  }
  if (thumbMode === "video" && !videoSrc) return alertMsg(msgEl, "VIDEO 칸에 유튜브 링크 또는 iframe 코드를 넣어주세요.", "#thumbVideoInput");
  if (isGallery && thumbMode === "text" && !body.trim()) return alertMsg(msgEl, "TEXT 칸에 내용을 입력하세요.", "#thumbTextInput");
  if (isGallery && (thumbMode === "file" || thumbMode === "url") && !thumbnail) return alertMsg(msgEl, "이미지를 선택하세요.", thumbnailFocusTarget());
  if (skin !== "GALLERY" && skin !== "LOG" && !title) return alertMsg(msgEl, "제목을 입력하세요.", "#titleInput");
  if (skin === "SCRIPT" && !thumbnail) return alertMsg(msgEl, "대표 이미지를 선택하세요.", thumbnailFocusTarget());
  if (isSecret && !secretPw && !editId) return alertMsg(msgEl, "비밀글 비밀번호를 입력하세요.", "#secretPwInput");
  if (extraItems.length > MAX_EXTRA_ITEMS) return alertMsg(msgEl, `추가 이미지는 ${MAX_EXTRA_ITEMS}개까지입니다.`, "#extraFields");
  // 이미 알고 있는 주소(기존 글·재시도)는 업로드 전에 길이를 확인한다
  const knownThumbUrl = String(thumbnail?.uploaded?.url || thumbnail?.url || "").trim();
  if (knownThumbUrl.length > MAX_IMAGE_URL) return alertMsg(msgEl, `대표 이미지 주소는 ${MAX_IMAGE_URL}자까지입니다.`, thumbnailFocusTarget());
  if (extraItems.some((item) => String(item.uploaded?.url || item.url || "").trim().length > MAX_IMAGE_URL)) {
    return alertMsg(msgEl, `이미지 주소는 ${MAX_IMAGE_URL}자까지입니다.`, "#extraFields");
  }

  // 입력값은 첫 await 전에 확정한다 — 업로드 후에는 폼과 currentBoard를 다시 읽지 않는다
  const payload = {
    board: boardId, title, body: skin === "SCRIPT" || skin === "BOOKMARK" ? "" : body, source,
    tags: skin === "BOOKMARK" ? "" : getValue("tagsInput"), category: getValue("categorySelect"),
    secret: isSecret, memberOnly: visibility === "members"
  };
  const scriptFields = skin === "SCRIPT" ? {
    system: getValue("scriptSystemInput").trim(), scenario: getValue("scriptScenarioInput").trim(),
    gm: getValue("scriptGmInput").trim(), players: getValue("scriptPlayersInput").trim(),
    playedAt: getValue("scriptPlayedAtInput").trim(), summary: getValue("scriptSummaryInput").trim()
  } : null;
  const existingScript = editingScriptData ? { ...editingScriptData } : null;
  const profileImages = Object.fromEntries(Object.entries(PROFILE_IMAGE_IDS).map(([slot, ids]) => [slot, {
    staged: profileImageStaged[slot], url: getValue(ids.input).trim()
  }]));
  if (skin === "LOG") {
    const logNo = Number(getValue("logNumberInput")) || 0;
    if (logNo) payload.logNo = logNo;
  }
  if (skin === "PROFILE") {
    payload.skinData = { profile: {
      nameEn: getValue("profileNameEnInput").trim(), oneLine: getValue("profileOneLineInput").trim(),
      appearance: getValue("profileAppearanceInput").trim(), personality: getValue("profilePersonalityInput").trim(),
      etc: getValue("profileEtcInput").trim(), etcIsHtml: Boolean(document.getElementById("profileEtcHtmlInput")?.checked),
      meta: { age: getValue("profileAgeInput").trim(), gender: getValue("profileGenderInput").trim(), height: getValue("profileHeightInput").trim() }
    } };
  }
  // VIDEO: thumb에 임베드 주소, skinData.cover = "video"
  if (videoSrc) payload.skinData = { ...(payload.skinData || {}), cover: "video" };
  if (editId) payload.id = editId;
  if (isSecret && secretPw) payload.password = secretPw;
  setWriteSaving(true);
  let postSaved = false;
  let focusAfterSave = null;
  try {
    let scriptJob = null;
    let uploadSession = null;
    if (skin === "SCRIPT") {
      if (!scriptWriter) scriptWriter = await import("../skins/script-writer.js");
      const container = document.getElementById("scriptFields");
      scriptWriter.setScriptWriterBusy(container, true);
      scriptJob = await scriptWriter.planScriptArchive({ container, existingScript });
      uploadSession = await createMediaUploadSession(uploader);
      const thumbnailUploads = thumbnail?.blob && !thumbnail.uploaded ? 1 : 0;
      uploadSession.assertAvailable(thumbnailUploads + scriptWriter.requiredScriptUploads(scriptJob));
    }
    let thumbUrl = "";
    if (thumbnail?.blob) thumbUrl = (await uploadStaged(thumbnail, msgEl, "대표 이미지", uploadSession)).url;
    else if (thumbnail) thumbUrl = thumbnail.url || "";
    const extras = [];
    for (const item of extraItems) {
      if (item.blob) {
        const uploaded = await uploadStaged(item, msgEl, item.name || "이미지");
        extras.push({ url: uploaded.url, name: item.name || uploaded.name || "" });
      } else if (item.url) {
        extras.push({ url: item.url, name: item.name || "" });
      }
    }

    payload.thumb = videoSrc || thumbUrl;
    // 갤러리: 추가 이미지 = 다운로드 첨부, 그 외 = 본문 아래 이미지
    if (skin === "GALLERY") {
      payload.attachments = extras;
      payload.images = [];
    } else {
      payload.images = extras.map((item) => item.url);
      payload.attachments = [];
    }
    if (skin === "PROFILE") {
      payload.skinData.profile.fullBodyImage = await resolveProfileImage(profileImages.full, msgEl, "전신 이미지");
      payload.skinData.profile.headImage = await resolveProfileImage(profileImages.head, msgEl, "두상 이미지");
    }
    // SCRIPT: 로그 아카이브를 나루 미디어에 올리고 세션 정보와 함께 저장
    if (skin === "SCRIPT") {
      const archiveInfo = await scriptWriter.prepareScriptArchive({
        container: document.getElementById("scriptFields"),
        uploader,
        existingScript, job: scriptJob, uploadSession
      });
      const archive = {};
      SCRIPT_ARCHIVE_KEYS.forEach((key) => {
        if (archiveInfo[key] != null && archiveInfo[key] !== "") archive[key] = archiveInfo[key];
      });
      payload.skinData = { script: { ...scriptFields, ...archive } };
    }
    const { id } = await runMutate("post:write", payload);
    postSaved = true;
    location.href = skin === "LOG" || skin === "GALLERY" || skin === "BOOKMARK"
      ? `board.html?bo=${encodeURIComponent(boardId)}`
      : `view.html?id=${encodeURIComponent(id)}&bo=${encodeURIComponent(boardId)}`;
  } catch (error) {
    if (error?.details?.needProfile) {
      await promptNickname("글을 쓰려면 닉네임이 필요합니다. 사용할 닉네임을 입력하세요.");
      return;
    }
    if (error?.field === "scriptFile") focusAfterSave = "[data-script-file-select]";
    alertMsg(msgEl, naruErrorMessage(error, "등록에 실패했습니다."));
  } finally {
    setWriteSaving(false);
    scriptWriter?.setScriptWriterBusy?.(document.getElementById("scriptFields"), false);
    if (focusAfterSave) focusWriteField(focusAfterSave);
    if (postSaved) {
      const saveBtn = document.getElementById("saveBtn");
      if (saveBtn) saveBtn.disabled = true;
    }
  }
}

const LOCKED_WRITE_EVENTS = ["click", "input", "change", "drop", "paste", "keydown"];
function blockWhileSaving(event) {
  if (!saving) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}
function setWriteSaving(value) {
  saving = value;
  const form = document.getElementById("writeForm");
  form?.setAttribute("aria-busy", String(value));
  if (value) {
    form?.querySelectorAll("input, select, textarea, button").forEach((control) => {
      disabledBeforeSave.set(control, control.disabled);
      control.disabled = true;
    });
    LOCKED_WRITE_EVENTS.forEach((type) => form?.addEventListener(type, blockWhileSaving, true));
  } else {
    for (const [control, disabled] of disabledBeforeSave) control.disabled = disabled;
    disabledBeforeSave.clear();
    LOCKED_WRITE_EVENTS.forEach((type) => form?.removeEventListener(type, blockWhileSaving, true));
  }
}

function showUploadMsg(text) {
  const el = document.getElementById("uploadMsg");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("hidden", !text);
}

// 등록 실패를 놓치지 않도록 알림창으로도 보여준다
function alertMsg(el, text, target = null) {
  showNotice(el, text);
  window.alert(text);
  if (target) focusWriteField(target);
}

function thumbnailFocusTarget() {
  return document.getElementById("thumbModeUrl")?.checked ? "#imageUrlInput" : "#selectThumbFileBtn";
}

function focusWriteField(selector) {
  const field = document.querySelector(selector);
  if (!field) return;
  for (let hidden = field.closest(".hidden"); hidden; hidden = field.closest(".hidden")) hidden.classList.remove("hidden");
  for (let details = field.closest("details"); details; details = details.parentElement?.closest("details")) details.open = true;
  if (!field.matches("input, select, textarea, button, a[href], summary, [tabindex]")) field.setAttribute("tabindex", "-1");
  field.setAttribute("aria-invalid", "true");
  field.scrollIntoView?.({ behavior: "smooth", block: "center" });
  field.focus({ preventScroll: true });
}

function clearInvalidField(event) {
  const region = event.target.closest?.(".write-row, details") || event.target;
  region.removeAttribute?.("aria-invalid");
  region.querySelectorAll?.('[aria-invalid="true"]').forEach((field) => field.removeAttribute("aria-invalid"));
}

init();
