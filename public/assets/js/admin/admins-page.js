import { db } from "../core/firebase.js";
import { ensureAdminPageAccess } from "../core/state.js";
import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
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

async function loadAdmins() {
  const q = query(collection(db, "admin_users"), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);

  if (snap.empty) {
    listEl.innerHTML = '<div class="notice">admin_users 문서가 없습니다.</div>';
    return;
  }

  listEl.innerHTML = snap.docs.map((item) => {
    const data = item.data();
    return `
      <article class="card">
        <div><strong>${item.id}</strong></div>
        <div class="muted small">nickname: ${escapeHtml(data.nickname || "")}</div>
        <div class="muted small">role: ${escapeHtml(data.role || "ADMIN")}</div>
        <div class="muted small">createdAt: ${dateToString(data.createdAt)}</div>
      </article>
    `;
  }).join("");
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

  document.getElementById("saveAdminProfileBtn")?.addEventListener("click", saveAdminProfile);
  await loadAdmins();
})();
