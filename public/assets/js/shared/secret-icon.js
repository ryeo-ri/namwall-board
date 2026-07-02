export function renderLockIcon(className = "", label = "비밀글") {
  const extraClass = className ? ` ${className}` : "";
  return `
    <svg viewBox="0 0 24 24" class="secret-lock-icon${extraClass}" role="img" aria-label="${escapeHtml(label)}" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M8 11V8a4 4 0 1 1 8 0v3"></path>
      <rect x="5" y="11" width="14" height="9" rx="2"></rect>
    </svg>
  `;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = String(text ?? "");
  return div.innerHTML;
}
