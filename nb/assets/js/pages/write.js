// 글쓰기/수정 — 관리자 또는 (회원 글쓰기가 켜진 게시판의) 회원
// 원본 폼 흐름: 게시판 고정 → 썸네일(파일/URL) → 공개범위 → 제목 → 본문 → 추가 이미지(staged) → 태그
// 파일은 staged 목록에 들고 있다가 저장 시점에 실제 업로드한다.
import { getAdminSession, getMemberSession, signInAdmin, signInMember, runQuery, runMutate, naruErrorMessage } from "../core/naru-client.js";
import { renderHeader, getBoardById, promptNickname, escapeHtml, ownerDisplayName } from "../core/site.js";
import { normalizeSkinType } from "../shared/skins.js";

let uploader = null;        // media.upload 핸들 (관리자 또는 회원)
let editingId = 0;
let currentBoard = null;
let thumbStaged = null;     // { blob?, url?, previewUrl }
let extraStaged = [];       // [{ blob?, url?, name, previewUrl }]
let scriptWriter = null;    // SCRIPT 스킨 모듈 (필요할 때만 로드)
let editingScriptData = null; // 수정 모드의 기존 script 데이터
// PROFILE 스킨: 전신/두상 이미지 staged 파일 (저장 시 업로드)
const profileImageStaged = { full: null, head: null }; // { blob, previewUrl } | null

// 아카이브 업로드 결과에서 글에 저장할 키 (세션 정보 입력값과 분리)
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

  // 게시판 선택: bo 파라미터가 있으면 고정, 없으면 select 노출
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
        showMsg(msgEl, "이 글을 수정할 권한이 없습니다.");
        formEl?.classList.add("hidden");
        return;
      }
      editingId = post.id;
      setText("writeHeading", "게시물 수정");
      setValue("titleInput", post.title);
      setValue("contentInput", post.body);
      setValue("tagsInput", (post.tags || []).join(", "));
      setValue("sourceInput", post.source || "");
      if (post.logNo) setValue("logNumberInput", String(post.logNo));
      currentBoard = getBoardById(boot.boards, post.boardId) || currentBoard;
      setText("boardCurrentValue", currentBoard?.title || post.boardId);
      document.getElementById("visibilityInput").value = post.isSecret ? "secret" : (post.memberOnly ? "members" : "public");
      document.getElementById("secretPwWrap")?.classList.toggle("hidden", !post.isSecret);
      if (post.thumb) {
        thumbStaged = { url: post.thumb, previewUrl: post.thumb };
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
      renderThumbPreview();
      renderExtraList();
    } catch (error) {
      showMsg(msgEl, naruErrorMessage(error, "게시물을 불러오지 못했습니다."));
      return;
    }
  }

  bindThumbControls();
  bindExtraControls();
  bindVisibility();
  bindProfileImageControls();
  document.getElementById("saveBtn")?.addEventListener("click", () => save(boot, msgEl));
  const cancel = document.getElementById("cancelBtn");
  if (cancel && currentBoard) cancel.href = `board.html?bo=${encodeURIComponent(currentBoard.id)}`;
}

/* ── 스킨별 필드 표시: GALLERY(출처) / LOG(로그번호) / SCRIPT(세션 정보) / PROFILE(프로필 정보) ── */
function applySkinFields(boot) {
  const boardSelect = document.getElementById("boardSelect");
  if (!currentBoard || (boardSelect && !boardSelect.classList.contains("hidden"))) {
    currentBoard = getBoardById(boot.boards, boardSelect?.value || "") || currentBoard;
  }
  const skin = currentBoard ? normalizeSkinType(currentBoard) : "BOARD";
  document.getElementById("logOnlyFields")?.classList.toggle("hidden", skin !== "LOG");
  document.getElementById("galleryOnlyFields")?.classList.toggle("hidden", skin !== "GALLERY");
  const titleInput = document.getElementById("titleInput");
  if (titleInput) {
    titleInput.placeholder = (skin === "GALLERY" || skin === "LOG") ? "제목 (선택)" : (skin === "PROFILE" ? "캐릭터 이름" : "제목");
  }

  // SCRIPT: 세션 정보+로그 가져오기 표시 / PROFILE: 프로필 정보 표시 — 둘 다 본문 숨김
  const isScript = skin === "SCRIPT";
  const isProfile = skin === "PROFILE";
  document.getElementById("scriptFields")?.classList.toggle("hidden", !isScript);
  document.getElementById("profileFields")?.classList.toggle("hidden", !isProfile);
  document.getElementById("contentFields")?.classList.toggle("hidden", isScript || isProfile);
  document.getElementById("extraFields")?.classList.toggle("hidden", isScript);
  document.body.classList.toggle("script-write-page", isScript);
  if (isScript) {
    import("../skins/script-writer.js").then((module) => {
      scriptWriter = module;
      module.bindScriptWriter(document.getElementById("scriptFields"), editingScriptData);
    });
  }
}

/* ── PROFILE: 전신/두상 이미지 — URL 직접 입력 또는 파일(저장 시 업로드) ── */
const PROFILE_IMAGE_IDS = {
  full: { input: "profileFullBodyInput", button: "profileFullBodyFileBtn", file: "profileFullBodyFile", preview: "profileFullBodyPreview" },
  head: { input: "profileHeadInput", button: "profileHeadFileBtn", file: "profileHeadFile", preview: "profileHeadPreview" }
};

function bindProfileImageControls() {
  Object.entries(PROFILE_IMAGE_IDS).forEach(([slot, ids]) => {
    const fileInput = document.getElementById(ids.file);
    document.getElementById(ids.button)?.addEventListener("click", () => fileInput?.click());
    fileInput?.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      fileInput.value = "";
      if (!file || !/^image\//i.test(file.type || "")) return;
      if (profileImageStaged[slot]) URL.revokeObjectURL(profileImageStaged[slot].previewUrl);
      profileImageStaged[slot] = { blob: file, previewUrl: URL.createObjectURL(file) };
      renderProfileImagePreview(slot);
    });
    document.getElementById(ids.input)?.addEventListener("input", () => {
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

// staged 파일이 있으면 업로드하고, 없으면 입력된 URL을 그대로 쓴다
async function resolveProfileImage(slot, msgEl, label) {
  const staged = profileImageStaged[slot];
  if (staged?.blob) {
    showMsg(msgEl, `${label} 업로드 중…`);
    const uploaded = await uploader.media.upload(staged.blob);
    return uploaded.url;
  }
  return getValue(PROFILE_IMAGE_IDS[slot].input).trim();
}

/* ── 썸네일: 파일/URL 모드, staged ── */
function bindThumbControls() {
  const fileRadio = document.getElementById("thumbModeFile");
  const urlRadio = document.getElementById("thumbModeUrl");
  const fileFields = document.getElementById("thumbFileFields");
  const urlFields = document.getElementById("thumbUrlFields");
  const applyMode = () => {
    const isFile = fileRadio?.checked !== false && !urlRadio?.checked;
    fileFields?.classList.toggle("hidden", !isFile);
    urlFields?.classList.toggle("hidden", isFile);
  };
  fileRadio?.addEventListener("change", applyMode);
  urlRadio?.addEventListener("change", applyMode);

  const fileInput = document.getElementById("thumbFileInput");
  const dropZone = document.getElementById("thumbDropZone");
  const pickFile = (file) => {
    if (!file || !/^image\//i.test(file.type || "")) return;
    if (thumbStaged?.blob && thumbStaged.previewUrl) URL.revokeObjectURL(thumbStaged.previewUrl);
    thumbStaged = { blob: file, previewUrl: URL.createObjectURL(file) };
    document.getElementById("clearThumbFileBtn")?.classList.remove("hidden");
    renderThumbPreview();
  };
  document.getElementById("selectThumbFileBtn")?.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("change", () => {
    pickFile(fileInput.files?.[0]);
    fileInput.value = "";
  });
  dropZone?.addEventListener("dragover", (event) => { event.preventDefault(); });
  dropZone?.addEventListener("drop", (event) => {
    event.preventDefault();
    pickFile(event.dataTransfer?.files?.[0]);
  });
  dropZone?.addEventListener("paste", (event) => {
    const file = Array.from(event.clipboardData?.files || []).find((item) => /^image\//i.test(item.type || ""));
    if (file) { event.preventDefault(); pickFile(file); }
  });
  document.getElementById("clearThumbFileBtn")?.addEventListener("click", () => {
    if (thumbStaged?.blob && thumbStaged.previewUrl) URL.revokeObjectURL(thumbStaged.previewUrl);
    thumbStaged = null;
    document.getElementById("clearThumbFileBtn")?.classList.add("hidden");
    renderThumbPreview();
  });
  document.getElementById("imageUrlInput")?.addEventListener("change", (event) => {
    const url = String(event.target.value || "").trim();
    thumbStaged = url ? { url, previewUrl: url } : null;
    renderThumbPreview();
  });
}

function renderThumbPreview() {
  const preview = document.getElementById("thumbPreview");
  if (!preview) return;
  preview.innerHTML = thumbStaged
    ? `<div class="previewItem"><img class="previewImage" src="${escapeHtml(thumbStaged.previewUrl)}" alt="썸네일 미리보기"></div>`
    : "";
}

/* ── 추가 이미지: staged 목록 (저장 시 업로드) ──
   파일은 고르는 즉시 목록에 담기고('추가' 버튼 불필요), URL 모드만 '추가'로 담는다. */
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
    addRow?.classList.toggle("hidden", isFile); // 파일 모드는 자동 추가
  };
  fileRadio?.addEventListener("change", applyMode);
  urlRadio?.addEventListener("change", applyMode);
  applyMode();

  const fileInput = document.getElementById("extraFileInput");
  const addFiles = (files) => {
    const incoming = Array.from(files || []).filter((file) => /^image\//i.test(file.type || ""));
    if (!incoming.length) return;
    incoming.forEach((file) => {
      extraStaged.push({ blob: file, name: file.name || "", previewUrl: URL.createObjectURL(file) });
    });
    showUploadMsg("");
    renderExtraList();
  };
  document.getElementById("selectExtraFileBtn")?.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("change", () => { addFiles(fileInput.files); fileInput.value = ""; });
  const dropZone = document.getElementById("extraDropZone");
  dropZone?.addEventListener("dragover", (event) => event.preventDefault());
  dropZone?.addEventListener("drop", (event) => {
    event.preventDefault();
    addFiles(event.dataTransfer?.files);
  });
  dropZone?.addEventListener("paste", (event) => {
    const files = Array.from(event.clipboardData?.files || []).filter((item) => /^image\//i.test(item.type || ""));
    if (files.length) { event.preventDefault(); addFiles(files); }
  });

  // URL 모드: '추가' 버튼으로 담는다
  addBtn?.addEventListener("click", () => {
    const urlInput = document.getElementById("extraImageUrlInput");
    const url = String(urlInput?.value || "").trim();
    if (!url) return showUploadMsg("URL을 입력하세요.");
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

/* ── 저장: staged 파일 업로드 → 뮤테이션 ── */
async function save(boot, msgEl) {
  if (!currentBoard) return alertMsg(msgEl, "게시판을 선택하세요.");
  const skin = normalizeSkinType(currentBoard);
  const title = getValue("titleInput").trim();
  const body = getValue("contentInput");
  const source = getValue("sourceInput").trim();
  const visibility = document.getElementById("visibilityInput")?.value || "public";
  const isSecret = visibility === "secret";
  const secretPw = getValue("secretPwInput");

  if (skin !== "GALLERY" && skin !== "LOG" && !title) return alertMsg(msgEl, "제목을 입력하세요.");
  if (skin === "SCRIPT" && !thumbStaged) return alertMsg(msgEl, "대표 이미지를 선택하세요.");
  if (isSecret && !secretPw && !editingId) return alertMsg(msgEl, "비밀글 비밀번호를 입력하세요.");

  const saveBtn = document.getElementById("saveBtn");
  if (saveBtn) saveBtn.disabled = true;
  try {
    // staged 파일 업로드 (저장 시점)
    let thumbUrl = "";
    if (thumbStaged) {
      if (thumbStaged.blob) {
        showMsg(msgEl, "대표 이미지 업로드 중…");
        const uploaded = await uploader.media.upload(thumbStaged.blob);
        thumbUrl = uploaded.url;
      } else {
        thumbUrl = thumbStaged.url || "";
      }
    }
    const extras = [];
    for (const item of extraStaged) {
      if (item.blob) {
        showMsg(msgEl, `${item.name || "이미지"} 업로드 중…`);
        const uploaded = await uploader.media.upload(item.blob);
        extras.push({ url: uploaded.url, name: item.name || uploaded.name || "" });
      } else if (item.url) {
        extras.push({ url: item.url, name: item.name || "" });
      }
    }

    const payload = {
      board: currentBoard.id,
      title,
      body,
      thumb: thumbUrl,
      source,
      tags: getValue("tagsInput"),
      secret: isSecret,
      memberOnly: visibility === "members"
    };
    // 갤러리: 추가 이미지는 다운로드 첨부로, 그 외: 본문 인라인 이미지로
    if (skin === "GALLERY") {
      payload.attachments = extras;
      payload.images = [];
    } else {
      payload.images = extras.map((item) => item.url);
      payload.attachments = [];
    }
    if (skin === "LOG") {
      const logNo = Number(getValue("logNumberInput")) || 0;
      if (logNo) payload.logNo = logNo;
    }
    // PROFILE: 전신/두상 이미지 업로드 후 프로필 정보와 함께 저장
    if (skin === "PROFILE") {
      const fullBodyImage = await resolveProfileImage("full", msgEl, "전신 이미지");
      const headImage = await resolveProfileImage("head", msgEl, "두상 이미지");
      payload.skinData = {
        profile: {
          nameEn: getValue("profileNameEnInput").trim(),
          oneLine: getValue("profileOneLineInput").trim(),
          fullBodyImage,
          headImage,
          appearance: getValue("profileAppearanceInput").trim(),
          personality: getValue("profilePersonalityInput").trim(),
          etc: getValue("profileEtcInput").trim(),
          etcIsHtml: Boolean(document.getElementById("profileEtcHtmlInput")?.checked),
          meta: {
            age: getValue("profileAgeInput").trim(),
            gender: getValue("profileGenderInput").trim(),
            height: getValue("profileHeightInput").trim()
          }
        }
      };
    }
    // SCRIPT: 로그 아카이브를 나루 미디어에 올리고 세션 정보와 함께 저장
    if (skin === "SCRIPT") {
      if (!scriptWriter) scriptWriter = await import("../skins/script-writer.js");
      const archiveInfo = await scriptWriter.prepareScriptArchive({
        container: document.getElementById("scriptFields"),
        uploader,
        existingScript: editingScriptData
      });
      const archive = {};
      SCRIPT_ARCHIVE_KEYS.forEach((key) => {
        if (archiveInfo[key] != null && archiveInfo[key] !== "") archive[key] = archiveInfo[key];
      });
      payload.images = [];
      payload.attachments = [];
      payload.skinData = {
        script: {
          system: getValue("scriptSystemInput").trim(),
          scenario: getValue("scriptScenarioInput").trim(),
          gm: getValue("scriptGmInput").trim(),
          players: getValue("scriptPlayersInput").trim(),
          playedAt: getValue("scriptPlayedAtInput").trim(),
          summary: getValue("scriptSummaryInput").trim(),
          ...archive
        }
      };
    }
    if (editingId) payload.id = editingId;
    if (isSecret && secretPw) payload.password = secretPw;

    const { id } = await runMutate("post:write", payload);
    location.href = skin === "LOG" || skin === "GALLERY"
      ? `board.html?bo=${encodeURIComponent(currentBoard.id)}`
      : `view.html?id=${encodeURIComponent(id)}&bo=${encodeURIComponent(currentBoard.id)}`;
  } catch (error) {
    if (error?.details?.needProfile) {
      if (saveBtn) saveBtn.disabled = false;
      await promptNickname("글을 쓰려면 닉네임이 필요합니다. 사용할 닉네임을 입력하세요.");
      return;
    }
    alertMsg(msgEl, naruErrorMessage(error, "등록에 실패했습니다."));
    if (saveBtn) saveBtn.disabled = false;
  }
}

function showUploadMsg(text) {
  const el = document.getElementById("uploadMsg");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("hidden", !text);
}

function getValue(id) { return document.getElementById(id)?.value || ""; }
function setValue(id, value) { const el = document.getElementById(id); if (el) el.value = value || ""; }
function setText(id, value) { const el = document.getElementById(id); if (el) el.textContent = value; }
function showMsg(el, text) {
  if (!el) return;
  el.textContent = text;
  el.classList.remove("hidden");
}
// 등록 실패를 놓치지 않도록 알림창으로도 함께 보여준다
function alertMsg(el, text) {
  showMsg(el, text);
  window.alert(text);
}

init();
