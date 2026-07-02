import { db } from "../core/firebase.js";
import { ensureAdminPageAccess, sha256Hex } from "../core/state.js";
import {
  deleteField,
  doc,
  getDoc,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const infoEl = document.getElementById("guestInfo");
const msgEl = document.getElementById("guestMsg");

let currentVersion = 0;

function showMsg(text, isError = false) {
  msgEl.classList.remove("hidden");
  msgEl.textContent = text;
  msgEl.style.borderColor = isError ? "rgba(220,38,38,.45)" : "rgba(15,23,42,.18)";
}

async function loadGuestSetting() {
  const ref = doc(db, "site_settings", "guest");
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    infoEl.textContent = "guest 설정이 없습니다. 새 코드를 저장하면 생성됩니다.";
    currentVersion = 0;
    return;
  }

  const data = snap.data() || {};
  currentVersion = Number(data.codeVersion || 0);
  infoEl.textContent = `현재 codeVersion: ${currentVersion}`;
}

async function saveGuestCode() {
  const plainCode = (document.getElementById("guestCodeInput")?.value || "").trim();
  if (plainCode.length < 4) {
    showMsg("코드는 최소 4자 이상 입력하세요.", true);
    return;
  }

  const codeHash = await sha256Hex(plainCode);
  const nextVersion = currentVersion + 1;

  await setDoc(doc(db, "site_settings", "guest"), {
    codeHash,
    codeSalt: deleteField(),
    codeVersion: nextVersion,
    updatedAt: serverTimestamp()
  }, { merge: true });

  currentVersion = nextVersion;
  infoEl.textContent = `현재 codeVersion: ${currentVersion}`;
  document.getElementById("guestCodeInput").value = "";
  showMsg("게스트 코드 저장 완료 (version 증가)");
}

(async () => {
  const access = await ensureAdminPageAccess();
  if (!access.ok) return;

  document.getElementById("saveGuestCodeBtn")?.addEventListener("click", saveGuestCode);
  await loadGuestSetting();
})();
