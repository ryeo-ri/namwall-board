export function showInputModal({
  title = "입력",
  placeholder = "",
  confirmText = "확인",
  cancelText = "취소",
  inputType = "text"
}) {
  return new Promise((resolve) => {
    const root = document.createElement("div");
    root.className = "overlay-modal overlay-modal-input";
    root.innerHTML = `
      <div class="overlay-backdrop"></div>
      <div class="overlay-panel card">
        <h3>${escapeHtml(title)}</h3>
        <input id="overlayInput" type="${inputType}" placeholder="${escapeHtml(placeholder)}">
        <div class="overlay-actions formRow">
          <button class="btn" id="overlayCancel">${escapeHtml(cancelText)}</button>
          <button class="btn primary" id="overlayConfirm">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `;

    const finish = (value) => {
      root.remove();
      resolve(value);
    };

    root.querySelector(".overlay-backdrop")?.addEventListener("click", () => finish(null));
    root.querySelector("#overlayCancel")?.addEventListener("click", () => finish(null));
    root.querySelector("#overlayConfirm")?.addEventListener("click", () => {
      finish(root.querySelector("#overlayInput")?.value || "");
    });

    root.querySelector("#overlayInput")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") finish(root.querySelector("#overlayInput")?.value || "");
      if (event.key === "Escape") finish(null);
    });

    document.body.appendChild(root);
    root.querySelector("#overlayInput")?.focus();
  });
}

export function showTextareaModal({
  title = "입력",
  placeholder = "",
  value = "",
  confirmText = "확인",
  cancelText = "취소",
  rows = 8
}) {
  return new Promise((resolve) => {
    const root = document.createElement("div");
    root.className = "overlay-modal overlay-modal-input";
    root.innerHTML = `
      <div class="overlay-backdrop"></div>
      <div class="overlay-panel card">
        <h3>${escapeHtml(title)}</h3>
        <textarea id="overlayTextarea" class="textarea" rows="${Number(rows) || 8}" placeholder="${escapeHtml(placeholder)}">${escapeHtml(value)}</textarea>
        <div class="overlay-actions formRow">
          <button class="btn" id="overlayCancel">${escapeHtml(cancelText)}</button>
          <button class="btn primary" id="overlayConfirm">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `;

    const finish = (result) => {
      root.remove();
      resolve(result);
    };

    root.querySelector(".overlay-backdrop")?.addEventListener("click", () => finish(null));
    root.querySelector("#overlayCancel")?.addEventListener("click", () => finish(null));
    root.querySelector("#overlayConfirm")?.addEventListener("click", () => {
      finish(root.querySelector("#overlayTextarea")?.value || "");
    });

    root.querySelector("#overlayTextarea")?.addEventListener("keydown", (event) => {
      if (event.key === "Escape") finish(null);
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        finish(root.querySelector("#overlayTextarea")?.value || "");
      }
    });

    document.body.appendChild(root);
    root.querySelector("#overlayTextarea")?.focus();
  });
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}
