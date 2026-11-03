-- NARU BOARD 초기 테이블
-- 나루가 이 파일을 번호 순서대로 한 번씩 적용합니다. 적용된 파일은 고치지 말고,
-- 구조 변경은 0002_*.sql 처럼 새 번호 파일로 추가하세요.

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE boards (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  skin TEXT NOT NULL DEFAULT 'BOARD',
  menu_order INTEGER NOT NULL DEFAULT 0,
  menu_visible INTEGER NOT NULL DEFAULT 1,
  is_public INTEGER NOT NULL DEFAULT 1,
  member_write INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- 회원 프로필: 나루 회원 ID ↔ 이 사이트에서 쓰는 닉네임
CREATE TABLE profiles (
  member_id TEXT PRIMARY KEY,
  nickname TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id TEXT NOT NULL,
  author_id TEXT,                          -- NULL = 관리자(사이트 소유자) 글
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  thumb TEXT NOT NULL DEFAULT '',
  images TEXT NOT NULL DEFAULT '[]',       -- JSON 배열(URL 목록)
  is_secret INTEGER NOT NULL DEFAULT 0,
  secret_hash TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_posts_board ON posts (board_id, id DESC);

CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  author_id TEXT,                          -- NULL = 게스트 또는 관리자
  is_owner INTEGER NOT NULL DEFAULT 0,     -- 관리자 댓글 표시용
  guest_name TEXT NOT NULL DEFAULT '',
  guest_hash TEXT NOT NULL DEFAULT '',     -- 게스트 비밀번호 해시(수정·삭제·비밀 열람용)
  body TEXT NOT NULL DEFAULT '',
  is_secret INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_comments_post ON comments (post_id, id);

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
