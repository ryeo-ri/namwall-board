import { auth } from "../core/firebase.js";
import { getAuthSnapshot, logoutAdmin } from "../core/state.js";
import {
  signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const msgEl = document.getElementById("adminMsg");

function showMsg(text, isError = false) {
  msgEl.classList.remove("hidden");
  msgEl.textContent = text;
  msgEl.style.borderColor = isError ? "rgba(220,38,38,.45)" : "rgba(15,23,42,.18)";
}

async function onLogin() {
  const email = document.getElementById("adminEmail")?.value?.trim();
  const pw = document.getElementById("adminPassword")?.value || "";

  if (!email || !pw) {
    showMsg("이메일/비밀번호를 입력하세요.", true);
    return;
  }

  try {
    await signInWithEmailAndPassword(auth, email, pw);
    const state = await getAuthSnapshot();

    if (!state.isAdmin) {
      await logoutAdmin();
      showMsg("로그인 성공, 하지만 admin_users 권한이 없습니다.", true);
      return;
    }

    showMsg("관리자 로그인 성공");
    location.href = "/admin/index.html";
  } catch (error) {
    showMsg(`로그인 실패: ${error.message}`, true);
  }
}

async function onLogout() {
  await logoutAdmin();
  showMsg("로그아웃 완료");
}

document.getElementById("adminLoginBtn")?.addEventListener("click", onLogin);
document.getElementById("adminLogoutBtn")?.addEventListener("click", onLogout);
document.getElementById("adminPassword")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") onLogin();
});

(async () => {
  const state = await getAuthSnapshot();
  if (state.isAdmin) {
    location.href = "/admin/index.html";
    return;
  }
  showMsg("관리자 계정으로 로그인하세요.");
})();
