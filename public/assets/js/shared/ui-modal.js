export function showInputModal({
  title = "입력",
  description = "",
  placeholder = "",
  confirmText = "확인",
  cancelText = "취소",
  inputType = "text",
  validate = null,
  validationMessage = "입력값을 확인해 주세요."
}) {
  return new Promise((resolve) => {
    const root = document.createElement("div");
    root.className = "overlay-modal overlay-modal-input";
    root.innerHTML = `
      <div class="overlay-backdrop"></div>
      <div class="overlay-panel" role="dialog" aria-modal="true" aria-labelledby="overlayInputTitle">
        <h3 id="overlayInputTitle">${escapeHtml(title)}</h3>
        ${description ? `<p class="muted small overlay-input-description">${escapeHtml(description)}</p>` : ""}
        <input id="overlayInput" type="${escapeHtml(inputType)}" placeholder="${escapeHtml(placeholder)}" aria-describedby="overlayInputError">
        <p class="overlay-input-error hidden" id="overlayInputError" role="alert" aria-live="polite"></p>
        <div class="overlay-actions formRow">
          <button type="button" class="btn" id="overlayCancel">${escapeHtml(cancelText)}</button>
          <button type="button" class="btn primary" id="overlayConfirm">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `;

    const input = root.querySelector("#overlayInput");
    const errorEl = root.querySelector("#overlayInputError");
    const confirmButton = root.querySelector("#overlayConfirm");
    let settled = false;
    let validating = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      root.remove();
      resolve(value);
    };

    const showValidationError = (message) => {
      if (!errorEl) return;
      errorEl.textContent = String(message || validationMessage);
      errorEl.classList.remove("hidden");
      input?.setAttribute("aria-invalid", "true");
      input?.focus();
      input?.select();
    };

    const hideValidationError = () => {
      if (!errorEl) return;
      errorEl.textContent = "";
      errorEl.classList.add("hidden");
      input?.removeAttribute("aria-invalid");
    };

    const submit = async () => {
      if (validating || settled) return;
      const value = input?.value || "";
      if (typeof validate !== "function") {
        finish(value);
        return;
      }

      validating = true;
      hideValidationError();
      root.classList.add("is-validating");
      if (confirmButton) confirmButton.disabled = true;
      try {
        const result = await validate(value);
        if (result === true) {
          finish(value);
          return;
        }
        showValidationError(typeof result === "string" ? result : validationMessage);
      } catch (_error) {
        showValidationError(validationMessage);
      } finally {
        validating = false;
        root.classList.remove("is-validating");
        if (confirmButton) confirmButton.disabled = false;
      }
    };

    const cancel = () => {
      if (!validating) finish(null);
    };

    root.querySelector(".overlay-backdrop")?.addEventListener("click", cancel);
    root.querySelector("#overlayCancel")?.addEventListener("click", cancel);
    confirmButton?.addEventListener("click", submit);

    input?.addEventListener("input", hideValidationError);
    input?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void submit();
      }
      if (event.key === "Escape") cancel();
    });

    document.body.appendChild(root);
    input?.focus();
  });
}


function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}
