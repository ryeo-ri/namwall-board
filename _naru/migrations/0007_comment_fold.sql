-- 댓글 "접기": 작성 시 체크하면 접힌 상태로 표시되고 '펼치기'로 연다 (원본 more 필드)
ALTER TABLE comments ADD COLUMN more INTEGER NOT NULL DEFAULT 0;
