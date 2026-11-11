// NARU BOARD Copyright (c) 2026 NAMWALL — MPL-2.0 (https://mozilla.org/MPL/2.0/)
// 방명록 — 작성(회원·게스트·관리자), 삭제(관리자·작성자·게스트 비밀번호)
import { text, getBoard, assertBoardReadable, assertGuestWriteAllowed, isOwner, resolveAuthor, assertCanDelete } from "../modules/guard.js";

export async function add(ctx, args) {
  const owner = await isOwner(ctx);
  const board = await getBoard(ctx, args && args.board);
  assertBoardReadable(ctx, board, owner);
  assertGuestWriteAllowed(ctx, board, owner, "방명록");

  const body = text(args && args.body, 5000, "내용", ctx, { required: true });
  const isSecret = (args && args.secret) === true ? 1 : 0;
  const author = await resolveAuthor(ctx, owner, args, {
    nameLabel: "이름", isSecret, secretMessage: "비밀글은 비밀번호를 입력하세요."
  });

  const { rows } = await ctx.sql`
    INSERT INTO guestbook (board_id, author_id, is_owner, guest_name, guest_hash, body, is_secret, created_at)
    VALUES (${board.id}, ${author.authorId}, ${author.isOwner}, ${author.guestName}, ${author.guestHash}, ${body}, ${isSecret}, ${ctx.now})
    RETURNING id`;
  return { id: rows[0].id };
}

export async function remove(ctx, args) {
  const owner = await isOwner(ctx);
  const id = Number(args && args.id) || 0;
  const { rows } = await ctx.sql`SELECT author_id, guest_hash FROM guestbook WHERE id = ${id}`;
  if (!rows.length) ctx.fail("NOT_FOUND", "방명록을 찾을 수 없습니다.");
  await assertCanDelete(ctx, owner, rows[0], args, `guestbook:${id}`);

  // 달린 댓글(답글 포함)도 함께 지운다
  await ctx.sql`DELETE FROM comments WHERE guestbook_id = ${id}`;
  await ctx.sql`DELETE FROM guestbook WHERE id = ${id}`;
  return null;
}
