function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

export function isAdminOnlyBoard(board) {
  return board?.isPublic === false;
}

export function renderAdminOnlyBoardNotice(boardTitle = "") {
  const safeTitle = String(boardTitle || "").trim();

  return `
    <section class="card board-access-denied-card">
      <p class="board-access-denied-kicker">ADMIN ONLY</p>
      <h1>관리자 전용 게시판입니다.</h1>
      ${safeTitle ? `<p class="muted small board-access-denied-board-title">${escapeHtml(safeTitle)}</p>` : ""}
      <p class="muted">이 게시판은 관리자 로그인 후에만 볼 수 있습니다.</p>
      <div class="formRow board-access-denied-actions mt-md">
        <a class="btn primary" href="/admin/login.html">관리자 로그인</a>
        <a class="btn" href="/index.html">홈으로</a>
      </div>
    </section>
  `;
}

export function renderHiddenBoardNotice(boardTitle = "") {
  const safeTitle = String(boardTitle || "").trim();

  return `
    <section class="card board-access-denied-card">
      <p class="board-access-denied-kicker">COMING SOON</p>
      <h1>프로필 게시판은 준비 중입니다.</h1>
      ${safeTitle ? `<p class="muted small board-access-denied-board-title">${escapeHtml(safeTitle)}</p>` : ""}
      <p class="muted">현재는 프로필 게시판을 노출하지 않습니다.</p>
      <div class="formRow board-access-denied-actions mt-md">
        <a class="btn primary" href="/index.html">홈으로</a>
      </div>
    </section>
  `;
}
