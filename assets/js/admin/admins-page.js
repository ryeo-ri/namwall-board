import { app, db } from "../core/firebase.js";
import { ensureAdminPageAccess } from "../core/state.js";
import {
  deleteApp,
  initializeApp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const listEl = document.getElementById("adminsList");
const msgEl = document.getElementById("adminProfileMsg");

function showMsg(text, isError = false) {
  if (!msgEl) return;
  msgEl.classList.remove("hidden");
  msgEl.textContent = text;
  msgEl.style.borderColor = isError ? "rgba(220,38,38,.45)" : "rgba(15,23,42,.18)";
}

function dateToString(value) {
  const d = value?.toDate ? value.toDate() : (value ? new Date(value) : null);
  if (!d || Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ko-KR");
}

function createdAtMillis(value) {
  const d = value?.toDate ? value.toDate() : (value ? new Date(value) : null);
  return d && !Number.isNaN(d.getTime()) ? d.getTime() : 0;
}

async function loadAdmins() {
  // Fetch without orderBy so admins whose doc lacks createdAt (e.g. the first
  // bootstrap admin created directly in Firestore) are still listed.
  const snap = await getDocs(collection(db, "admin_users"));

  if (snap.empty) {
    listEl.innerHTML = '<div class="notice">admin_users 문서가 없습니다.</div>';
    return;
  }

  const admins = snap.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .sort((a, b) => createdAtMillis(b.createdAt) - createdAtMillis(a.createdAt));

  listEl.innerHTML = admins.map((data) => `
      <article class="card">
        <div><strong>${escapeHtml(data.id)}</strong></div>
        <div class="muted small">nickname: ${escapeHtml(data.nickname || "(없음)")}</div>
        <div class="muted small">role: ${escapeHtml(data.role || "ADMIN")}</div>
        <div class="muted small">createdAt: ${dateToString(data.createdAt)}</div>
      </article>
    `).join("");
}

async function saveAdminProfile() {
  const emailInput = document.getElementById("adminEmailInput");
  const passwordInput = document.getElementById("adminPasswordInput");
  const passwordConfirmInput = document.getElementById("adminPasswordConfirmInput");
  const nicknameInput = document.getElementById("adminNicknameInput");
  const roleInput = document.getElementById("adminRoleInput");
  const submitButton = document.getElementById("saveAdminProfileBtn");
  const email = (emailInput?.value || "").trim();
  const password = passwordInput?.value || "";
  const passwordConfirm = passwordConfirmInput?.value || "";
  const nickname = (nicknameInput?.value || "").trim();
  const role = (roleInput?.value || "ADMIN").trim();

  if (!email) return showMsg("새 관리자의 이메일을 입력하세요.", true);
  if (password.length < 6) return showMsg("비밀번호는 6자 이상이어야 합니다.", true);
  if (password !== passwordConfirm) return showMsg("비밀번호 확인이 일치하지 않습니다.", true);
  if (!nickname) return showMsg("닉네임을 입력하세요.", true);

  let secondaryApp = null;
  let secondaryAuth = null;
  let createdUser = null;
  let profileSaved = false;
  if (submitButton) submitButton.disabled = true;
  showMsg("새 관리자 계정을 추가하는 중입니다.");

  try {
    secondaryApp = initializeApp(app.options, `admin-create-${Date.now()}`);
    secondaryAuth = getAuth(secondaryApp);
    const credential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    createdUser = credential.user;

    await setDoc(doc(db, "admin_users", createdUser.uid), {
      nickname,
      role: role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "ADMIN",
      createdAt: serverTimestamp()
    });
    profileSaved = true;

    if (emailInput) emailInput.value = "";
    if (passwordInput) passwordInput.value = "";
    if (passwordConfirmInput) passwordConfirmInput.value = "";
    if (nicknameInput) nicknameInput.value = "";
    if (roleInput) roleInput.value = "ADMIN";

    showMsg("새 관리자 계정과 프로필을 추가했습니다.");
    await loadAdmins();
  } catch (error) {
    if (createdUser && !profileSaved) {
      try {
        await deleteUser(createdUser);
      } catch (rollbackError) {
        console.error("새 관리자 계정 롤백 실패:", rollbackError);
      }
    }
    console.error("새 관리자 추가 실패:", error);
    showMsg(mapAdminCreateError(error), true);
  } finally {
    if (secondaryAuth) {
      try { await signOut(secondaryAuth); } catch (_error) { /* ignore */ }
    }
    if (secondaryApp) {
      try { await deleteApp(secondaryApp); } catch (_error) { /* ignore */ }
    }
    if (submitButton) submitButton.disabled = false;
  }
}

function mapAdminCreateError(error) {
  const code = error?.code || "";
  if (code === "auth/email-already-in-use") return "이미 등록된 이메일입니다.";
  if (code === "auth/invalid-email") return "이메일 형식이 올바르지 않습니다.";
  if (code === "auth/weak-password") return "비밀번호가 너무 약합니다. 6자 이상으로 설정하세요.";
  if (code === "auth/operation-not-allowed") return "이메일/비밀번호 로그인이 사용 설정되어 있지 않습니다.";
  if (code === "permission-denied" || /permission/i.test(error?.message || "")) {
    return "관리자 프로필을 저장할 권한이 없습니다.";
  }
  return error?.message || "새 관리자 추가에 실패했습니다.";
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}

(async () => {
  const access = await ensureAdminPageAccess();
  if (!access.ok) return;

  document.getElementById("saveAdminProfileBtn")?.addEventListener("click", saveAdminProfile);
  await loadAdmins();
})();
