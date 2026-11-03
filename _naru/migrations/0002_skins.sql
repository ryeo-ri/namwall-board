-- 스킨 확장: 게시판별 스킨 옵션(JSON) + 댓글 이미지 첨부
ALTER TABLE boards ADD COLUMN options TEXT NOT NULL DEFAULT '{}';
ALTER TABLE comments ADD COLUMN images TEXT NOT NULL DEFAULT '[]';
