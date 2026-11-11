-- NARU BOARD Copyright (c) 2026 NAMWALL — MPL-2.0 (https://mozilla.org/MPL/2.0/)
-- NARU BOARD 테이블
-- 나루가 이 폴더의 파일을 이름 순서대로 한 번씩 적용합니다. 적용된 파일은 고치지 말고,
-- 구조를 바꿀 때는 뒤 번호의 새 파일을 더하세요.

-- 사이트 설정 (제목·홈 소개·디자인 등)
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE boards (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  title_image TEXT NOT NULL DEFAULT '',      -- 메뉴에 이름 대신 보일 이미지
  skin TEXT NOT NULL DEFAULT 'BOARD',
  menu_order INTEGER NOT NULL DEFAULT 0,
  page_size INTEGER NOT NULL DEFAULT 0,      -- 0 = 기본
  menu_visible INTEGER NOT NULL DEFAULT 1,
  is_public INTEGER NOT NULL DEFAULT 1,      -- 0 = 관리자 전용
  member_write INTEGER NOT NULL DEFAULT 0,   -- 1 = 회원 글쓰기 허용
  options TEXT NOT NULL DEFAULT '{}',        -- 스킨 옵션 JSON
  created_at INTEGER NOT NULL
);

-- 회원 프로필: 나루 회원 번호 ↔ 이 사이트에서 쓰는 닉네임
CREATE TABLE profiles (
  member_id TEXT PRIMARY KEY,
  nickname TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id TEXT NOT NULL,
  author_id TEXT,                            -- NULL = 관리자 글
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  thumb TEXT NOT NULL DEFAULT '',            -- 대표 이미지 (VIDEO 글은 영상 임베드 주소)
  images TEXT NOT NULL DEFAULT '[]',         -- JSON 배열(URL)
  attachments TEXT NOT NULL DEFAULT '[]',    -- JSON 배열({url, name})
  tags TEXT NOT NULL DEFAULT '[]',           -- JSON 배열
  source TEXT NOT NULL DEFAULT '',
  log_no INTEGER NOT NULL DEFAULT 0,         -- LOG 스킨 로그 번호
  category TEXT NOT NULL DEFAULT '',         -- 게시판 options.categories 중 하나
  skin_data TEXT NOT NULL DEFAULT '{}',      -- 스킨별 부가 데이터 JSON (SCRIPT·PROFILE·VIDEO)
  is_secret INTEGER NOT NULL DEFAULT 0,
  member_only INTEGER NOT NULL DEFAULT 0,    -- 1 = 로그인 회원만 열람
  secret_hash TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_posts_board ON posts (board_id, id DESC);

-- 댓글: 게시글(post_id) 또는 방명록 항목(guestbook_id, 이때 post_id = 0)에 단다
CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  guestbook_id INTEGER NOT NULL DEFAULT 0,
  parent_id INTEGER NOT NULL DEFAULT 0,      -- 답글이면 부모 댓글 번호
  author_id TEXT,                            -- NULL = 게스트 또는 관리자
  is_owner INTEGER NOT NULL DEFAULT 0,       -- 관리자 댓글
  guest_name TEXT NOT NULL DEFAULT '',
  guest_hash TEXT NOT NULL DEFAULT '',       -- 게스트 비밀번호 해시(삭제·비밀 열람)
  body TEXT NOT NULL DEFAULT '',
  images TEXT NOT NULL DEFAULT '[]',         -- JSON 배열(URL)
  is_secret INTEGER NOT NULL DEFAULT 0,
  more INTEGER NOT NULL DEFAULT 0,           -- 1 = 접힌 상태로 표시
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_comments_post ON comments (post_id, id);
CREATE INDEX comments_parent ON comments (parent_id);
CREATE INDEX comments_guestbook ON comments (guestbook_id, id);

CREATE TABLE guestbook (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id TEXT NOT NULL,
  author_id TEXT,
  is_owner INTEGER NOT NULL DEFAULT 0,
  guest_name TEXT NOT NULL DEFAULT '',
  guest_hash TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  is_secret INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_guestbook_board ON guestbook (board_id, id DESC);
