// 쿼리·뮤테이션 공통 헬퍼 (QuickJS에서 실행 — 브라우저 API 없음)

export function text(value, max, label, ctx, { required = false } = {}) {
  const out = String(value ?? "").trim();
  if (required && !out) ctx.fail("INVALID_REQUEST", `${label}을(를) 입력해 주세요.`);
  if (out.length > max) ctx.fail("INVALID_REQUEST", `${label}은(는) ${max}자까지입니다.`);
  return out;
}

export async function getBoard(ctx, boardId) {
  const id = String(boardId ?? "").trim();
  const { rows } = await ctx.sql`SELECT * FROM boards WHERE id = ${id}`;
  if (!rows.length) ctx.fail("NOT_FOUND", "게시판을 찾을 수 없습니다.");
  return rows[0];
}

// 관리자 판정: 관리자 로그인(ctx.owner) 또는 관리자로 연결된 회원 계정.
// 나루 관리자 로그인은 페이지 URL 단위로만 유지되어 일반 페이지에서는 세션이 없다.
// 그래서 사이트 전역에서 유지되는 회원 로그인을 settings.ownerMemberId로 연결해
// 그 회원을 관리자로 취급한다. (연결은 site:linkOwnerMember — 소유자 전용)
export async function isOwner(ctx) {
  if (ctx.owner) return true;
  if (!ctx.member) return false;
  const { rows } = await ctx.sql`SELECT value FROM settings WHERE key = 'ownerMemberId'`;
  return rows.length > 0 && rows[0].value !== "" && String(rows[0].value) === String(ctx.member.id);
}

// 비공개 게시판은 관리자만 접근 (owner를 미리 구했으면 넘겨준다)
export function assertBoardReadable(ctx, board, owner = ctx.owner) {
  if (!board.is_public && !owner) {
    ctx.fail("ACCESS_DENIED", "관리자 전용 게시판입니다.");
  }
}

export function requireOwner(ctx) {
  if (!ctx.owner) ctx.fail("ACCESS_DENIED", "관리자만 할 수 있습니다.");
}

// 글·댓글을 쓰려는 회원의 프로필(닉네임). 없으면 등록을 요구한다.
export async function requireProfile(ctx) {
  if (!ctx.member) ctx.fail("AUTH_REQUIRED", "로그인이 필요합니다.");
  const { rows } = await ctx.sql`SELECT nickname FROM profiles WHERE member_id = ${ctx.member.id}`;
  if (!rows.length) {
    ctx.fail("INVALID_REQUEST", "닉네임을 먼저 등록해 주세요.", { needProfile: true });
  }
  return rows[0].nickname;
}

export function parseImages(value, ctx, max = 24) {
  if (value == null) return "[]";
  if (!Array.isArray(value)) ctx.fail("INVALID_REQUEST", "이미지 목록 형식이 잘못되었습니다.");
  if (value.length > max) ctx.fail("INVALID_REQUEST", `이미지는 ${max}장까지입니다.`);
  const urls = value.map((url) => {
    const out = String(url ?? "").trim();
    if (!out || out.length > 2048) ctx.fail("INVALID_REQUEST", "이미지 주소가 잘못되었습니다.");
    return out;
  });
  return JSON.stringify(urls);
}
