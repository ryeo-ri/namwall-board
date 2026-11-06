// 방명록 — 회원·게스트 작성, 삭제(관리자·작성자·게스트 비밀번호)
import { text, getBoard, assertBoardReadable, assertGuestWriteAllowed, requireProfile, isOwner } from "../modules/guard.js";

export async function add(ctx, args) {
  const owner = await isOwner(ctx);
  const board = await getBoard(ctx, args && args.board);
  assertBoardReadable(ctx, board, owner);
  assertGuestWriteAllowed(ctx, board, owner, "방명록");

  const body = text(args && args.body, 5000, "내용", ctx, { required: true });
  const isSecret = (args && args.secret) === true ? 1 : 0;
  const password = String((args && args.password) || "");

  let authorId = null;
  let isOwnerFlag = 0;
  let guestName = "";
  let guestHash = "";
  if (owner) {
    isOwnerFlag = 1;
  } else if (ctx.member) {
    await requireProfile(ctx);
    authorId = ctx.member.id;
  } else {
    guestName = text(args && args.name, 40, "이름", ctx, { required: true });
    if (isSecret && !password) ctx.fail("INVALID_REQUEST", "비밀글은 비밀번호를 입력하세요.");
    if (password) guestHash = await ctx.passwords.hash(password);
  }

  const { rows } = await ctx.sql`
    INSERT INTO guestbook (board_id, author_id, is_owner, guest_name, guest_hash, body, is_secret, created_at)
    VALUES (${board.id}, ${authorId}, ${isOwnerFlag}, ${guestName}, ${guestHash}, ${body}, ${isSecret}, ${ctx.now})
    RETURNING id`;
  return { id: rows[0].id };
}

export async function remove(ctx, args) {
  const owner = await isOwner(ctx);
  const id = Number(args && args.id) || 0;
  const { rows } = await ctx.sql`SELECT author_id, guest_hash FROM guestbook WHERE id = ${id}`;
  if (!rows.length) ctx.fail("NOT_FOUND", "방명록을 찾을 수 없습니다.");
  const row = rows[0];

  const mine = !!row.author_id && !!ctx.member && row.author_id === ctx.member.id;
  let allowed = owner || mine;
  if (!allowed && row.guest_hash) {
    const password = String((args && args.password) || "");
    if (!password) ctx.fail("ACCESS_DENIED", "비밀번호를 입력하세요.", { needPassword: true });
    allowed = await ctx.passwords.verify(password, row.guest_hash, `guestbook:${id}`);
    if (!allowed) ctx.fail("ACCESS_DENIED", "비밀번호가 일치하지 않습니다.");
  }
  if (!allowed) ctx.fail("ACCESS_DENIED", "작성자만 삭제할 수 있습니다.");

  await ctx.sql`DELETE FROM guestbook WHERE id = ${id}`;
  return null;
}
