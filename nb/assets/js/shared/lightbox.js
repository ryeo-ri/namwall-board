// 원본 라이트박스 — 이미지 높이를 화면 높이에 맞춰 띄운다 (가로로 긴 이미지는 화면 너비에 맞춤).
// 맞춘 크기가 원본보다 작으면 이미지를 눌러 원본 크기로 확대(누른 지점 기준), 다시 누르면 축소.
// 이미지 밖(빈 화면)을 누르거나 Esc를 누르면 닫힌다.
let updateLightboxZoomable = null; // 열린 라이트박스의 확대 가능 여부 갱신(resize 리스너)

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
  const image = lightbox.querySelector(".lightbox-image");

  document.body.appendChild(lightbox);
  document.body.style.overflow = "hidden";
  lightbox.addEventListener("click", (event) => {
    if (event.target !== image) {
      closeLightbox();
      return;
    }
    // 확대된 상태면(창 크기가 바뀌어 확대 대상이 아니게 됐어도) 눌러서 되돌릴 수 있게
    if (lightbox.matches(".is-zoomable, .is-zoomed")) toggleLightboxZoom(lightbox, image, event);
  });

  updateLightboxZoomable = () => {
    const box = lightbox.getBoundingClientRect();
    const zoomable = image.naturalWidth > box.width + 1 || image.naturalHeight > box.height + 1;
    lightbox.classList.toggle("is-zoomable", zoomable);
  };
  // 화면 맞춤 크기는 CSS가 이미지 비율(--lightbox-ratio)로 계산한다
  const onImageLoad = () => {
    lightbox.style.setProperty("--lightbox-ratio", String(image.naturalWidth / image.naturalHeight || 1));
    updateLightboxZoomable();
  };
  if (image.complete) onImageLoad();
  else image.addEventListener("load", onImageLoad);
  window.addEventListener("resize", updateLightboxZoomable);
  document.addEventListener("keydown", handleLightboxKeydown);
};

window.closeLightbox = function() {
  const lightbox = document.getElementById("lightbox");
  if (lightbox) {
    lightbox.remove();
  }
  document.body.style.overflow = "";
  document.removeEventListener("keydown", handleLightboxKeydown);
  if (updateLightboxZoomable) window.removeEventListener("resize", updateLightboxZoomable);
  updateLightboxZoomable = null;
};

function toggleLightboxZoom(lightbox, image, event) {
  if (lightbox.classList.contains("is-zoomed")) {
    lightbox.classList.remove("is-zoomed");
    lightbox.scrollTo(0, 0);
    return;
  }
  // 누른 지점이 확대 후에도 커서(손가락) 아래에 오도록 스크롤을 옮긴다
  const rect = image.getBoundingClientRect();
  const ratioX = (event.clientX - rect.left) / rect.width;
  const ratioY = (event.clientY - rect.top) / rect.height;
  lightbox.classList.add("is-zoomed");
  lightbox.scrollLeft = ratioX * image.offsetWidth - event.clientX;
  lightbox.scrollTop = ratioY * image.offsetHeight - event.clientY;
}

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
