export function initLightbox(postIds) {
  return Array.isArray(postIds) ? postIds.length : 0;
}

window.openLightbox = function(imageUrl) {
  if (!imageUrl) return;

  window.closeLightbox?.();

  const lightbox = document.createElement("div");
  lightbox.id = "lightbox";
  lightbox.className = "lightbox";
  lightbox.innerHTML = `
    <div class="lightbox-backdrop"></div>
    <div class="lightbox-content">
      <img src="${escapeHtml(imageUrl)}" alt="원본 이미지" class="lightbox-image">
    </div>
  `;

  document.body.appendChild(lightbox);
  document.body.style.overflow = "hidden";
  lightbox.addEventListener("click", () => closeLightbox());
  document.addEventListener("keydown", handleLightboxKeydown);
};

window.closeLightbox = function() {
  const lightbox = document.getElementById("lightbox");
  if (lightbox) {
    lightbox.remove();
  }
  document.body.style.overflow = "";
  document.removeEventListener("keydown", handleLightboxKeydown);
};

function handleLightboxKeydown(event) {
  if (event.key === "Escape") {
    closeLightbox();
  }
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}
