// NAMWALL Edition Copyright (c) 2026 NAMWALL — MPL-2.0 (https://mozilla.org/MPL/2.0/)
// 라이트박스 — [data-lightbox-image] 클릭으로 연다. 큰 이미지는 화면에 맞춰 줄이고(누르면 원본 크기로 확대),
// 작은 이미지는 원본 크기 그대로. 이미지 밖을 누르거나 Esc로 닫는다.
let updateLightboxZoomable = null;

window.openLightbox = function(imageUrl) {
  if (!imageUrl) return;
  let source;
  try {
    const url = new URL(String(imageUrl), document.baseURI);
    if (!["http:", "https:", "blob:"].includes(url.protocol) && !/^data:image\//i.test(url.href)) return;
    source = url.href;
  } catch { return; }

  window.closeLightbox?.();

  const lightbox = document.createElement("div");
  lightbox.id = "lightbox";
  lightbox.className = "lightbox";
  lightbox.innerHTML = `
    <div class="lightbox-backdrop"></div>
    <div class="lightbox-content">
      <img alt="원본 이미지" class="lightbox-image">
    </div>
  `;
  const image = lightbox.querySelector(".lightbox-image");
  image.src = source;

  document.body.appendChild(lightbox);
  document.body.style.overflow = "hidden";
  lightbox.addEventListener("click", (event) => {
    if (event.target !== image) {
      closeLightbox();
      return;
    }
    // 확대된 상태면 창 크기가 바뀌었어도 눌러서 되돌릴 수 있게
    if (lightbox.matches(".is-zoomable, .is-zoomed")) toggleLightboxZoom(lightbox, image, event);
  });

  updateLightboxZoomable = () => {
    const box = lightbox.getBoundingClientRect();
    const zoomable = image.naturalWidth > box.width + 1 || image.naturalHeight > box.height + 1;
    lightbox.classList.toggle("is-zoomable", zoomable);
  };
  // 화면 맞춤 크기는 CSS가 --lightbox-ratio로 계산한다 (원본 너비는 넘지 않게)
  const onImageLoad = () => {
    if (!lightbox.isConnected) return;
    lightbox.style.setProperty("--lightbox-ratio", String(image.naturalWidth / image.naturalHeight || 1));
    if (image.naturalWidth) image.style.maxWidth = `${image.naturalWidth}px`;
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

// 나중에 그려지는 이미지 버튼도 처리하도록 문서에 위임
document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target.closest("[data-lightbox-image]") : null;
  if (!target || event.defaultPrevented) return;
  event.preventDefault();
  window.openLightbox(target.dataset.lightboxImage);
});
