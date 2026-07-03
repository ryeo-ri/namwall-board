import { app, db } from "../core/firebase.js";
import { ensureAdminPageAccess } from "../core/state.js";
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
  const uid = (document.getElementById("adminUidInput")?.value || "").trim();
  const nickname = (document.getElementById("adminNicknameInput")?.value || "").trim();
  const role = (document.getElementById("adminRoleInput")?.value || "ADMIN").trim();

  if (!uid) return showMsg("UID를 입력하세요.", true);
  if (!nickname) return showMsg("닉네임을 입력하세요.", true);

  await setDoc(doc(db, "admin_users", uid), {
    nickname,
    role: role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "ADMIN",
    createdAt: serverTimestamp()
  }, { merge: true });

  showMsg("관리자 프로필 저장 완료");
  await loadAdmins();
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}

(async () => {
  const access = await ensureAdminPageAccess();
  if (!access.ok) return;

  const projectId = app?.options?.projectId || "";
  const consoleLink = document.getElementById("authConsoleLink");
  if (consoleLink && projectId) {
    consoleLink.href = `https://console.firebase.google.com/project/${encodeURIComponent(projectId)}/authentication/users`;
  }

  document.getElementById("saveAdminProfileBtn")?.addEventListener("click", saveAdminProfile);
  await loadAdmins();
})();
