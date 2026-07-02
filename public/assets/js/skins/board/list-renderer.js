export function renderBoardList(posts, board = {}, options = {}) {
  const deleteMode = Boolean(options.deleteMode);
  const selectedPostIds = new Set(options.selectedPostIds || []);

  if (!Array.isArray(posts) || !posts.length) {
    return '<div class="notice">게시물이 없습니다.</div>';
  }

  return `
    <div class="board-list board-line-list${deleteMode ? " is-delete-mode" : ""}">
      ${posts.map((post) => {
        const title = escapeHtml(post.title || "(제목 없음)");
        const dateStr = toDate(post.createdAt).toLocaleDateString("ko-KR");
        const boardUrl = `/view.html?id=${encodeURIComponent(post.id)}&bo=${encodeURIComponent(post.boardId || board?.id || "board")}`;
        const postId = String(post.id || "");
        const isSelected = selectedPostIds.has(postId);

        return `
          <article class="search-item board-line-item${deleteMode ? " is-delete-mode" : ""}${isSelected ? " is-delete-selected" : ""}" data-post-id="${escapeHtml(postId)}">
            ${deleteMode ? `
              <label class="board-line-select" aria-label="게시물 선택">
                <input type="checkbox" data-board-select="${escapeHtml(postId)}" ${isSelected ? "checked" : ""}>
              </label>
            ` : ""}
            <a href="${boardUrl}" class="board-line-title">${title}</a>
            <span class="board-line-date">${escapeHtml(dateStr)}</span>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function toDate(createdAt) {
  const value = createdAt?.toDate ? createdAt.toDate() : new Date(createdAt);
  return Number.isNaN(value.getTime()) ? new Date(0) : value;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}
