// NARU BOARD Copyright (c) 2026 NAMWALL — MPL-2.0 (https://mozilla.org/MPL/2.0/)
// 사이트 관리 뮤테이션 — 관리자(소유자) 전용
import { text, requireOwner } from "../modules/guard.js";

const BOARD_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SKINS = ["BOARD", "GUESTBOOK", "GALLERY", "THREAD", "LOG", "SCRIPT", "PROFILE", "BOOKMARK"];

// 홈·사이트 설정으로 저장을 허용하는 키와 최대 길이
const SETTING_KEYS = {
  title: 60,
  ownerName: 40,         // 관리자 글·댓글에 표시할 이름
  intro: 20000,          // 홈 소개 HTML
  homeShowText: 4,       // "1"이면 소개 글 칼럼 표시
  homeImages: 8000,      // JSON [{url, source?}]
  homeIntroWidth: 8,
  homeImageWidth: 8,
  homeImageHeight: 8,
  homeHeaderWidth: 8,
  homeShowRecent: 4,     // "0"이면 숨김
  homeShowSearch: 4,     // "0"이면 숨김
  homeShowTags: 4,       // "0"이면 숨김
  homeShowLogin: 4,      // "1"이면 표시 (기본 꺼짐)
  design: 4000,          // 디자인 설정 JSON
  headerFontFamily: 80,  // 로고/내비 폰트
  ownerFiles: 4          // "1"이면 사용자 페이지가 /_owner/style.css·script.js를 불러온다
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
  if (source.memberComment === true) out.memberComment = true; // 로그인 회원만 댓글·방명록
  const imageWidth = Number(source.imageWidth);
  if (Number.isFinite(imageWidth) && imageWidth >= 0) out.imageWidth = Math.min(2400, Math.round(imageWidth));
  // 분류 목록 (최대 20개, 각 30자)
  if (Array.isArray(source.categories)) {
    const categories = [];
    for (const item of source.categories) {
      const value = String(item || "").trim().slice(0, 30);
      if (value && !categories.includes(value)) categories.push(value);
      if (categories.length >= 20) break;
    }
    if (categories.length) out.categories = categories;
  }
  // 북마크 게시판 상단 HTML
  const introHtml = String(source.introHtml || "").trim();
  if (introHtml) {
    if (introHtml.length > 10000) ctx.fail("INVALID_REQUEST", "상단 HTML은 10000자까지입니다.");
    out.introHtml = introHtml;
  }
  const json = JSON.stringify(out);
  if (json.length > 13000) ctx.fail("INVALID_REQUEST", "스킨 옵션이 너무 큽니다.");
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

// 메뉴 순서 일괄 변경 — ids 순서대로 menu_order = 0, 1, 2… (전체 게시판 목록이 맞을 때만)
export async function reorderBoards(ctx, args) {
  requireOwner(ctx);
  const ids = Array.isArray(args && args.ids) ? args.ids.map((id) => String(id ?? "").trim()) : [];
  if (!ids.length || ids.length > 200 || !ids.every((id) => BOARD_ID_RE.test(id)) || new Set(ids).size !== ids.length) {
    ctx.fail("INVALID_REQUEST", "게시판 순서 목록이 잘못되었습니다.");
  }
  const list = JSON.stringify(ids);
  const { changes } = await ctx.sql`
    WITH requested AS (
      SELECT value AS id, CAST(key AS INTEGER) AS menu_order
      FROM json_each(${list})
    )
    UPDATE boards
    SET menu_order = (SELECT requested.menu_order FROM requested WHERE requested.id = boards.id)
    WHERE id IN (SELECT id FROM requested)
      AND (SELECT COUNT(*) FROM boards) = (SELECT COUNT(*) FROM requested)
      AND NOT EXISTS (
        SELECT 1 FROM boards
        LEFT JOIN requested ON requested.id = boards.id
        WHERE requested.id IS NULL
      )`;
  if (changes !== ids.length) {
    ctx.fail("CONFLICT", "게시판 목록이 변경되었습니다. 목록을 새로고침한 뒤 다시 시도하세요.");
  }
  return null;
}

// 관리자 회원 계정 연결 (memberId를 비우면 해제) — guard.js isOwner 참고
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
  // 게시판의 글·댓글·방명록도 함께 지운다
  await ctx.sql`DELETE FROM comments WHERE post_id IN (SELECT id FROM posts WHERE board_id = ${id})`;
  await ctx.sql`DELETE FROM posts WHERE board_id = ${id}`;
  await ctx.sql`DELETE FROM comments WHERE guestbook_id IN (SELECT id FROM guestbook WHERE board_id = ${id})`;
  await ctx.sql`DELETE FROM guestbook WHERE board_id = ${id}`;
  await ctx.sql`DELETE FROM boards WHERE id = ${id}`;
  return null;
}
