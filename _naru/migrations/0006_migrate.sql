-- Firebase판(300.30) 데이터 이사: 원본 문서 ID를 기억해 중복 이사를 막는다
ALTER TABLE posts ADD COLUMN legacy_id TEXT NOT NULL DEFAULT '';
ALTER TABLE guestbook ADD COLUMN legacy_id TEXT NOT NULL DEFAULT '';
