// 사이트 관리 뮤테이션 — 관리자(소유자) 전용
import { text, requireOwner } from "../modules/guard.js";

const BOARD_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SKINS = ["BOARD", "GUESTBOOK", "GALLERY", "THREAD", "LOG", "SCRIPT", "PROFILE"];

// 홈·사이트 설정으로 저장을 허용하는 키와 최대 길이
const SETTING_KEYS = {
  title: 60,
  ownerName: 40,         // 관리자 글·댓글에 표시할 이름 (기본 "관리자")
  intro: 20000,          // 홈 소개 HTML
  homeShowText: 4,       // "1"이면 소개 텍스트 칼럼 표시
  homeImages: 8000,      // JSON 배열: [{url}]
  homeIntroWidth: 8,
  homeImageWidth: 8,
  homeImageHeight: 8,
  homeHeaderWidth: 8,
  homeShowRecent: 4,     // "0"이면 홈 하단 메뉴에서 최근 업데이트 숨김
  homeShowSearch: 4,     // "0"이면 홈 하단 메뉴에서 검색 숨김
  homeShowTags: 4,       // "0"이면 홈 하단 메뉴에서 최근 태그 숨김
  design: 4000,          // 디자인 설정 JSON (색·폰트)
  headerFontFamily: 80   // 로고/내비 폰트
};

// 스킨 옵션 — 허용된 키만 걸러서 JSON으로 저장
function cleanOptions(ctx, raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const out = {};
  const boardWidth = Number(source.boardWidth);
  if (Number.isFinite(boardWidth) && boardWidth >= 1) out.boardWidth = Math.min(4000, Math.round(boardWidth));
  const columns = Number(source.galleryColumns);
  if (Number.isFinite(columns)) out.galleryColumns = Math.max(1, Math.min(6, Math.round(columns)));
  const position = String(source.commentPosition || "").toLowerCase();
  if (["bottom", "left"].includes(position)) out.commentPosition = position;
  if (source.detailThumb === false) out.detailThumb = false;
  const imageWidth = Number(source.imageWidth);
  if (Number.isFinite(imageWidth) && imageWidth >= 0) out.imageWidth = Math.min(2400, Math.round(imageWidth));
  const json = JSON.stringify(out);
  if (json.length > 2000) ctx.fail("INVALID_REQUEST", "스킨 옵션이 너무 큽니다.");
  return json;
}

export async function saveSettings(ctx, args) {
  requireOwner(ctx);
  const entries = args && typeof args === "object" && !Array.isArray(args) ? args : {};
  for (const [key, max] of Object.entries(SETTING_KEYS)) {
    if (!Object.prototype.hasOwnProperty.call(entries, key)) continue;
    const value = text(entries[key], max, `설정(${key})`, ctx);
    await ctx.sql`INSERT INTO settings (key, value) VALUES (${key}, ${value})
      ON CONFLICT (key) DO UPDATE SET value = ${value}`;
  }
  return null;
}

export async function saveBoard(ctx, args) {
  requireOwner(ctx);
  const id = String((args && args.id) || "").trim();
  if (!BOARD_ID_RE.test(id)) ctx.fail("INVALID_REQUEST", "게시판 ID는 영문·숫자·_- 1~64자입니다.");
  const title = text(args && args.title, 60, "게시판 이름", ctx) || id;
  const description = text(args && args.description, 500, "게시판 설명", ctx);
  const titleImage = text(args && args.titleImage, 2048, "제목 이미지 주소", ctx);
  const skin = SKINS.includes(args && args.skin) ? args.skin : "BOARD";
  const menuOrder = Number(args && args.menuOrder) || 0;
  const pageSize = Math.max(0, Math.min(100, Number(args && args.pageSize) || 0));
  const menuVisible = (args && args.menuVisible) === false ? 0 : 1;
  const isPublic = (args && args.isPublic) === false ? 0 : 1;
  const memberWrite = (args && args.memberWrite) === true ? 1 : 0;
  const options = cleanOptions(ctx, args && args.options);

  await ctx.sql`
    INSERT INTO boards (id, title, description, title_image, skin, menu_order, page_size, menu_visible, is_public, member_write, options, created_at)
    VALUES (${id}, ${title}, ${description}, ${titleImage}, ${skin}, ${menuOrder}, ${pageSize}, ${menuVisible}, ${isPublic}, ${memberWrite}, ${options}, ${ctx.now})
    ON CONFLICT (id) DO UPDATE SET
      title = ${title}, description = ${description}, title_image = ${titleImage}, skin = ${skin},
      menu_order = ${menuOrder}, page_size = ${pageSize},
      menu_visible = ${menuVisible}, is_public = ${isPublic}, member_write = ${memberWrite}, options = ${options}`;
  return null;
}

// 관리자 회원 계정 연결 — 나루 관리자 로그인은 페이지 단위라, 사이트 전역에서
// 유지되는 회원 로그인을 관리자로 인정해 모든 페이지에서 글쓰기·관리가 되게 한다.
// memberId를 비우면 연결 해제. (연결/해제는 관리자 페이지의 소유자만 가능)
export async function linkOwnerMember(ctx, args) {
  requireOwner(ctx);
  const memberId = String((args && args.memberId) || "").trim().slice(0, 128);
  if (!memberId) {
    await ctx.sql`DELETE FROM settings WHERE key = 'ownerMemberId'`;
    return null;
  }
  await ctx.sql`INSERT INTO settings (key, value) VALUES ('ownerMemberId', ${memberId})
    ON CONFLICT (key) DO UPDATE SET value = ${memberId}`;
  return null;
}

export async function removeBoard(ctx, args) {
  requireOwner(ctx);
  const id = String((args && args.id) || "").trim();
  // 기본: 게시판 설정만 지운다 — 글은 남고, 같은 ID로 다시 만들면 다시 보인다.
  // withPosts: 글·댓글·방명록까지 모두 지운다 (되돌릴 수 없음).
  if ((args && args.withPosts) === true) {
    await ctx.sql`DELETE FROM comments WHERE post_id IN (SELECT id FROM posts WHERE board_id = ${id})`;
    await ctx.sql`DELETE FROM posts WHERE board_id = ${id}`;
    await ctx.sql`DELETE FROM guestbook WHERE board_id = ${id}`;
  }
  await ctx.sql`DELETE FROM boards WHERE id = ${id}`;
  return null;
}
