// 첫 실행 설정 마법사 — 첫 관리자 등록 + bootstrap 표식 기록으로 사이트 활성화.
// 규칙(firestore.rules)의 admin_users create / site_settings/bootstrap create 예외가
// bootstrap 표식이 없을 때 최초 1회만 열려 있어 동작한다.
import { auth, db, configMissing } from "../core/firebase.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const BOOTSTRAP_FLAG = "archive_bootstrapped_v1";
// db가 아직 초기화되지 않았을 수 있으므로(설정 미기입) 참조는 지연 생성
const getBootstrapRef = () => doc(db, "site_settings", "bootstrap");

const connTextEl = document.getElementById("connText");
const connDotEl = document.querySelector(".setup-status-dot");
const connHelpEl = document.getElementById("connHelp");
const msgEl = document.getElementById("setupMsg");
const submitBtn = document.getElementById("setupSubmitBtn");
const configPasteEl = document.getElementById("setupConfigPaste");
const configBuildBtn = document.getElementById("setupConfigBuildBtn");
const configResultEl = document.getElementById("setupConfigResult");
const indexHelperEl = document.getElementById("indexHelper");
const indexListEl = document.getElementById("indexList");
const indexRecheckBtn = document.getElementById("indexRecheckBtn");

// ?stay=1 — 설정 완료된 사이트에서도 자동 이동 없이 안내/점검 화면을 볼 수 있게
const stayRequested = new URLSearchParams(location.search).has("stay");

function setConn(state, text, help = "") {
  if (connDotEl) connDotEl.dataset.state = state; // checking | ok | error
  if (connTextEl) connTextEl.textContent = text;
  if (connHelpEl) {
    connHelpEl.classList.toggle("hidden", !help);
    connHelpEl.innerHTML = help;
  }
}

function showMsg(text, isError = false) {
  if (!msgEl) return;
  msgEl.classList.remove("hidden");
  msgEl.classList.toggle("notice-error", isError);
  msgEl.textContent = text;
}

function markBootstrappedAndGoHome(target = "admin/index.html") {
  try { localStorage.setItem(BOOTSTRAP_FLAG, "1"); } catch (_error) { /* ignore */ }
  location.replace(target);
}

async function checkConnection() {
  try {
    const snap = await getDoc(getBootstrapRef());
    if (snap.exists()) {
      if (stayRequested) {
        setConn("ok", "이미 설정이 완료된 사이트입니다. (점검 모드 — 자동 이동하지 않습니다)");
        if (submitBtn) submitBtn.disabled = true;
        runIndexCheck();
        return;
      }
      setConn("ok", "이미 설정이 완료된 사이트입니다.");
      showMsg("설정이 이미 끝났습니다. 홈으로 이동합니다.");
      setTimeout(() => markBootstrappedAndGoHome("index.html"), 1200);
      if (submitBtn) submitBtn.disabled = true;
      return;
    }
    setConn("ok", "Firebase 연결 정상 — 아직 미설정 상태입니다. 아래에서 관리자를 등록하세요.");
    runIndexCheck();
  } catch (error) {
    console.warn("connection check failed:", error);
    setConn(
      "error",
      "Firebase에 연결하지 못했습니다.",
      "다음을 확인하세요:<br>• <code>firebase.js</code>의 <code>firebaseConfig</code>를 본인 프로젝트 값으로 교체했는지<br>• Firestore <strong>규칙</strong>을 콘솔에 붙여넣고 <strong>게시</strong>했는지<br>• Firestore 데이터베이스를 생성했는지"
    );
  }
}

async function submitSetup() {
  const nickname = (document.getElementById("setupNickname")?.value || "").trim() || "관리자";
  const email = (document.getElementById("setupEmail")?.value || "").trim();
  const password = document.getElementById("setupPassword")?.value || "";
  const passwordConfirm = document.getElementById("setupPasswordConfirm")?.value || "";

  if (!email) return showMsg("이메일을 입력하세요.", true);
  if (password.length < 6) return showMsg("비밀번호는 6자 이상이어야 합니다.", true);
  if (password !== passwordConfirm) return showMsg("비밀번호 확인이 일치하지 않습니다.", true);

  submitBtn.disabled = true;
  showMsg("처리 중…");

  try {
    // 이미 표식이 있으면(경쟁/재방문) 중단
    const existing = await getDoc(getBootstrapRef());
    if (existing.exists()) {
      showMsg("이미 설정이 완료되었습니다. 홈으로 이동합니다.");
      setTimeout(() => markBootstrappedAndGoHome("index.html"), 1000);
      return;
    }

    // 계정 생성 시도 → 이미 있으면 로그인
    let cred;
    try {
      cred = await createUserWithEmailAndPassword(auth, email, password);
    } catch (error) {
      if (error?.code === "auth/email-already-in-use") {
        cred = await signInWithEmailAndPassword(auth, email, password);
      } else {
        throw error;
      }
    }

    const uid = cred.user.uid;

    // 첫 관리자 프로필 + 완료 표식 기록 (규칙상 표식 없을 때만 허용)
    await setDoc(doc(db, "admin_users", uid), {
      nickname,
      role: "ADMIN",
      createdAt: serverTimestamp()
    });
    await setDoc(getBootstrapRef(), {
      adminUid: uid,
      initializedAt: serverTimestamp()
    });

    showMsg("설정 완료! 관리자 대시보드로 이동합니다.");
    setTimeout(() => markBootstrappedAndGoHome("admin/index.html"), 900);
  } catch (error) {
    console.error("setup failed:", error);
    showMsg(mapSetupError(error), true);
    submitBtn.disabled = false;
  }
}

function mapSetupError(error) {
  const code = error?.code || "";
  if (code === "auth/invalid-credential" || code === "auth/wrong-password") {
    return "이미 존재하는 이메일인데 비밀번호가 일치하지 않습니다.";
  }
  if (code === "auth/invalid-email") return "이메일 형식이 올바르지 않습니다.";
  if (code === "auth/weak-password") return "비밀번호가 너무 약합니다. 6자 이상으로 설정하세요.";
  if (code === "auth/operation-not-allowed") {
    return "Authentication에서 이메일/비밀번호 로그인이 켜져 있지 않습니다. 콘솔에서 사용 설정하세요.";
  }
  if (code === "permission-denied" || /permission/i.test(error?.message || "")) {
    return "권한 오류입니다. Firestore 규칙을 콘솔에 게시했는지 확인하세요. (이미 관리자가 있으면 이 화면은 사용할 수 없습니다.)";
  }
  return error?.message || "설정에 실패했습니다.";
}

/* ---------- firebaseConfig 붙여넣기 → firebase.js 파일 생성 ---------- */

const CONFIG_KEYS = ["apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId", "measurementId"];
const REQUIRED_CONFIG_KEYS = ["apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId"];

function parsePastedConfig(raw) {
  const text = String(raw || "");
  const values = {};
  CONFIG_KEYS.forEach((key) => {
    const match = text.match(new RegExp(`["']?${key}["']?\\s*[:=]\\s*["']([^"']+)["']`));
    if (match) values[key] = match[1].trim();
  });
  return values;
}

// 생성될 JS 파일이 깨지지 않도록 따옴표·역슬래시·제어문자 제거
function sanitizeConfigValue(value) {
  return String(value || "").replace(/["'\\\u0000-\u001F\u007F]/g, "").trim();
}

function buildFirebaseJsSource(values) {
  const v = (key) => sanitizeConfigValue(values[key]);
  return `// /assets/js/firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "${v("apiKey")}",
  authDomain: "${v("authDomain")}",
  projectId: "${v("projectId")}",
  storageBucket: "${v("storageBucket")}",
  messagingSenderId: "${v("messagingSenderId")}",
  appId: "${v("appId")}",
  measurementId: "${v("measurementId")}"
};

// config 미기입 가드: 값이 비어 있으면 초기화하지 않고 설정 안내(setup.html)로 보낸다.
export const configMissing = !(firebaseConfig.apiKey && firebaseConfig.projectId);

let app = null;
let auth = null;
let db = null;
let storage = null;

if (!configMissing) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  storage = getStorage(app);
} else if (!location.pathname.endsWith("/setup.html")) {
  location.replace("setup.html"); // <base> 기준 상대 해석 (서브경로 지원)
}

export { app, auth, db, storage };
`;
}

function showConfigResult(text, isError = false) {
  if (!configResultEl) return;
  configResultEl.classList.remove("hidden");
  configResultEl.classList.toggle("notice-error", isError);
  configResultEl.textContent = text;
}

function handleConfigBuild() {
  const values = parsePastedConfig(configPasteEl?.value);
  const missing = REQUIRED_CONFIG_KEYS.filter((key) => !sanitizeConfigValue(values[key]));
  if (missing.length) {
    showConfigResult(
      `붙여넣은 내용에서 ${missing.join(", ")} 값을 찾지 못했습니다. Firebase 콘솔의 firebaseConfig 코드를 통째로 복사해 주세요.`,
      true
    );
    return;
  }

  const source = buildFirebaseJsSource(values);
  const blob = new Blob([source], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "firebase.js";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  showConfigResult(
    `'${sanitizeConfigValue(values.projectId)}' 프로젝트용 firebase.js를 내려받았습니다. ` +
    "받은 파일을 assets/js/core/ 폴더에 덮어씌워 업로드한 뒤 이 페이지를 새로고침하세요."
  );
}

/* ---------- 복합 인덱스 자동 확인 ---------- */

// 실제 화면에서 쓰는 쿼리와 같은 모양으로 실행해, 누락 시 콘솔의 "자동 채움 생성 링크"를 받아온다.
const INDEX_PROBES = [
  {
    key: "boardId-isPublic",
    label: "게시판 목록 (boardId + isPublic)",
    build: (posts) => query(posts, where("boardId", "==", "__setup_probe__"), where("isPublic", "==", true), limit(1))
  },
  {
    key: "isPublic-updatedAt",
    label: "최근 업데이트 (isPublic + updatedAt)",
    build: (posts) => query(posts, where("isPublic", "==", true), orderBy("updatedAt", "desc"), limit(1))
  },
  {
    key: "isPublic-createdAt",
    label: "최근 업데이트 (isPublic + createdAt)",
    build: (posts) => query(posts, where("isPublic", "==", true), orderBy("createdAt", "desc"), limit(1))
  },
  {
    key: "isPublic-contentUpdatedAt",
    label: "최근 업데이트 (isPublic + contentUpdatedAt)",
    build: (posts) => query(posts, where("isPublic", "==", true), orderBy("contentUpdatedAt", "desc"), limit(1))
  }
];

let indexCheckRunning = false;

function renderIndexList(results) {
  if (!indexListEl) return;
  indexListEl.innerHTML = results.map((result) => {
    let statusHtml = "";
    if (result.state === "checking") {
      statusHtml = '<span class="setup-index-status" data-state="checking">확인 중…</span>';
    } else if (result.state === "ok") {
      statusHtml = '<span class="setup-index-status" data-state="ok">사용 가능</span>';
    } else if (result.state === "missing") {
      statusHtml = '<span class="setup-index-status" data-state="missing">누락</span>'
        + (result.link
          ? ` <a class="setup-index-link" href="${escapeAttr(result.link)}" target="_blank" rel="noopener noreferrer">만들기 링크</a>`
          : ' <span class="muted small">콘솔에서 직접 생성 필요</span>');
    } else if (result.state === "blocked") {
      statusHtml = '<span class="setup-index-status" data-state="missing">확인 불가</span> <span class="muted small">규칙 게시 후 다시 확인하세요</span>';
    } else {
      statusHtml = '<span class="setup-index-status" data-state="missing">오류</span>';
    }
    return `<li><span class="setup-index-label">${escapeHtml(result.label)}</span> ${statusHtml}</li>`;
  }).join("");
}

async function probeIndex(probe) {
  try {
    await getDocs(probe.build(collection(db, "posts")));
    return { ...probe, state: "ok" };
  } catch (error) {
    const message = String(error?.message || "");
    if (error?.code === "failed-precondition") {
      const link = (message.match(/https:\/\/console\.firebase\.google\.com[^\s"')\]]+/) || [])[0] || "";
      return { ...probe, state: "missing", link };
    }
    if (error?.code === "permission-denied") return { ...probe, state: "blocked" };
    console.warn(`index probe failed (${probe.key}):`, error);
    return { ...probe, state: "error" };
  }
}

async function runIndexCheck() {
  if (!db || !indexHelperEl || indexCheckRunning) return;
  indexCheckRunning = true;
  if (indexRecheckBtn) indexRecheckBtn.disabled = true;
  indexHelperEl.classList.remove("hidden");
  renderIndexList(INDEX_PROBES.map((probe) => ({ ...probe, state: "checking" })));
  try {
    const results = await Promise.all(INDEX_PROBES.map(probeIndex));
    renderIndexList(results);
  } finally {
    indexCheckRunning = false;
    if (indexRecheckBtn) indexRecheckBtn.disabled = false;
  }
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value || "");
  return div.innerHTML;
}

function escapeAttr(value) {
  return String(value || "").replace(/"/g, "&quot;");
}

configBuildBtn?.addEventListener("click", handleConfigBuild);
indexRecheckBtn?.addEventListener("click", runIndexCheck);
submitBtn?.addEventListener("click", submitSetup);

if (configMissing) {
  // firebaseConfig 미기입: 연결 시도 없이 안내만 표시하고 등록 잠금
  setConn(
    "error",
    "firebaseConfig가 아직 비어 있습니다.",
    "위 1단계(6번)에서 복사한 <code>firebaseConfig</code>를 <code>assets/js/core/firebase.js</code> 파일에 붙여넣고 사이트를 다시 업로드한 뒤, 이 페이지를 새로고침하세요."
  );
  if (submitBtn) submitBtn.disabled = true;
} else {
  checkConnection();
}
