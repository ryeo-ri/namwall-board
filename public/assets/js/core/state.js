import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const GUEST_STATE_KEY = "archive_guest_state";
const GUEST_COOLDOWN_KEY = "archive_guest_last_submit_at";
const adminStateCache = new Map();
let authSnapshotCache = null;
let authSnapshotPromise = null;
let authCacheListenerBound = false;

function readGuestStateRaw() {
  try {
    return JSON.parse(localStorage.getItem(GUEST_STATE_KEY) || "null");
  } catch (_error) {
    return null;
  }
}

function writeGuestState(state) {
  localStorage.setItem(GUEST_STATE_KEY, JSON.stringify(state));
}

export function clearGuestState() {
  localStorage.removeItem(GUEST_STATE_KEY);
}

export function isGuestUnlocked() {
  const state = readGuestStateRaw();
  return Boolean(state?.enabled && state?.proofHash);
}

export function isGuestCooldownPassed(seconds = 30) {
  const last = Number(localStorage.getItem(GUEST_COOLDOWN_KEY) || "0");
  if (!last) return true;
  return Date.now() - last >= seconds * 1000;
}

export function touchGuestCooldown() {
  localStorage.setItem(GUEST_COOLDOWN_KEY, String(Date.now()));
}

export async function sha256Hex(input) {
  const enc = new TextEncoder();
  const bytes = enc.encode(input);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const arr = Array.from(new Uint8Array(hash));
  return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyGuestCode(plainCode) {
  const trimmed = String(plainCode || "").trim();
  if (!trimmed) return { ok: false, reason: "게스트 코드를 입력하세요." };

  const proofHash = await sha256Hex(trimmed);
  const sessionRef = doc(collection(db, "guest_sessions"));

  try {
    await setDoc(sessionRef, {
      proofHash,
      createdAt: serverTimestamp()
    });
  } catch (error) {
    console.warn("Guest code verification failed:", error);
    return { ok: false, reason: "게스트 코드가 올바르지 않습니다." };
  }

  writeGuestState({ enabled: true, proofHash, sessionId: sessionRef.id, unlockedAt: Date.now() });
  return { ok: true };
}

export function getGuestProofHash() {
  const state = readGuestStateRaw();
  return state?.enabled ? (state.proofHash || "") : "";
}

async function resolveAdmin(user) {
  if (!user) return false;
  if (adminStateCache.has(user.uid)) {
    return adminStateCache.get(user.uid);
  }
  const adminRef = doc(db, "admin_users", user.uid);
  const adminSnap = await getDoc(adminRef);
  const isAdmin = adminSnap.exists();
  adminStateCache.set(user.uid, isAdmin);
  return isAdmin;
}

function clearAuthSnapshotCache() {
  authSnapshotCache = null;
  authSnapshotPromise = null;
}

function bindAuthCacheListener() {
  if (authCacheListenerBound) return;
  authCacheListenerBound = true;
  onAuthStateChanged(auth, () => {
    clearAuthSnapshotCache();
  });
}

export async function getAuthSnapshot() {
  bindAuthCacheListener();

  const currentUid = auth.currentUser?.uid || "";
  if (authSnapshotCache) {
    const cachedUid = authSnapshotCache.user?.uid || "";
    if (cachedUid === currentUid) return authSnapshotCache;
  }

  if (authSnapshotPromise) return authSnapshotPromise;

  authSnapshotPromise = (async () => {
    try {
      let user = auth.currentUser;
      if (!user) {
        user = await new Promise((resolve) => {
          const unsub = onAuthStateChanged(auth, (u) => {
            unsub();
            resolve(u);
          });
        });
      }

      if (!user) {
        authSnapshotCache = { user: null, isAdmin: false, loaded: true };
        return authSnapshotCache;
      }

      let isAdmin = false;
      try {
        isAdmin = await resolveAdmin(user);
      } catch (_error) {
        isAdmin = false;
      }

      authSnapshotCache = { user, isAdmin, loaded: true };
      return authSnapshotCache;
    } finally {
      authSnapshotPromise = null;
    }
  })();

  return authSnapshotPromise;
}

export async function ensureAdminPageAccess() {
  const state = await getAuthSnapshot();
  if (!state.user) {
    location.href = "admin/login.html";
    return { ok: false, reason: "not-logged-in" };
  }
  if (!state.isAdmin) {
    await signOut(auth);
    location.href = "admin/login.html";
    return { ok: false, reason: "not-admin" };
  }
  return { ok: true, user: state.user };
}

export async function canWriteToBoard(board) {
  const state = await getAuthSnapshot();
  if (state.isAdmin) return { ok: true, mode: "ADMIN" };

  if (board?.isPublic === false) {
    return { ok: false, reason: "admin-only" };
  }

  if (board?.allowGuestPost !== true) {
    return { ok: false, reason: "guest-disabled" };
  }

  const guestState = readGuestStateRaw();
  if (!guestState?.enabled || !guestState?.proofHash) {
    return { ok: false, reason: "guest-locked" };
  }

  return { ok: true, mode: "GUEST" };
}

export async function logoutAdmin() {
  clearAuthSnapshotCache();
  await signOut(auth);
}
