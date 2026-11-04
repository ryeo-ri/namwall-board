-- 게시판 분류(카테고리): 게시판 options.categories에 정의된 값 중 하나를 글에 저장
ALTER TABLE posts ADD COLUMN category TEXT NOT NULL DEFAULT '';
