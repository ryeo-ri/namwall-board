-- SCRIPT 스킨(TRPG 플레이 로그): 글에 스킨별 부가 데이터(JSON)를 저장
-- 예: {"script":{"system":"CoC 7th","archiveUrl":"...","messageCount":1234,...}}
ALTER TABLE posts ADD COLUMN skin_data TEXT NOT NULL DEFAULT '{}';
