// NARU BOARD Copyright (c) 2026 NAMWALL — MPL-2.0 (https://mozilla.org/MPL/2.0/)
// 관리자 — admin.html 한 페이지에서 해시로 화면 전환 (나루 관리자 로그인은 페이지 URL 단위로 유지된다)
// (없음) 대시보드 · #home 홈 소개 · #boards 게시판 · #design 디자인
import {
  getAdminSession, signInAdmin, signOutAdmin,
  getMemberSession, signInMember, runMutate, naruErrorMessage
} from "../core/naru-client.js";
import { loadBoot, clearSiteCache } from "../core/site.js";
import { showNotice } from "../shared/ui.js";
import { BOARD_VERSION } from "../core/version.js";

const initialized = new Set();

async function init() {
  const admin = await getAdminSession();
  const gate = document.getElementById("adminGate");

  if (!admin) {
    gate?.classList.remove("hidden");
    document.getElementById("adminLoginBtn")?.addEventListener("click", () => {
      signInAdmin().catch((error) => window.alert(naruErrorMessage(error, "로그인을 시작하지 못했습니다.")));
    });
    return;
  }

  const boot = await loadBoot();
  const info = document.getElementById("adminInfo");
  if (info) info.textContent = `${boot.settings.title || "NARU BOARD"} · 관리자로 접속 중 · NARU BOARD ${BOARD_VERSION}`;
  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    await signOutAdmin();
    clearSiteCache();
    location.hash = "";
    location.reload();
  });

  const showView = async () => {
    const view = ["home", "boards", "design"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "dashboard";
    document.querySelectorAll("[data-admin-view]").forEach((el) => {
      el.classList.toggle("hidden", el.dataset.adminView !== view);
    });
    if (!initialized.has(view)) {
      initialized.add(view);
      if (view === "home") {
        const module = await import("./admin-home.js");
        await module.initHomeAdmin(admin);
      } else if (view === "boards") {
        const module = await import("./admin-boards.js");
        await module.initBoardsAdmin(admin);
      } else if (view === "design") {
        const module = await import("./admin-design.js");
        await module.initDesignAdmin(admin);
      }
    }
    window.scrollTo(0, 0);
  };

  window.addEventListener("hashchange", showView);
  await showView();
  await renderOwnerLink();
}

// 관리자 회원 계정 연결 — 관리자 로그인은 이 페이지에서만 유지되므로, 사이트 전역에서 유지되는
// 회원 로그인을 관리자로 연결해 모든 페이지에서 관리자로 글쓰기·관리를 한다
async function renderOwnerLink() {
  const statusEl = document.getElementById("ownerLinkStatus");
  const actionsEl = document.getElementById("ownerLinkActions");
  if (!statusEl || !actionsEl) return;

  const [boot, member] = await Promise.all([loadBoot(), getMemberSession()]);
  const linkedId = String(boot.settings.ownerMemberId || "");
  const myId = member ? String(member.id || "") : "";
  actionsEl.innerHTML = "";

  const addButton = (label, primary, onClick) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = primary ? "btn primary" : "btn";
    button.textContent = label;
    button.addEventListener("click", onClick);
    actionsEl.appendChild(button);
    return button;
  };
  const setLink = async (memberId, doneText) => {
    try {
      await runMutate("site:linkOwnerMember", { memberId });
      clearSiteCache();
      showNotice("ownerLinkMsg", doneText);
      await renderOwnerLink();
    } catch (error) {
      showNotice("ownerLinkMsg", naruErrorMessage(error, "처리하지 못했습니다."), true);
    }
  };

  if (!member) {
    statusEl.textContent = linkedId
      ? "회원 계정이 연결되어 있지만, 이 브라우저에는 회원 로그인이 없습니다."
      : "연결된 회원 계정이 없습니다. 먼저 회원 로그인을 해주세요.";
    addButton("회원 로그인", true, () => {
      signInMember().catch((error) => window.alert(naruErrorMessage(error, "로그인을 시작하지 못했습니다.")));
    });
    return;
  }

  if (linkedId && linkedId === myId) {
    statusEl.textContent = "지금 로그인한 회원 계정이 관리자로 연결되어 있습니다. 모든 페이지에서 관리자로 글을 쓸 수 있습니다.";
    addButton("연결 해제", false, () => {
      if (!window.confirm("연결을 해제할까요? 해제하면 일반 페이지에서 관리자 글쓰기가 안 됩니다.")) return;
      setLink("", "연결을 해제했습니다.");
    });
    return;
  }

  statusEl.textContent = linkedId
    ? "다른 회원 계정이 연결되어 있습니다. 지금 로그인한 계정으로 다시 연결할 수 있습니다."
    : "지금 로그인한 회원 계정을 관리자로 연결할 수 있습니다.";
  addButton("이 회원 계정을 관리자로 연결", true, () => setLink(myId, "연결했습니다. 이제 모든 페이지에서 관리자로 글을 쓸 수 있습니다."));
}

init();
