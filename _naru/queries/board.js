// 게시판 읽기 쿼리 — 목록·상세·댓글·방명록·최근 글·태그·검색
// 누구나 호출할 수 있으므로, 무엇을 보여줄지는 전부 여기서 결정한다.
import { getBoard, assertBoardReadable, isOwner } from "../modules/guard.js";

const LIST_MAX = 50;

function callerId(ctx) {
  return ctx.member ? ctx.member.id : null;
}

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value || "");
    return parsed ?? fallback;
  } catch (_error) {
    return fallback;
  }
}

/* ── 글 목록 (키셋 페이징: id DESC) ──
   withBody: LOG 스킨처럼 목록에서 본문까지 그릴 때 사용.
   비밀글 본문은 관리자·작성자가 아니면 null로 가린다. */
export async function posts(ctx, args) {
  const owner = await isOwner(ctx);
  const board = await getBoard(ctx, args && args.board);
  assertBoardReadable(ctx, board, owner);
  const size = Math.min(Math.max(Number(args && args.size) || 20, 1), LIST_MAX);
  const before = Number(args && args.before) || 0;
  const withBody = (args && args.withBody) === true;
  // 분류 필터 (게시판 분류 칩에서 사용)
  const category = String((args && args.category) || "").trim().slice(0, 30);

  // 회원 공개 글은 비회원에게 목록에서도 숨긴다
  const seeMemberOnly = owner || !!ctx.member;
  const beforeId = before || Number.MAX_SAFE_INTEGER;
  const sql = `
    SELECT p.id, p.title, p.author_id, p.is_secret, p.member_only, p.thumb, p.source, p.tags, p.log_no, p.category, p.skin_data, p.created_at,
           ${withBody ? "p.body, p.images, p.attachments, p.updated_at," : ""}
           pr.nickname,
           (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count
    FROM posts p LEFT JOIN profiles pr ON pr.member_id = p.author_id
    WHERE p.board_id = ? AND p.id < ?
      ${seeMemberOnly ? "" : "AND p.member_only = 0"}
      ${category ? "AND p.category = ?" : ""}
    ORDER BY p.id DESC LIMIT ?`;
  const values = [board.id, beforeId];
  if (category) values.push(category);
  values.push(size + 1);
  const { rows } = await ctx.sql(sql, values);

  const me = callerId(ctx);
  const more = rows.length > size;
  return {
    posts: rows.slice(0, size).map((row) => {
      const mine = !!row.author_id && row.author_id === me;
      const item = {
        id: row.id,
        title: row.title,
        nickname: row.author_id ? row.nickname : null,
        isOwnerPost: !row.author_id,
        isSecret: !!row.is_secret,
        memberOnly: !!row.member_only,
        thumb: row.thumb,
        source: row.source,
        tags: parseJson(row.tags, []),
        logNo: row.log_no || 0,
        category: row.category || "",
        skinData: (!row.is_secret || owner || mine) ? parseJson(row.skin_data, {}) : {},
        commentCount: row.comment_count,
        createdAt: row.created_at,
        editable: owner || mine
      };
      if (withBody) {
        const canSee = !row.is_secret || owner || mine;
        item.body = canSee ? row.body : null;
        item.images = canSee ? parseJson(row.images, []) : [];
        item.attachments = canSee ? parseJson(row.attachments, []) : [];
      }
      return item;
    }),
    more
  };
}

/* ── 글 상세 — 비밀글은 서버에서 가린다 ── */
export async function post(ctx, args) {
  const owner = await isOwner(ctx);
  const id = Number(args && args.id) || 0;
  const { rows } = await ctx.sql`
    SELECT p.*, pr.nickname FROM posts p
    LEFT JOIN profiles pr ON pr.member_id = p.author_id
    WHERE p.id = ${id}`;
  if (!rows.length) ctx.fail("NOT_FOUND", "게시물을 찾을 수 없습니다.");
  const row = rows[0];

  const board = await getBoard(ctx, row.board_id);
  assertBoardReadable(ctx, board, owner);

  if (row.member_only && !owner && !ctx.member) {
    ctx.fail("ACCESS_DENIED", "회원만 볼 수 있는 글입니다. 로그인해 주세요.", { memberOnly: true });
  }

  const mine = !!row.author_id && row.author_id === callerId(ctx);
  if (row.is_secret && !owner && !mine) {
    const password = String((args && args.password) || "");
    if (!password) {
      ctx.fail("ACCESS_DENIED", "비밀글입니다. 비밀번호를 입력하세요.", { secret: true });
    }
    const ok = await ctx.passwords.verify(password, row.secret_hash, `post:${id}`);
    if (!ok) ctx.fail("ACCESS_DENIED", "비밀번호가 일치하지 않습니다.", { secret: true, wrong: true });
  }

  return {
    id: row.id,
    boardId: row.board_id,
    title: row.title,
    body: row.body,
    thumb: row.thumb,
    images: parseJson(row.images, []),
    attachments: parseJson(row.attachments, []),
    tags: parseJson(row.tags, []),
    source: row.source,
    logNo: row.log_no || 0,
    category: row.category || "",
    skinData: parseJson(row.skin_data, {}),
    nickname: row.author_id ? row.nickname : null,
    isOwnerPost: !row.author_id,
    isSecret: !!row.is_secret,
    memberOnly: !!row.member_only,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    editable: owner || mine
  };
}

/* ── 댓글 목록 — 비밀 댓글 본문은 관리자·댓글 작성자·글 작성자만 ── */
export async function comments(ctx, args) {
  const owner = await isOwner(ctx);
  const postId = Number(args && args.post) || 0;
  const { rows: postRows } = await ctx.sql`SELECT board_id, author_id, member_only FROM posts WHERE id = ${postId}`;
  if (!postRows.length) ctx.fail("NOT_FOUND", "게시물을 찾을 수 없습니다.");
  const board = await getBoard(ctx, postRows[0].board_id);
  assertBoardReadable(ctx, board, owner);
  if (postRows[0].member_only && !owner && !ctx.member) {
    ctx.fail("ACCESS_DENIED", "회원만 볼 수 있는 글입니다.", { memberOnly: true });
  }

  const me = callerId(ctx);
  const postAuthor = postRows[0].author_id;
  const { rows } = await ctx.sql`
    SELECT c.id, c.author_id, c.is_owner, c.guest_name, c.guest_hash, c.body, c.images, c.is_secret, c.more, c.created_at,
           pr.nickname
    FROM comments c LEFT JOIN profiles pr ON pr.member_id = c.author_id
    WHERE c.post_id = ${postId} ORDER BY c.id LIMIT 500`;

  return rows.map((row) => {
    const mine = !!row.author_id && row.author_id === me;
    const canSee = !row.is_secret || owner || mine || (!!postAuthor && postAuthor === me);
    return {
      id: row.id,
      name: row.is_owner ? null : (row.author_id ? row.nickname : row.guest_name),
      isOwnerComment: !!row.is_owner,
      isMember: !!row.author_id,
      isSecret: !!row.is_secret,
      more: !!row.more,
      body: canSee ? row.body : null,
      images: canSee ? parseJson(row.images, []) : [],
      hasPassword: !!row.guest_hash,
      deletable: owner || mine,
      createdAt: row.created_at
    };
  });
}

/* ── 게스트 비밀 댓글 열람 (비밀번호 확인) ── */
export async function commentReveal(ctx, args) {
  const id = Number(args && args.id) || 0;
  const { rows } = await ctx.sql`SELECT body, is_secret, guest_hash FROM comments WHERE id = ${id}`;
  if (!rows.length) ctx.fail("NOT_FOUND", "댓글을 찾을 수 없습니다.");
  const row = rows[0];
  if (!row.is_secret) return { body: row.body };
  if (!row.guest_hash) ctx.fail("ACCESS_DENIED", "작성자와 관리자만 볼 수 있는 댓글입니다.");
  const ok = await ctx.passwords.verify(String((args && args.password) || ""), row.guest_hash, `comment:${id}`);
  if (!ok) ctx.fail("ACCESS_DENIED", "비밀번호가 일치하지 않습니다.");
  return { body: row.body };
}

/* ── 방명록 목록 ── */
export async function guestbook(ctx, args) {
  const owner = await isOwner(ctx);
  const board = await getBoard(ctx, args && args.board);
  assertBoardReadable(ctx, board, owner);
  const size = Math.min(Math.max(Number(args && args.size) || 20, 1), LIST_MAX);
  const before = Number(args && args.before) || 0;

  const beforeId = before || Number.MAX_SAFE_INTEGER;
  const { rows } = await ctx.sql`
    SELECT g.id, g.author_id, g.is_owner, g.guest_name, g.guest_hash, g.body, g.is_secret, g.created_at,
           pr.nickname
    FROM guestbook g LEFT JOIN profiles pr ON pr.member_id = g.author_id
    WHERE g.board_id = ${board.id} AND g.id < ${beforeId}
    ORDER BY g.id DESC LIMIT ${size + 1}`;

  const me = callerId(ctx);
  const more = rows.length > size;
  return {
    entries: rows.slice(0, size).map((row) => {
      const mine = !!row.author_id && row.author_id === me;
      const canSee = !row.is_secret || owner || mine;
      return {
        id: row.id,
        name: row.is_owner ? null : (row.author_id ? row.nickname : row.guest_name),
        isOwnerEntry: !!row.is_owner,
        isMember: !!row.author_id,
        isSecret: !!row.is_secret,
        body: canSee ? row.body : null,
        hasPassword: !!row.guest_hash,
        deletable: owner || mine,
        createdAt: row.created_at
      };
    }),
    more
  };
}

/* ── 게스트 비밀 방명록 열람 ── */
export async function guestbookReveal(ctx, args) {
  const id = Number(args && args.id) || 0;
  const { rows } = await ctx.sql`SELECT body, is_secret, guest_hash FROM guestbook WHERE id = ${id}`;
  if (!rows.length) ctx.fail("NOT_FOUND", "방명록을 찾을 수 없습니다.");
  const row = rows[0];
  if (!row.is_secret) return { body: row.body };
  if (!row.guest_hash) ctx.fail("ACCESS_DENIED", "작성자와 관리자만 볼 수 있는 글입니다.");
  const ok = await ctx.passwords.verify(String((args && args.password) || ""), row.guest_hash, `guestbook:${id}`);
  if (!ok) ctx.fail("ACCESS_DENIED", "비밀번호가 일치하지 않습니다.");
  return { body: row.body };
}

/* ── 홈 최근 업데이트 — 공개 게시판 글만 (비밀글 제목은 잠금 표시용 플래그 포함) ── */
export async function recent(ctx, args) {
  const seeMemberOnly = (await isOwner(ctx)) || !!ctx.member;
  const size = Math.min(Math.max(Number(args && args.size) || 5, 1), 20);
  const sql = `
    SELECT p.id, p.title, p.board_id, p.is_secret, p.created_at, b.title AS board_title, b.skin
    FROM posts p JOIN boards b ON b.id = p.board_id
    WHERE b.is_public = 1
      ${seeMemberOnly ? "" : "AND p.member_only = 0"}
    ORDER BY p.id DESC LIMIT ?`;
  const { rows } = await ctx.sql(sql, [size]);
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    boardId: row.board_id,
    boardTitle: row.board_title,
    skin: row.skin,
    isSecret: !!row.is_secret,
    createdAt: row.created_at
  }));
}

/* ── 홈 최근 태그 — 최근 30개 공개 글의 태그 집계 상위 10개 ── */
export async function recentTags(ctx) {
  const seeMemberOnly = (await isOwner(ctx)) || !!ctx.member;
  const sql = `
    SELECT p.tags FROM posts p JOIN boards b ON b.id = p.board_id
    WHERE b.is_public = 1 AND p.is_secret = 0
      ${seeMemberOnly ? "" : "AND p.member_only = 0"}
    ORDER BY p.id DESC LIMIT 30`;
  const { rows } = await ctx.sql(sql, []);
  const counts = new Map();
  for (const row of rows) {
    for (const tag of parseJson(row.tags, [])) {
      const key = String(tag || "").trim();
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag]) => tag);
}

/* ── 검색 — 공개 게시판의 글에서 제목·본문·출처·태그·댓글 LIKE 검색 ──
   관리자는 관리자 전용(비공개) 게시판의 글도 검색된다.
   태그는 부분 일치: "낮밤"으로도 "#낮밤서"가 찾아진다 (# 유무 무관).
   댓글 본문도 검색하며(원본 namwall과 동일), 비밀 댓글은 관리자에게만 걸린다. */
export async function search(ctx, args) {
  const owner = await isOwner(ctx);
  const q = String((args && args.q) || "").trim().slice(0, 100);
  const tag = String((args && args.tag) || "").trim().slice(0, 30).replace(/^#+/, "");
  if (!q && !tag) return [];

  const like = `%${q}%`;
  const tagLike = `%${tag}%`;
  const commentWhere = `c.post_id = p.id AND c.body LIKE ?${owner ? "" : " AND c.is_secret = 0"}`;
  const sql = `
    SELECT p.id, p.title, p.board_id, p.body, p.thumb, p.tags, p.source, p.log_no, p.is_secret,
           p.created_at, p.updated_at, b.title AS board_title
           ${q ? `, (SELECT c.body FROM comments c WHERE ${commentWhere} ORDER BY c.id DESC LIMIT 1) AS comment_match` : ""}
    FROM posts p JOIN boards b ON b.id = p.board_id
    WHERE ${owner ? "1 = 1" : "b.is_public = 1"}
      ${owner ? "" : "AND p.is_secret = 0"}
      ${owner || ctx.member ? "" : "AND p.member_only = 0"}
      ${tag ? "AND p.tags LIKE ?" : ""}
      ${q ? `AND (p.title LIKE ? OR p.body LIKE ? OR p.source LIKE ? OR p.tags LIKE ?
             OR EXISTS (SELECT 1 FROM comments c WHERE ${commentWhere}))` : ""}
    ORDER BY p.id DESC LIMIT 50`;
  // 바인딩은 SQL의 ? 등장 순서: SELECT의 댓글 발췌 → 태그 → 제목·본문·출처·태그 → 댓글 EXISTS
  const values = [];
  if (q) values.push(like);
  if (tag) values.push(tagLike);
  if (q) values.push(like, like, like, like, like);
  const { rows } = await ctx.sql(sql, values);

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    boardId: row.board_id,
    boardTitle: row.board_title,
    excerpt: row.is_secret ? "" : String(row.body || "").slice(0, 300),
    commentMatch: row.is_secret ? "" : String(row.comment_match || "").slice(0, 200),
    thumb: row.is_secret ? "" : row.thumb,
    tags: parseJson(row.tags, []),
    logNo: row.log_no || 0,
    isSecret: !!row.is_secret,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}
