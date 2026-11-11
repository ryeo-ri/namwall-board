// NARU BOARD Copyright (c) 2026 NAMWALL — MPL-2.0 (https://mozilla.org/MPL/2.0/)
// 댓글 — 작성(회원·게스트·관리자), 삭제(관리자·작성자·게스트 비밀번호)
// 게시글 또는 방명록 항목에 단다. 이미지 첨부는 회원·관리자만(나루 미디어 업로드가 회원 전용).
// 답글: parent = 같은 곳의 댓글 번호. 댓글을 지우면 그 아래 답글까지 함께 지운다.
import { text, assertGuestWriteAllowed, parseImages, isOwner, resolveCommentTarget, resolveAuthor, assertCanDelete } from "../modules/guard.js";

const REPLY_SKINS = ["BOARD", "LOG", "THREAD", "GUESTBOOK"];
// ctx.sql 한 문장의 한도: 돌려주는 행 1,000개, 묶는 값 100개
const THREAD_PAGE = 1000;
const DELETE_CHUNK = 90;

export async function add(ctx, args) {
  const owner = await isOwner(ctx);
  const { postId, guestbookId, board } = await resolveCommentTarget(ctx, args, owner);
  assertGuestWriteAllowed(ctx, board, owner, "댓글");

  const parentId = Number(args && args.parent) || 0;
  if (parentId) {
    if (!REPLY_SKINS.includes(String(board.skin || "").toUpperCase())) {
      ctx.fail("INVALID_REQUEST", "이 게시판은 답글을 달 수 없습니다.");
    }
    const { rows: parentRows } = await ctx.sql`SELECT post_id, guestbook_id FROM comments WHERE id = ${parentId}`;
    if (!parentRows.length || parentRows[0].post_id !== postId || parentRows[0].guestbook_id !== guestbookId) {
      ctx.fail("NOT_FOUND", "답글을 달 댓글을 찾을 수 없습니다.");
    }
  }

  const hasImages = Array.isArray(args && args.images) && args.images.length > 0;
  const body = text(args && args.body, 5000, "내용", ctx, { required: !hasImages });
  const isSecret = (args && args.secret) === true ? 1 : 0;
  const more = (args && args.more) === true ? 1 : 0; // 접힌 상태로 표시
  const author = await resolveAuthor(ctx, owner, args, {
    nameLabel: "닉네임", isSecret, secretMessage: "비밀 댓글은 비밀번호를 입력하세요.", allowGuest: !hasImages
  });
  const images = parseImages(args && args.images, ctx, 8);

  const { rows: inserted } = await ctx.sql`
    INSERT INTO comments (post_id, guestbook_id, parent_id, author_id, is_owner, guest_name, guest_hash, body, images, is_secret, more, created_at)
    VALUES (${postId}, ${guestbookId}, ${parentId}, ${author.authorId}, ${author.isOwner}, ${author.guestName}, ${author.guestHash}, ${body}, ${images}, ${isSecret}, ${more}, ${ctx.now})
    RETURNING id`;
  return { id: inserted[0].id };
}

export async function remove(ctx, args) {
  const owner = await isOwner(ctx);
  const id = Number(args && args.id) || 0;
  const { rows } = await ctx.sql`SELECT post_id, guestbook_id, author_id, guest_hash FROM comments WHERE id = ${id}`;
  if (!rows.length) ctx.fail("NOT_FOUND", "댓글을 찾을 수 없습니다.");
  const row = rows[0];
  await assertCanDelete(ctx, owner, row, args, `comment:${id}`);

  // 나루는 재귀 쿼리를 거절하므로, 같은 글의 뒤 댓글을 번호순으로 읽어 답글 가지를 따라간다.
  // 답글은 항상 부모보다 번호가 크므로 한 번만 훑으면 된다.
  const doomed = new Set([id]);
  let cursor = id;
  for (;;) {
    const { rows: later } = row.guestbook_id
      ? await ctx.sql`SELECT id, parent_id FROM comments WHERE guestbook_id = ${row.guestbook_id} AND id > ${cursor} ORDER BY id LIMIT ${THREAD_PAGE}`
      : await ctx.sql`SELECT id, parent_id FROM comments WHERE post_id = ${row.post_id} AND id > ${cursor} ORDER BY id LIMIT ${THREAD_PAGE}`;
    for (const item of later) {
      if (doomed.has(item.parent_id)) doomed.add(item.id);
    }
    if (later.length < THREAD_PAGE) break;
    cursor = later[later.length - 1].id;
  }

  const ids = [...doomed];
  let removed = 0;
  for (let index = 0; index < ids.length; index += DELETE_CHUNK) {
    const chunk = ids.slice(index, index + DELETE_CHUNK);
    const { changes } = await ctx.sql(`DELETE FROM comments WHERE id IN (${chunk.map(() => "?").join(", ")})`, chunk);
    removed += changes;
  }
  return { removed };
}
