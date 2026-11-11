// NAMWALL Edition Copyright (c) 2026 NAMWALL — MPL-2.0 (https://mozilla.org/MPL/2.0/)
// 회원 계정 — 닉네임 등록·변경
import { text } from "../modules/guard.js";

const NICK_RE = /^[0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ _\-.]{2,20}$/;

export async function register(ctx, args) {
  if (!ctx.member) ctx.fail("AUTH_REQUIRED", "로그인이 필요합니다.");
  const nickname = text(args && args.nickname, 20, "닉네임", ctx, { required: true });
  if (!NICK_RE.test(nickname)) {
    ctx.fail("INVALID_REQUEST", "닉네임은 한글·영문·숫자 2~20자입니다. (공백·-_. 허용)");
  }
  // 닉네임 UNIQUE 충돌은 나루가 CONFLICT(details.unique)로 돌려준다.
  await ctx.sql`
    INSERT INTO profiles (member_id, nickname, created_at)
    VALUES (${ctx.member.id}, ${nickname}, ${ctx.now})
    ON CONFLICT (member_id) DO UPDATE SET nickname = ${nickname}`;
  return { nickname };
}
