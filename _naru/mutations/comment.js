// 댓글 — 회원·게스트 작성, 삭제(관리자·작성자·게스트 비밀번호)
// 이미지 첨부는 회원·관리자만 (나루 미디어 업로드가 회원 전용이므로)
import { text, getBoard, assertBoardReadable, assertGuestWriteAllowed, requireProfile, parseImages, isOwner } from "../modules/guard.js";

export async function add(ctx, args) {
  const owner = await isOwner(ctx);
  const postId = Number(args && args.post) || 0;
  const { rows } = await ctx.sql`SELECT board_id, member_only FROM posts WHERE id = ${postId}`;
  if (!rows.length) ctx.fail("NOT_FOUND", "게시물을 찾을 수 없습니다.");
  const board = await getBoard(ctx, rows[0].board_id);
  assertBoardReadable(ctx, board, owner);
  if (rows[0].member_only && !owner && !ctx.member) {
    ctx.fail("ACCESS_DENIED", "회원만 볼 수 있는 글입니다.");
  }
  assertGuestWriteAllowed(ctx, board, owner, "댓글");

  const hasImages = Array.isArray(args && args.images) && args.images.length > 0;
  const body = text(args && args.body, 5000, "내용", ctx, { required: !hasImages });
  const isSecret = (args && args.secret) === true ? 1 : 0;
  const more = (args && args.more) === true ? 1 : 0; // 접기(작성 시 접힌 상태로 표시)
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
    if (hasImages) ctx.fail("ACCESS_DENIED", "이미지 첨부는 회원만 할 수 있습니다.");
    guestName = text(args && args.name, 40, "닉네임", ctx, { required: true });
    if (isSecret && !password) ctx.fail("INVALID_REQUEST", "비밀 댓글은 비밀번호를 입력하세요.");
    if (password) guestHash = await ctx.passwords.hash(password);
  }
  const images = parseImages(args && args.images, ctx, 8);

  const { rows: inserted } = await ctx.sql`
    INSERT INTO comments (post_id, author_id, is_owner, guest_name, guest_hash, body, images, is_secret, more, created_at)
    VALUES (${postId}, ${authorId}, ${isOwnerFlag}, ${guestName}, ${guestHash}, ${body}, ${images}, ${isSecret}, ${more}, ${ctx.now})
    RETURNING id`;
  return { id: inserted[0].id };
}

export async function remove(ctx, args) {
  const owner = await isOwner(ctx);
  const id = Number(args && args.id) || 0;
  const { rows } = await ctx.sql`SELECT author_id, guest_hash FROM comments WHERE id = ${id}`;
  if (!rows.length) ctx.fail("NOT_FOUND", "댓글을 찾을 수 없습니다.");
  const row = rows[0];

  const mine = !!row.author_id && !!ctx.member && row.author_id === ctx.member.id;
  let allowed = owner || mine;
  if (!allowed && row.guest_hash) {
    const password = String((args && args.password) || "");
    if (!password) ctx.fail("ACCESS_DENIED", "비밀번호를 입력하세요.", { needPassword: true });
    allowed = await ctx.passwords.verify(password, row.guest_hash, `comment:${id}`);
    if (!allowed) ctx.fail("ACCESS_DENIED", "비밀번호가 일치하지 않습니다.");
  }
  if (!allowed) ctx.fail("ACCESS_DENIED", "작성자만 삭제할 수 있습니다.");

  await ctx.sql`DELETE FROM comments WHERE id = ${id}`;
  return null;
}
