// 첫 실행 설정 마법사 — 첫 관리자 등록 + bootstrap 표식 기록으로 사이트 활성화.
// 규칙(firestore.rules)의 admin_users create / site_settings/bootstrap create 예외가
// bootstrap 표식이 없을 때 최초 1회만 열려 있어 동작한다.
import { auth, db } from "../core/firebase.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const BOOTSTRAP_FLAG = "archive_bootstrapped_v1";
const bootstrapRef = doc(db, "site_settings", "bootstrap");

const connTextEl = document.getElementById("connText");
const connDotEl = document.querySelector(".setup-status-dot");
const connHelpEl = document.getElementById("connHelp");
const msgEl = document.getElementById("setupMsg");
const submitBtn = document.getElementById("setupSubmitBtn");

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
    const snap = await getDoc(bootstrapRef);
    if (snap.exists()) {
      setConn("ok", "이미 설정이 완료된 사이트입니다.");
      showMsg("설정이 이미 끝났습니다. 홈으로 이동합니다.");
      setTimeout(() => markBootstrappedAndGoHome("index.html"), 1200);
      if (submitBtn) submitBtn.disabled = true;
      return;
    }
    setConn("ok", "Firebase 연결 정상 — 아직 미설정 상태입니다. 아래에서 관리자를 등록하세요.");
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

  if (!email) return showMsg("이메일을 입력하세요.", true);
  if (password.length < 6) return showMsg("비밀번호는 6자 이상이어야 합니다.", true);

  submitBtn.disabled = true;
  showMsg("처리 중…");

  try {
    // 이미 표식이 있으면(경쟁/재방문) 중단
    const existing = await getDoc(bootstrapRef);
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
    await setDoc(bootstrapRef, {
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

submitBtn?.addEventListener("click", submitSetup);
checkConnection();
