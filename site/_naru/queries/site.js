// NAMWALL Edition Copyright (c) 2026 NAMWALL — MPL-2.0 (https://mozilla.org/MPL/2.0/)
// 사이트 부트스트랩 — 설정·게시판 목록·내 프로필을 한 번에 (비공개 게시판은 관리자에게만)
import { isOwner } from "../modules/guard.js";

export async function boot(ctx) {
  const owner = await isOwner(ctx);

  const settings = {};
  for (const row of (await ctx.sql`SELECT key, value FROM settings`).rows) {
    settings[row.key] = row.value;
  }
  if (!owner) delete settings.ownerMemberId;

  const boards = owner
    ? (await ctx.sql`SELECT * FROM boards ORDER BY menu_order, id LIMIT 200`).rows
    : (await ctx.sql`SELECT * FROM boards WHERE is_public = 1 ORDER BY menu_order, id LIMIT 200`).rows;

  let me = null;
  if (ctx.member) {
    const { rows } = await ctx.sql`SELECT nickname FROM profiles WHERE member_id = ${ctx.member.id}`;
    me = {
      id: ctx.member.id,
      nickname: rows.length ? rows[0].nickname : null
    };
  }

  // 새 사이트: 제목이 없고 게시판이 하나도 없음 (비공개 게시판까지 센다 — 방문자에게는 참/거짓만 알린다)
  const { rows: counted } = await ctx.sql`SELECT COUNT(*) AS n FROM boards`;
  const isNew = !String(settings.title || "").trim() && Number(counted[0].n) === 0;

  return { settings, boards, me, owner, isNew };
}
