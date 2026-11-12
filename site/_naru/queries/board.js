// NAMWALL Edition Copyright (c) 2026 NAMWALL — MPL-2.0 (https://mozilla.org/MPL/2.0/)
// 게시판 읽기 쿼리 — 목록·상세·댓글·방명록·최근 글·태그·검색
// 누구나 호출할 수 있으므로, 무엇을 보여줄지는 전부 여기서 결정한다.
import { getBoard, assertBoardReadable, isOwner, isAuthor, resolveCommentTarget, parseJson } from "../modules/guard.js";

const LIST_MAX = 50;
// 본문·댓글 응답 바이트 상한 — 쿼리 응답(JSON 1 MiB)에서 이스케이프와 나머지 필드 몫을 뺀 값
const BODY_BUDGET = 450 * 1024;
const COMMENT_BUDGET = 450 * 1024;

// 글 목록 (id DESC)
// page(1부터)를 주면 페이지 번호 방식 — 전체 글 수·페이지 수를 함께 준다. logNo를 주면 그 로그가 있는 페이지.
// page 없이 before를 주면 키셋 방식(더 보기).
// withBody: LOG·GALLERY처럼 목록에서 본문·첨부까지 그릴 때. 응답 한도를 넘으면 앞쪽 글만 주고
// 키셋 방식은 more, 페이지 방식은 partial로 알린다 — 나머지는 skip(이 페이지에서 이미 받은 수)으로 이어 받는다.
// 비밀글 본문·첨부는 관리자·작성자에게만.
export async function posts(ctx, args) {
  const owner = await isOwner(ctx);
  const board = await getBoard(ctx, args && args.board);
  assertBoardReadable(ctx, board, owner);
  const size = Math.min(Math.max(Number(args && args.size) || 20, 1), LIST_MAX);
  const before = Number(args && args.before) || 0;
  const withBody = (args && args.withBody) === true;
  const category = String((args && args.category) || "").trim().slice(0, 30);
  const paged = args && args.page != null;

  // 회원 공개 글은 비회원에게 목록에서도 숨긴다 — 목록과 개수에 같은 조건
  const seeMemberOnly = owner || !!ctx.member;
  const where = `p.board_id = ?
      ${seeMemberOnly ? "" : "AND p.member_only = 0"}
      ${category ? "AND p.category = ?" : ""}`;
  const whereValues = category ? [board.id, category] : [board.id];

  let page = 0;
  let pages = 0;
  let total = 0;
  let offset = 0;
  let limit = size + 1;
  if (paged) {
    const { rows: countRows } = await ctx.sql(`SELECT COUNT(*) AS n FROM posts p WHERE ${where}`, whereValues);
    total = Number(countRows[0] && countRows[0].n) || 0;
    pages = Math.max(1, Math.ceil(total / size));
    page = Math.floor(Number(args.page)) || 1;
    const logNo = Math.floor(Number(args.logNo)) || 0;
    if (logNo > 0) {
      // 그 로그보다 새 글이 몇 개인지로 페이지를 정한다 (없는 번호면 1페이지)
      const { rows: newer } = await ctx.sql(
        `SELECT COUNT(*) AS n FROM posts p WHERE ${where}
           AND p.id > (SELECT MAX(id) FROM posts WHERE board_id = ? AND log_no = ?)`,
        [...whereValues, board.id, logNo]);
      page = Math.floor((Number(newer[0] && newer[0].n) || 0) / size) + 1;
    }
    page = Math.min(Math.max(page, 1), pages);
    const skip = Math.min(Math.max(Math.floor(Number(args.skip)) || 0, 0), size - 1);
    offset = (page - 1) * size + skip;
    limit = size - skip;
  }

  const sql = `
    SELECT p.id, p.title, p.author_id, p.is_secret, p.member_only, p.thumb, p.source, p.tags, p.log_no, p.category, p.skin_data, p.created_at,
           ${withBody ? "length(CAST(p.body AS BLOB)) + length(CAST(p.images AS BLOB)) + length(CAST(p.attachments AS BLOB)) AS body_bytes," : ""}
           pr.nickname,
           (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count
    FROM posts p LEFT JOIN profiles pr ON pr.member_id = p.author_id
    WHERE ${where}
      ${paged ? "" : "AND p.id < ?"}
    ORDER BY p.id DESC LIMIT ?${paged ? " OFFSET ?" : ""}`;
  const values = paged
    ? [...whereValues, limit, offset]
    : [...whereValues, before || Number.MAX_SAFE_INTEGER, limit];
  const { rows } = await ctx.sql(sql, values);

  const canSeeRow = (row) => !row.is_secret || owner || isAuthor(ctx, row.author_id);
  let list = paged ? rows : rows.slice(0, size);
  let more = paged ? offset + rows.length < total : rows.length > size;
  let partial = false;

  // 본문은 한도 안에 드는 글까지만 따로 읽는다 (최소 1개)
  let bodies = new Map();
  if (withBody) {
    let bytes = 0;
    let keep = 0;
    for (const row of list) {
      if (canSeeRow(row)) bytes += Number(row.body_bytes) || 0;
      if (keep > 0 && bytes > BODY_BUDGET) break;
      keep += 1;
    }
    if (keep < list.length) {
      list = list.slice(0, keep);
      more = true;
      partial = paged;
    }
    const ids = JSON.stringify(list.filter(canSeeRow).map((row) => row.id));
    const { rows: bodyRows } = await ctx.sql`
      SELECT id, body, images, attachments FROM posts
      WHERE id IN (SELECT value FROM json_each(${ids}))`;
    bodies = new Map(bodyRows.map((row) => [row.id, row]));
  }

  return {
    posts: list.map((row) => {
      const mine = isAuthor(ctx, row.author_id);
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
        const full = bodies.get(row.id);
        item.body = full ? full.body : null;
        item.images = full ? parseJson(full.images, []) : [];
        item.attachments = full ? parseJson(full.attachments, []) : [];
      }
      return item;
    }),
    more,
    ...(paged ? { page, pages, total, partial } : {})
  };
}

// 회원 미디어 업로드 남은 횟수 (시간당 30개 — 연결된 관리자 회원도 같은 한도)
export async function uploadBudget(ctx) {
  if (ctx.owner) return { limited: false, remaining: null };
  if (!ctx.member) ctx.fail("AUTH_REQUIRED", "로그인이 필요합니다.");
  const { rows } = await ctx.sql`
    SELECT created_at FROM _naru_uploads
    WHERE member = ${ctx.member.id}
    ORDER BY created_at DESC LIMIT 30`;
  const recent = rows.filter((row) => {
    const numeric = Number(row.created_at);
    const time = Number.isFinite(numeric)
      ? (numeric < 100000000000 ? numeric * 1000 : numeric)
      : Date.parse(String(row.created_at));
    return Number.isFinite(time) && time > ctx.now - 60 * 60 * 1000;
  });
  return { limited: true, remaining: Math.max(0, 30 - recent.length) };
}

// 글 상세 — 비밀글은 관리자·작성자·비밀번호 확인 후에만
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

  const mine = isAuthor(ctx, row.author_id);
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

// 댓글 목록 (게시글 또는 방명록 항목) — 최신 페이지부터, before로 이전 댓글
// 비밀 댓글 본문은 관리자·댓글 작성자·글(방명록) 작성자만
export async function comments(ctx, args) {
  const owner = await isOwner(ctx);
  const { postId, guestbookId, authorId: postAuthor } = await resolveCommentTarget(ctx, args, owner);
  const size = Math.min(Math.max(Math.floor(Number(args && args.size) || 50), 1), LIST_MAX);
  const beforeId = Number(args && args.before) || Number.MAX_SAFE_INTEGER;
  const { rows } = await ctx.sql`
    SELECT c.id, c.parent_id, c.author_id, c.is_owner, c.guest_name, c.guest_hash, c.body, c.images, c.is_secret, c.more, c.created_at,
           pr.nickname
    FROM comments c LEFT JOIN profiles pr ON pr.member_id = c.author_id
    WHERE c.post_id = ${postId} AND c.guestbook_id = ${guestbookId} AND c.id < ${beforeId}
    ORDER BY c.id DESC LIMIT ${size + 1}`;

  const page = [];
  let bytes = 0;
  for (const row of rows.slice(0, size)) {
    const mine = isAuthor(ctx, row.author_id);
    const canSee = !row.is_secret || owner || mine || isAuthor(ctx, postAuthor);
    const item = {
      id: row.id,
      parentId: row.parent_id || null,
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
    // 응답 한도를 넘으면 나머지는 다음 페이지로
    const itemBytes = utf8Length(JSON.stringify(item));
    if (page.length && bytes + itemBytes > COMMENT_BUDGET) break;
    page.push(item);
    bytes += itemBytes;
  }
  const more = rows.length > page.length;
  page.reverse(); // 화면은 오래된 댓글 → 새 댓글 순서
  return { comments: page, more, before: page[0]?.id || null };
}

function utf8Length(value) {
  let length = 0;
  for (const character of value) {
    const code = character.codePointAt(0);
    length += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return length;
}

// 게스트 비밀 댓글 열람 (비밀번호 확인)
export async function commentReveal(ctx, args) {
  const owner = await isOwner(ctx);
  const id = Number(args && args.id) || 0;
  const { rows } = await ctx.sql`SELECT post_id, guestbook_id, author_id, body, is_secret, guest_hash FROM comments WHERE id = ${id}`;
  if (!rows.length) ctx.fail("NOT_FOUND", "댓글을 찾을 수 없습니다.");
  const row = rows[0];
  const { authorId: parentAuthor } = await resolveCommentTarget(ctx, { post: row.post_id, guestbook: row.guestbook_id }, owner);
  if (!row.is_secret || owner || isAuthor(ctx, row.author_id) || isAuthor(ctx, parentAuthor)) return { body: row.body };
  if (!row.guest_hash) ctx.fail("ACCESS_DENIED", "작성자와 관리자만 볼 수 있는 댓글입니다.");
  const ok = await ctx.passwords.verify(String((args && args.password) || ""), row.guest_hash, `comment:${id}`);
  if (!ok) ctx.fail("ACCESS_DENIED", "비밀번호가 일치하지 않습니다.");
  return { body: row.body };
}

// 방명록 목록 — page(1부터)를 주면 페이지 번호 방식(전체 수·페이지 수 포함), 아니면 before 키셋
export async function guestbook(ctx, args) {
  const owner = await isOwner(ctx);
  const board = await getBoard(ctx, args && args.board);
  assertBoardReadable(ctx, board, owner);
  const size = Math.min(Math.max(Number(args && args.size) || 20, 1), LIST_MAX);
  const before = Number(args && args.before) || 0;
  const paged = args && args.page != null;

  let page = 0;
  let pages = 0;
  let total = 0;
  if (paged) {
    const { rows: countRows } = await ctx.sql`SELECT COUNT(*) AS n FROM guestbook WHERE board_id = ${board.id}`;
    total = Number(countRows[0] && countRows[0].n) || 0;
    pages = Math.max(1, Math.ceil(total / size));
    page = Math.min(Math.max(Math.floor(Number(args.page)) || 1, 1), pages);
  }

  const beforeId = paged ? Number.MAX_SAFE_INTEGER : (before || Number.MAX_SAFE_INTEGER);
  const offset = paged ? (page - 1) * size : 0;
  const { rows } = await ctx.sql`
    SELECT g.id, g.author_id, g.is_owner, g.guest_name, g.guest_hash, g.body, g.is_secret, g.created_at,
           pr.nickname,
           (SELECT COUNT(*) FROM comments c WHERE c.guestbook_id = g.id) AS comment_count
    FROM guestbook g LEFT JOIN profiles pr ON pr.member_id = g.author_id
    WHERE g.board_id = ${board.id} AND g.id < ${beforeId}
    ORDER BY g.id DESC LIMIT ${size + 1} OFFSET ${offset}`;

  const more = rows.length > size;
  return {
    ...(paged ? { page, pages, total } : {}),
    entries: rows.slice(0, size).map((row) => {
      const mine = isAuthor(ctx, row.author_id);
      const canSee = !row.is_secret || owner || mine;
      return {
        id: row.id,
        name: row.is_owner ? null : (row.author_id ? row.nickname : row.guest_name),
        isOwnerEntry: !!row.is_owner,
        isMember: !!row.author_id,
        isSecret: !!row.is_secret,
        body: canSee ? row.body : null,
        commentCount: canSee ? row.comment_count : 0,
        hasPassword: !!row.guest_hash,
        deletable: owner || mine,
        createdAt: row.created_at
      };
    }),
    more
  };
}

// 게스트 비밀 방명록 열람
export async function guestbookReveal(ctx, args) {
  const owner = await isOwner(ctx);
  const id = Number(args && args.id) || 0;
  const { rows } = await ctx.sql`SELECT board_id, author_id, body, is_secret, guest_hash FROM guestbook WHERE id = ${id}`;
  if (!rows.length) ctx.fail("NOT_FOUND", "방명록을 찾을 수 없습니다.");
  const row = rows[0];
  const board = await getBoard(ctx, row.board_id);
  assertBoardReadable(ctx, board, owner);
  if (!row.is_secret || owner || isAuthor(ctx, row.author_id)) return { body: row.body };
  if (!row.guest_hash) ctx.fail("ACCESS_DENIED", "작성자와 관리자만 볼 수 있는 글입니다.");
  const ok = await ctx.passwords.verify(String((args && args.password) || ""), row.guest_hash, `guestbook:${id}`);
  if (!ok) ctx.fail("ACCESS_DENIED", "비밀번호가 일치하지 않습니다.");
  return { body: row.body };
}

// 홈 최근 업데이트 — 공개 게시판 글만
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

// 홈 최근 태그 — 최근 공개 글 30개의 태그 상위 10개
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

// 검색 — 제목·본문·출처·태그·댓글 LIKE (관리자는 비공개 게시판·비밀 댓글까지)
// 태그는 부분 일치, 앞의 #은 무시한다
export async function search(ctx, args) {
  const owner = await isOwner(ctx);
  const q = String((args && args.q) || "").trim().slice(0, 100);
  const tag = String((args && args.tag) || "").trim().slice(0, 30).replace(/^#+/, "");
  if (!q && !tag) return [];

  const like = `%${q}%`;
  const tagLike = `%${tag}%`;
  const commentWhere = `c.post_id = p.id AND c.body LIKE ?${owner ? "" : " AND c.is_secret = 0"}`;
  const sql = `
    SELECT p.id, p.title, p.board_id, p.body, p.thumb, p.tags, p.log_no, p.is_secret, p.skin_data,
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
    isVideo: parseJson(row.skin_data, {}).cover === "video",
    tags: parseJson(row.tags, []),
    logNo: row.log_no || 0,
    isSecret: !!row.is_secret,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}
