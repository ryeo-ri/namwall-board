import { ensureAdminPageAccess, logoutAdmin, getAuthSnapshot } from "../core/state.js";

const dashboardEl = document.getElementById("adminDashboard");
const infoBox = document.getElementById("adminInfo");

async function init() {
  const access = await ensureAdminPageAccess();
  if (!access.ok) return;

  dashboardEl?.classList.remove("hidden");
  const state = await getAuthSnapshot();
  const email = state.user?.email || "unknown";
  const uid = state.user?.uid || "";
  infoBox.textContent = `로그인: ${email} / uid: ${uid} / role: ADMIN`;
}

document.getElementById("logoutBtn")?.addEventListener("click", async () => {
  await logoutAdmin();
  location.href = "admin/login.html";
});

init();
