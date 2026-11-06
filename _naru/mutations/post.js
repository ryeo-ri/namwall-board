// 글 쓰기·수정·삭제 — 관리자 또는 (회원 글쓰기가 켜진 게시판의) 회원
// 작성자 확인을 서버에서 강제하므로, 남의 글은 수정·삭제할 수 없다.
import { text, getBoard, requireProfile, parseImages, isOwner } from "../modules/guard.js";

const MAX_BODY = 30000; // 요청 크기 한도(64KiB) 안에서 여유를 둔 값

async function assertWritable(ctx, board, owner) {
  if (owner) return;
  if (!ctx.member) ctx.fail("AUTH_REQUIRED", "로그인이 필요합니다.");
  if (!board.member_write) ctx.fail("ACCESS_DENIED", "이 게시판은 관리자만 글을 쓸 수 있습니다.");
  if (!board.is_public) ctx.fail("ACCESS_DENIED", "관리자 전용 게시판입니다.");
  await requireProfile(ctx);
}

function cleanTags(ctx, raw) {
  if (raw == null) return "[]";
  const list = Array.isArray(raw) ? raw : String(raw).split(",");
  const tags = [];
  for (const item of list) {
    const tag = String(item || "").trim();
    if (!tag) continue;
    if (tag.length > 30) ctx.fail("INVALID_REQUEST", "태그는 30자까지입니다.");
    if (!tags.includes(tag)) tags.push(tag);
    if (tags.length > 10) ctx.fail("INVALID_REQUEST", "태그는 10개까지입니다.");
  }
  return JSON.stringify(tags);
}

// 분류 — 게시판 설정(options.categories)에 있는 값만 저장 (설정이 없거나 빈 값이면 "")
function cleanCategory(ctx, raw, board) {
  const value = String(raw || "").trim();
  if (!value) return "";
  let categories = [];
  try {
    const options = JSON.parse(board.options || "{}");
    if (Array.isArray(options.categories)) categories = options.categories.map((item) => String(item));
  } catch (_error) { /* ignore */ }
  if (!categories.includes(value)) ctx.fail("INVALID_REQUEST", "이 게시판에 없는 분류입니다.");
  return value;
}

// SCRIPT 스킨 부가 데이터 — 허용 키만 걸러 JSON으로 저장
const SCRIPT_TEXT_FIELDS = {
  system: 120, scenario: 200, gm: 120, players: 1000, playedAt: 20, summary: 2000,
  archiveUrl: 2048, archiveId: 64, archiveEncoding: 16, sourceType: 16, sourceFileName: 200
};
const SCRIPT_NUMBER_FIELDS = [
  "archiveVersion", "messageCount", "assetCount", "archivedAssetCount",
  "originalBytes", "normalizedBytes", "archiveBytes"
];
// PROFILE 스킨 부가 데이터 — 캐릭터 프로필 필드
const PROFILE_TEXT_FIELDS = {
  nameEn: 120, oneLine: 300, fullBodyImage: 2048, headImage: 2048,
  appearance: 4000, personality: 4000, etc: 8000
};
const PROFILE_META_FIELDS = { age: 40, gender: 40, height: 40 };

function cleanSkinData(ctx, raw, board) {
  const skin = String(board.skin || "").toUpperCase();
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};

  if (skin === "SCRIPT") {
    const script = source.script && typeof source.script === "object" && !Array.isArray(source.script)
      ? source.script : {};
    const out = {};
    for (const [key, max] of Object.entries(SCRIPT_TEXT_FIELDS)) {
      const value = String(script[key] ?? "").trim();
      if (!value) continue;
      if (value.length > max) ctx.fail("INVALID_REQUEST", `세션 정보(${key})는 ${max}자까지입니다.`);
      out[key] = value;
    }
    for (const key of SCRIPT_NUMBER_FIELDS) {
      const number = Number(script[key]);
      if (Number.isFinite(number) && number > 0) out[key] = Math.round(number);
    }
    const json = JSON.stringify({ script: out });
    if (json.length > 8000) ctx.fail("INVALID_REQUEST", "스킨 데이터가 너무 큽니다.");
    return json;
  }

  if (skin === "PROFILE") {
    const profile = source.profile && typeof source.profile === "object" && !Array.isArray(source.profile)
      ? source.profile : {};
    const out = {};
    for (const [key, max] of Object.entries(PROFILE_TEXT_FIELDS)) {
      const value = String(profile[key] ?? "").trim();
      if (!value) continue;
      if (value.length > max) ctx.fail("INVALID_REQUEST", `프로필(${key})은 ${max}자까지입니다.`);
      out[key] = value;
    }
    const metaSource = profile.meta && typeof profile.meta === "object" ? profile.meta : {};
    const meta = {};
    for (const [key, max] of Object.entries(PROFILE_META_FIELDS)) {
      const value = String(metaSource[key] ?? "").trim();
      if (!value) continue;
      if (value.length > max) ctx.fail("INVALID_REQUEST", `프로필(${key})은 ${max}자까지입니다.`);
      meta[key] = value;
    }
    if (Object.keys(meta).length) out.meta = meta;
    if (profile.etcIsHtml === true) out.etcIsHtml = true;
    const json = JSON.stringify({ profile: out });
    if (json.length > 20000) ctx.fail("INVALID_REQUEST", "프로필 데이터가 너무 큽니다.");
    return json;
  }

  return "{}";
}

// 추가 첨부: [{url, name}] — 상세 하단 다운로드 링크용
function cleanAttachments(ctx, raw) {
  if (raw == null) return "[]";
  if (!Array.isArray(raw)) ctx.fail("INVALID_REQUEST", "첨부 목록 형식이 잘못되었습니다.");
  if (raw.length > 24) ctx.fail("INVALID_REQUEST", "첨부는 24개까지입니다.");
  const out = raw.map((item) => {
    const url = String((item && item.url) || "").trim();
    const name = String((item && item.name) || "").trim().slice(0, 120);
    if (!url || url.length > 2048) ctx.fail("INVALID_REQUEST", "첨부 주소가 잘못되었습니다.");
    return { url, name };
  });
  return JSON.stringify(out);
}

export async function write(ctx, args) {
  const owner = await isOwner(ctx);
  const board = await getBoard(ctx, args && args.board);
  await assertWritable(ctx, board, owner);

  const isLog = String(board.skin || "").toUpperCase() === "LOG";
  const title = text(args && args.title, 200, "제목", ctx, { required: !isLog && board.skin !== "GALLERY" });
  const body = text(args && args.body, MAX_BODY, "본문", ctx);
  const thumb = text(args && args.thumb, 2048, "대표 이미지 주소", ctx);
  const source = text(args && args.source, 500, "출처", ctx);
  const images = parseImages(args && args.images, ctx);
  const attachments = cleanAttachments(ctx, args && args.attachments);
  const tags = cleanTags(ctx, args && args.tags);
  const category = cleanCategory(ctx, args && args.category, board);
  const skinData = cleanSkinData(ctx, args && args.skinData, board);
  const isSecret = (args && args.secret) === true ? 1 : 0;
  // 회원 공개: 로그인 회원(과 관리자)만 열람. 비밀글과는 동시에 쓸 수 없다(선택지가 하나).
  const memberOnly = !isSecret && (args && args.memberOnly) === true ? 1 : 0;
  const password = String((args && args.password) || "");
  const editId = Number(args && args.id) || 0;

  let secretHash = "";
  if (isSecret && password) secretHash = await ctx.passwords.hash(password);

  if (!editId) {
    if (isSecret && !password) ctx.fail("INVALID_REQUEST", "비밀글 비밀번호를 입력하세요.");
    const authorId = owner ? null : ctx.member.id;

    // LOG 스킨: 로그 번호 자동 부여 (직접 입력하면 그 값 사용)
    let logNo = Math.max(0, Number(args && args.logNo) || 0);
    if (isLog && !logNo) {
      const { rows } = await ctx.sql`SELECT COALESCE(MAX(log_no), 0) AS max_no FROM posts WHERE board_id = ${board.id}`;
      logNo = (rows[0].max_no || 0) + 1;
    }

    const { rows } = await ctx.sql`
      INSERT INTO posts (board_id, author_id, title, body, thumb, images, attachments, tags, source, log_no,
                         category, skin_data, is_secret, member_only, secret_hash, created_at, updated_at)
      VALUES (${board.id}, ${authorId}, ${title}, ${body}, ${thumb}, ${images}, ${attachments}, ${tags}, ${source}, ${logNo},
              ${category}, ${skinData}, ${isSecret}, ${memberOnly}, ${secretHash}, ${ctx.now}, ${ctx.now})
      RETURNING id`;
    return { id: rows[0].id };
  }

  // 수정: 관리자 또는 작성자 본인만
  const { rows } = await ctx.sql`SELECT author_id, secret_hash, log_no FROM posts WHERE id = ${editId}`;
  if (!rows.length) ctx.fail("NOT_FOUND", "게시물을 찾을 수 없습니다.");
  const prev = rows[0];
  const mine = !!prev.author_id && !!ctx.member && prev.author_id === ctx.member.id;
  if (!owner && !mine) ctx.fail("ACCESS_DENIED", "작성자만 수정할 수 있습니다.");

  // 비밀글 수정 시 비밀번호를 비워두면 기존 비밀번호 유지
  if (isSecret && !secretHash) {
    if (!prev.secret_hash) ctx.fail("INVALID_REQUEST", "비밀글 비밀번호를 입력하세요.");
    secretHash = prev.secret_hash;
  }
  const logNo = Math.max(0, Number(args && args.logNo) || 0) || prev.log_no || 0;

  await ctx.sql`
    UPDATE posts SET board_id = ${board.id}, title = ${title}, body = ${body}, thumb = ${thumb},
      images = ${images}, attachments = ${attachments}, tags = ${tags}, source = ${source}, log_no = ${logNo},
      category = ${category}, skin_data = ${skinData}, is_secret = ${isSecret}, member_only = ${memberOnly}, secret_hash = ${secretHash}, updated_at = ${ctx.now}
    WHERE id = ${editId}`;
  return { id: editId };
}

export async function remove(ctx, args) {
  const owner = await isOwner(ctx);
  const id = Number(args && args.id) || 0;
  const { rows } = await ctx.sql`SELECT author_id FROM posts WHERE id = ${id}`;
  if (!rows.length) ctx.fail("NOT_FOUND", "게시물을 찾을 수 없습니다.");
  const mine = !!rows[0].author_id && !!ctx.member && rows[0].author_id === ctx.member.id;
  if (!owner && !mine) ctx.fail("ACCESS_DENIED", "작성자만 삭제할 수 있습니다.");

  await ctx.sql`DELETE FROM comments WHERE post_id = ${id}`;
  await ctx.sql`DELETE FROM posts WHERE id = ${id}`;
  return null;
}

// 관리자 선택삭제·전체삭제 — 글마다 post:remove를 부르면 회원 세션(연결된 관리자 회원)의
// 분당 뮤테이션 한도 30번에 걸려 중간에 멈추므로 한 번에 지운다.
export async function removeMany(ctx, args) {
  if (!(await isOwner(ctx))) ctx.fail("ACCESS_DENIED", "관리자만 할 수 있습니다.");
  const raw = Array.isArray(args && args.ids) ? args.ids : [];
  const ids = [...new Set(raw.map((id) => Number(id) || 0).filter((id) => id > 0))];
  if (ids.length > 50) ctx.fail("INVALID_REQUEST", "한 번에 50개까지 삭제할 수 있습니다.");
  if (!ids.length) return { removed: 0 };
  const list = JSON.stringify(ids);
  await ctx.sql`DELETE FROM comments WHERE post_id IN (SELECT value FROM json_each(${list}))`;
  const { changes } = await ctx.sql`DELETE FROM posts WHERE id IN (SELECT value FROM json_each(${list}))`;
  return { removed: changes };
}

// 게시판의 글 전체(분류를 주면 그 분류만)와 댓글 삭제
export async function removeAll(ctx, args) {
  if (!(await isOwner(ctx))) ctx.fail("ACCESS_DENIED", "관리자만 할 수 있습니다.");
  const board = await getBoard(ctx, args && args.board);
  const category = String((args && args.category) || "").trim();
  if (category) {
    await ctx.sql`DELETE FROM comments WHERE post_id IN (SELECT id FROM posts WHERE board_id = ${board.id} AND category = ${category})`;
    const { changes } = await ctx.sql`DELETE FROM posts WHERE board_id = ${board.id} AND category = ${category}`;
    return { removed: changes };
  }
  await ctx.sql`DELETE FROM comments WHERE post_id IN (SELECT id FROM posts WHERE board_id = ${board.id})`;
  const { changes } = await ctx.sql`DELETE FROM posts WHERE board_id = ${board.id}`;
  return { removed: changes };
}
