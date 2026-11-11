// NARU BOARD Copyright (c) 2026 NAMWALL — MPL-2.0 (https://mozilla.org/MPL/2.0/)
// 나루 SDK 1.1.0 래퍼 — 클라이언트 생성, 관리자·회원 세션, 쿼리/뮤테이션 호출
import { createNaru } from "https://sdk.naru.pub/sdk/1.1.0/naru.js";
import { NARU_SITE } from "./config.js";

// NARU_SITE 없이 초기화에 실패해도 페이지는 뜨도록, 호출할 때 안내 오류를 던지는 대체 클라이언트
function createUnavailableClient(message) {
  const fail = () => {
    const error = new Error(message);
    error.code = "UNAVAILABLE";
    return Promise.reject(error);
  };
  return {
    auth: { session: async () => null, signIn: fail },
    members: { session: async () => null, signIn: fail },
    query: fail,
    mutate: fail
  };
}

function initClient() {
  try {
    return createNaru(NARU_SITE ? { site: NARU_SITE } : undefined);
  } catch (error) {
    console.warn("나루 클라이언트 초기화 실패 — assets/js/core/config.js의 NARU_SITE를 설정하세요.", error);
    return createUnavailableClient("나루 사이트명이 설정되지 않았습니다. config.js의 NARU_SITE를 채워주세요.");
  }
}

export const naru = initClient();

let adminPromise = null;
let memberPromise = null;

// 관리자(사이트 소유자) 세션 — 페이지당 1회만 조회
export function getAdminSession() {
  if (!adminPromise) adminPromise = naru.auth.session().catch(() => null);
  return adminPromise;
}

// 회원 세션 — 페이지당 1회만 조회
export function getMemberSession() {
  if (!memberPromise) memberPromise = naru.members.session().catch(() => null);
  return memberPromise;
}

export function signInAdmin() {
  return naru.auth.signIn();
}

export function signInMember() {
  return naru.members.signIn();
}

export async function signOutAdmin() {
  const admin = await getAdminSession();
  if (admin) await admin.signOut();
  adminPromise = null;
}

export async function signOutMember() {
  const member = await getMemberSession();
  if (member) await member.signOut();
  memberPromise = null;
}

// 세션 힌트: 비로그인으로 확인된 방문자의 읽기 쿼리는 세션 확인 없이 바로 보낸다 (관리자 페이지 제외)
const SESSION_HINT_KEY = "naru_session_hint_v1";
const IS_ADMIN_PAGE = /(?:^|\/)admin[^/]*\.html$/i.test(location.pathname);

export function sessionHint() {
  try { return sessionStorage.getItem(SESSION_HINT_KEY) || ""; } catch (_error) { return ""; }
}

export function clearSessionHint() {
  try { sessionStorage.removeItem(SESSION_HINT_KEY); } catch (_error) { /* ignore */ }
}

function writeSessionHint(value) {
  try { sessionStorage.setItem(SESSION_HINT_KEY, value); } catch (_error) { /* ignore */ }
}

let hintRefreshed = false;
function refreshSessionHintInBackground() {
  if (hintRefreshed) return;
  hintRefreshed = true;
  Promise.all([getAdminSession(), getMemberSession()])
    .then(([admin, member]) => writeSessionHint(admin ? "admin" : (member ? "member" : "anon")))
    .catch(() => { /* ignore */ });
}

// 호출 주체: 관리자 > 회원 > 방문자 순으로 가장 권한 높은 핸들
async function caller() {
  const admin = await getAdminSession();
  if (admin) { writeSessionHint("admin"); return admin; }
  const member = await getMemberSession();
  if (member) { writeSessionHint("member"); return member; }
  writeSessionHint("anon");
  return naru;
}

export async function runQuery(name, args) {
  if (!IS_ADMIN_PAGE && sessionHint() === "anon") {
    refreshSessionHintInBackground();
    return naru.query(name, args);
  }
  return (await caller()).query(name, args);
}

export async function runMutate(name, args) {
  return (await caller()).mutate(name, args);
}

const ERROR_MESSAGES = {
  NOT_FOUND: "요청한 내용을 찾을 수 없습니다.",
  ACCESS_DENIED: "권한이 없습니다.",
  AUTH_REQUIRED: "로그인이 만료되었습니다. 다시 로그인하세요.",
  CONFLICT: "다른 곳에서 먼저 저장했거나 중복된 값이 있습니다.",
  QUOTA_EXCEEDED: "저장 공간이 가득 찼습니다.",
  RATE_LIMITED: "요청이 너무 많습니다. 잠시 후 다시 시도하세요.",
  INVALID_REQUEST: "요청 형식이 잘못되었습니다.",
  UNAVAILABLE: "일시적인 오류입니다. 잠시 후 다시 시도하세요."
};

// 나루 오류 메시지(한국어)를 우선 쓰고, 없을 때만 코드별 문구
export function naruErrorMessage(error, fallback = "요청에 실패했습니다.") {
  if (error?.code && error?.message) return error.message;
  return ERROR_MESSAGES[error?.code] || fallback;
}
