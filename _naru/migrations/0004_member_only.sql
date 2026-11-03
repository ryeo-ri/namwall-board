-- 회원 공개: 로그인한 회원(과 관리자)만 볼 수 있는 글.
-- 비회원에게는 목록·검색·최근 업데이트에서도 숨긴다.
ALTER TABLE posts ADD COLUMN member_only INTEGER NOT NULL DEFAULT 0;
