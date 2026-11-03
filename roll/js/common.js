// 공통 유틸
import { createNaru } from "https://sdk.naru.pub/sdk/1.0.0/naru.js";
import { SITE } from "./config.js";

// naru 클라이언트 생성: naru.pub 위에서는 자동 인식, 그 외(로컬 등)에서는 SITE 사용
export function makeNaru() {
  const onNaruPub = location.hostname.endsWith(".naru.pub");
  return createNaru(onNaruPub ? undefined : { site: SITE });
}

// 유튜브 링크에서 영상 ID 추출. 실패하면 null.
// 지원: watch?v=, youtu.be/, shorts/, embed/, live/
export function extractYouTubeId(url) {
  if (typeof url !== "string" || url.trim() === "") return null;
  let u;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\./, "");
  const isValidId = (id) => /^[A-Za-z0-9_-]{11}$/.test(id);

  if (host === "youtu.be") {
    const id = u.pathname.slice(1).split("/")[0];
    return isValidId(id) ? id : null;
  }
  if (host === "youtube.com" || host === "music.youtube.com" || host === "youtube-nocookie.com") {
    const v = u.searchParams.get("v");
    if (v && isValidId(v)) return v;
    const m = u.pathname.match(/^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})/);
    if (m) return m[1];
  }
  return null;
}

// NaruError 코드를 한국어 메시지로 변환
export function naruErrorMessage(err) {
  const code = err && err.code;
  switch (code) {
    case "NOT_FOUND":
      return "게시물을 찾을 수 없습니다.";
    case "ACCESS_DENIED":
      return "접근 권한이 없습니다. 컬렉션 공개 설정을 확인하세요.";
    case "AUTH_REQUIRED":
      return "관리자 로그인이 만료되었습니다. 다시 로그인해 주세요.";
    case "CONFLICT":
      return "다른 곳에서 먼저 수정되었습니다. 목록을 새로고침한 뒤 다시 시도하세요.";
    case "QUOTA_EXCEEDED":
      return "저장 공간이 가득 찼습니다.";
    case "RATE_LIMITED":
      return "요청이 너무 많습니다. 잠시 후 다시 시도하세요.";
    case "INVALID_REQUEST":
      return "요청 형식이 잘못되었습니다.";
    case "UNAVAILABLE":
      return "일시적인 오류입니다. 잠시 후 다시 시도하세요.";
    default:
      return (err && err.message) || "알 수 없는 오류가 발생했습니다.";
  }
}
