// Firebase판(300.30) → 나루 데이터 이사 — 관리자 전용
// 원본 작성일(createdAt)을 그대로 보존하기 위해 post:write 대신 전용 임포트를 쓴다.
// legacy_id(원본 문서 ID)가 이미 있으면 건너뛰므로 여러 번 실행해도 안전하다.
import { text, getBoard, parseImages, isOwner } from "../modules/guard.js";

const MAX_BODY = 30000;

async function requireAdmin(ctx) {
  if (!(await isOwner(ctx))) ctx.fail("ACCESS_DENIED", "관리자만 실행할 수 있습니다.");
}

function toTime(ctx, value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : ctx.now;
}

function cleanTags(ctx, raw) {
  if (!Array.isArray(raw)) return "[]";
  const tags = [];
  for (const item of raw) {
    const tag = String(item || "").trim().slice(0, 30);
    if (tag && !tags.includes(tag)) tags.push(tag);
    if (tags.length >= 10) break;
  }
  return JSON.stringify(tags);
}

function cleanAttachments(ctx, raw) {
  if (!Array.isArray(raw)) return "[]";
  const out = [];
  for (const item of raw.slice(0, 24)) {
    const url = String((item && item.url) || "").trim();
    if (!url || url.length > 2048) continue;
    out.push({ url, name: String((item && item.name) || "").trim().slice(0, 120) });
  }
  return JSON.stringify(out);
}

export async function importPost(ctx, args) {
  await requireAdmin(ctx);
  const legacyId = String((args && args.legacyId) || "").trim().slice(0, 64);
  if (!legacyId) ctx.fail("INVALID_REQUEST", "원본 글 ID(legacyId)가 필요합니다.");

  const { rows: existing } = await ctx.sql`SELECT id FROM posts WHERE legacy_id = ${legacyId}`;
  if (existing.length) return { id: existing[0].id, skipped: true };

  const board = await getBoard(ctx, args && args.board);
  const title = text(args && args.title, 200, "제목", ctx);
  const body = text(args && args.body, MAX_BODY, "본문", ctx);
  const thumb = text(args && args.thumb, 2048, "대표 이미지 주소", ctx);
  const source = text(args && args.source, 500, "출처", ctx);
  const images = parseImages(args && args.images, ctx);
  const attachments = cleanAttachments(ctx, args && args.attachments);
  const tags = cleanTags(ctx, args && args.tags);
  const logNo = Math.max(0, Number(args && args.logNo) || 0);
  const createdAt = toTime(ctx, args && args.createdAt);
  const updatedAt = toTime(ctx, (args && args.updatedAt) || (args && args.createdAt));

  const { rows } = await ctx.sql`
    INSERT INTO posts (board_id, author_id, title, body, thumb, images, attachments, tags, source, log_no,
                       skin_data, is_secret, member_only, secret_hash, legacy_id, created_at, updated_at)
    VALUES (${board.id}, NULL, ${title}, ${body}, ${thumb}, ${images}, ${attachments}, ${tags}, ${source}, ${logNo},
            '{}', 0, 0, '', ${legacyId}, ${createdAt}, ${updatedAt})
    RETURNING id`;
  const postId = rows[0].id;

  // 댓글 — 원본 작성일 순서대로 (관리자 답글은 is_owner, 그 외는 게스트 이름)
  const comments = Array.isArray(args && args.comments) ? args.comments.slice(0, 60) : [];
  let importedComments = 0;
  for (const comment of comments) {
    const commentBody = String((comment && comment.body) || "").trim().slice(0, 5000);
    const commentImages = parseImages((comment && comment.images) || [], ctx, 8);
    if (!commentBody && commentImages === "[]") continue;
    const isOwnerComment = (comment && comment.isOwner) === true ? 1 : 0;
    const guestName = isOwnerComment ? "" : String((comment && comment.name) || "").trim().slice(0, 40);
    await ctx.sql`
      INSERT INTO comments (post_id, author_id, is_owner, guest_name, guest_hash, body, images, is_secret, created_at)
      VALUES (${postId}, NULL, ${isOwnerComment}, ${guestName}, '', ${commentBody}, ${commentImages}, 0, ${toTime(ctx, comment && comment.createdAt)})`;
    importedComments += 1;
  }

  return { id: postId, comments: importedComments };
}

export async function importGuestEntry(ctx, args) {
  await requireAdmin(ctx);
  const legacyId = String((args && args.legacyId) || "").trim().slice(0, 64);
  if (!legacyId) ctx.fail("INVALID_REQUEST", "원본 글 ID(legacyId)가 필요합니다.");

  const { rows: existing } = await ctx.sql`SELECT id FROM guestbook WHERE legacy_id = ${legacyId}`;
  if (existing.length) return { id: existing[0].id, skipped: true };

  const board = await getBoard(ctx, args && args.board);
  const body = text(args && args.body, 5000, "내용", ctx, { required: true });
  const isOwnerEntry = (args && args.isOwner) === true ? 1 : 0;
  const guestName = isOwnerEntry ? "" : String((args && args.name) || "").trim().slice(0, 40);

  const { rows } = await ctx.sql`
    INSERT INTO guestbook (board_id, author_id, is_owner, guest_name, guest_hash, body, is_secret, legacy_id, created_at)
    VALUES (${board.id}, NULL, ${isOwnerEntry}, ${guestName}, '', ${body}, 0, ${legacyId}, ${toTime(ctx, args && args.createdAt)})
    RETURNING id`;
  return { id: rows[0].id };
}
