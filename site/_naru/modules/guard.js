// NARU BOARD Copyright (c) 2026 NAMWALL — MPL-2.0 (https://mozilla.org/MPL/2.0/)
// 쿼리·뮤테이션 공통 헬퍼 (QuickJS에서 실행 — 브라우저 API 없음)

export function text(value, max, label, ctx, { required = false } = {}) {
  const out = String(value ?? "").trim();
  if (required && !out) ctx.fail("INVALID_REQUEST", `${label}을(를) 입력해 주세요.`);
  if (out.length > max) ctx.fail("INVALID_REQUEST", `${label}은(는) ${max}자까지입니다.`);
  return out;
}

export function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value || "");
    return parsed ?? fallback;
  } catch (_error) {
    return fallback;
  }
}

export function boardOptions(board) {
  const options = parseJson(board.options, {});
  return options && typeof options === "object" ? options : {};
}

export async function getBoard(ctx, boardId) {
  const id = String(boardId ?? "").trim();
  const { rows } = await ctx.sql`SELECT * FROM boards WHERE id = ${id}`;
  if (!rows.length) ctx.fail("NOT_FOUND", "게시판을 찾을 수 없습니다.");
  return rows[0];
}

// 지금 로그인한 회원이 이 글·댓글의 작성자인가
export function isAuthor(ctx, authorId) {
  return !!authorId && !!ctx.member && authorId === ctx.member.id;
}

// 관리자: 관리자 로그인(ctx.owner) 또는 settings.ownerMemberId로 연결된 회원.
// 나루 관리자 로그인은 페이지 URL 단위라, 사이트 전역에서 유지되는 회원 로그인을 관리자로 인정한다.
export async function isOwner(ctx) {
  if (ctx.owner) return true;
  if (!ctx.member) return false;
  const { rows } = await ctx.sql`SELECT value FROM settings WHERE key = 'ownerMemberId'`;
  return rows.length > 0 && rows[0].value !== "" && String(rows[0].value) === String(ctx.member.id);
}

export function requireOwner(ctx) {
  if (!ctx.owner) ctx.fail("ACCESS_DENIED", "관리자만 할 수 있습니다.");
}

// 비공개 게시판은 관리자만
export function assertBoardReadable(ctx, board, owner = ctx.owner) {
  if (!board.is_public && !owner) ctx.fail("ACCESS_DENIED", "관리자 전용 게시판입니다.");
}

// 덧글 제한(options.memberComment): 비로그인 방문자는 댓글·방명록을 못 쓴다
export function assertGuestWriteAllowed(ctx, board, owner, label) {
  if (owner || ctx.member) return;
  if (boardOptions(board).memberComment === true) {
    ctx.fail("AUTH_REQUIRED", `로그인한 회원만 ${label}을 쓸 수 있습니다.`);
  }
}

// 댓글이 달리는 곳: 게시글(args.post) 또는 방명록 항목(args.guestbook, 이때 post_id = 0).
// 읽을 수 있는지도 확인한다 — 비밀 방명록의 댓글은 관리자와 방명록 작성자만.
export async function resolveCommentTarget(ctx, args, owner) {
  const guestbookId = Number(args && args.guestbook) || 0;
  if (guestbookId) {
    const { rows } = await ctx.sql`SELECT board_id, author_id, is_secret FROM guestbook WHERE id = ${guestbookId}`;
    if (!rows.length) ctx.fail("NOT_FOUND", "방명록을 찾을 수 없습니다.");
    const board = await getBoard(ctx, rows[0].board_id);
    assertBoardReadable(ctx, board, owner);
    if (rows[0].is_secret && !owner && !isAuthor(ctx, rows[0].author_id)) {
      ctx.fail("ACCESS_DENIED", "비밀 방명록의 댓글은 작성자와 관리자만 볼 수 있습니다.");
    }
    return { postId: 0, guestbookId, board, authorId: rows[0].author_id };
  }
  const postId = Number(args && args.post) || 0;
  const { rows } = await ctx.sql`SELECT board_id, author_id, member_only FROM posts WHERE id = ${postId}`;
  if (!rows.length) ctx.fail("NOT_FOUND", "게시물을 찾을 수 없습니다.");
  const board = await getBoard(ctx, rows[0].board_id);
  assertBoardReadable(ctx, board, owner);
  if (rows[0].member_only && !owner && !ctx.member) {
    ctx.fail("ACCESS_DENIED", "회원만 볼 수 있는 글입니다.", { memberOnly: true });
  }
  return { postId, guestbookId: 0, board, authorId: rows[0].author_id };
}

// 글·댓글을 쓰려는 회원의 닉네임. 없으면 등록을 요구한다.
export async function requireProfile(ctx) {
  if (!ctx.member) ctx.fail("AUTH_REQUIRED", "로그인이 필요합니다.");
  const { rows } = await ctx.sql`SELECT nickname FROM profiles WHERE member_id = ${ctx.member.id}`;
  if (!rows.length) ctx.fail("INVALID_REQUEST", "닉네임을 먼저 등록해 주세요.", { needProfile: true });
  return rows[0].nickname;
}

// 댓글·방명록 작성자: 관리자 / 회원 / 게스트(이름 + 선택 비밀번호 — 비밀글이면 필수)
export async function resolveAuthor(ctx, owner, args, { nameLabel, isSecret, secretMessage, allowGuest = true }) {
  const author = { authorId: null, isOwner: 0, guestName: "", guestHash: "" };
  if (owner) {
    author.isOwner = 1;
  } else if (ctx.member) {
    await requireProfile(ctx);
    author.authorId = ctx.member.id;
  } else {
    if (!allowGuest) ctx.fail("ACCESS_DENIED", "이미지 첨부는 회원만 할 수 있습니다.");
    const password = String((args && args.password) || "");
    author.guestName = text(args && args.name, 40, nameLabel, ctx, { required: true });
    if (isSecret && !password) ctx.fail("INVALID_REQUEST", secretMessage);
    if (password) author.guestHash = await ctx.passwords.hash(password);
  }
  return author;
}

// 삭제 권한: 관리자·작성자, 또는 게스트 글이면 비밀번호 확인 (scope: 비밀번호 확인 시도 제한 키)
export async function assertCanDelete(ctx, owner, row, args, scope) {
  if (owner || isAuthor(ctx, row.author_id)) return;
  if (!row.guest_hash) ctx.fail("ACCESS_DENIED", "작성자만 삭제할 수 있습니다.");
  const password = String((args && args.password) || "");
  if (!password) ctx.fail("ACCESS_DENIED", "비밀번호를 입력하세요.", { needPassword: true });
  if (!(await ctx.passwords.verify(password, row.guest_hash, scope))) {
    ctx.fail("ACCESS_DENIED", "비밀번호가 일치하지 않습니다.");
  }
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

// QuickJS에는 URL API가 없어 HTTPS 절대주소를 직접 검사한다 (실행용 스킴·사용자 정보·제어문자·역슬래시 거절)
export function isHttpsVideoUrl(value) {
  const url = String(value || "").trim();
  if (/[\s\u0000-\u001f\u007f\\]/.test(url)) return false;
  const match = /^https:\/\/(\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::([0-9]{1,5}))?(?:[/?#].*)?$/i.exec(url);
  return Boolean(match) && (!match[2] || Number(match[2]) <= 65535);
}
