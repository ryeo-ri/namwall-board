import { makeNaru, extractYouTubeId, naruErrorMessage } from "./common.js";

const app = document.getElementById("app");

function showStatus(message) {
  app.innerHTML = "";
  const p = document.createElement("p");
  p.className = "viewer-status";
  p.textContent = message;
  app.appendChild(p);
}

function renderScroll(images) {
  const wrap = document.createElement("div");
  wrap.className = "scroll-view";
  for (const img of images) {
    const el = document.createElement("img");
    el.src = img.url;
    el.alt = img.name || "";
    el.loading = "lazy";
    wrap.appendChild(el);
  }
  return wrap;
}

function renderPaged(images) {
  const wrap = document.createElement("div");
  wrap.className = "page-view";

  const img = document.createElement("img");
  const counter = document.createElement("p");
  counter.className = "page-counter";
  wrap.appendChild(img);
  wrap.appendChild(counter);

  let index = 0;

  function prefetch(i) {
    if (images[i]) {
      const pre = new Image();
      pre.src = images[i].url;
    }
  }

  function show(i) {
    index = (i + images.length) % images.length;
    img.src = images[index].url;
    img.alt = images[index].name || "";
    counter.textContent = `${index + 1} / ${images.length}`;
    prefetch((index + 1) % images.length);
  }

  img.addEventListener("click", () => show(index + 1));
  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") show(index + 1);
    else if (e.key === "ArrowLeft") show(index - 1);
  });

  show(0);
  return wrap;
}

function renderBgm(bgmUrl) {
  const id = extractYouTubeId(bgmUrl);
  if (!id) return null;
  const bar = document.createElement("div");
  bar.className = "bgm-bar";
  const label = document.createElement("span");
  label.className = "bgm-label";
  label.textContent = "BGM";
  const iframe = document.createElement("iframe");
  iframe.src = `https://www.youtube-nocookie.com/embed/${id}`;
  iframe.allow = "encrypted-media";
  iframe.title = "BGM";
  bar.appendChild(label);
  bar.appendChild(iframe);
  return bar;
}

async function main() {
  const id = new URLSearchParams(location.search).get("id");
  if (!id) {
    showStatus("잘못된 주소입니다. 공유받은 링크를 그대로 열어 주세요.");
    return;
  }

  let doc;
  try {
    const naru = makeNaru();
    doc = await naru.collection("posts").get(id);
  } catch (err) {
    showStatus(naruErrorMessage(err));
    return;
  }

  const post = doc.data || {};
  const images = Array.isArray(post.images) ? post.images.filter((i) => i && i.url) : [];

  if (typeof post.bgColor === "string" && /^#[0-9a-fA-F]{6}$/.test(post.bgColor)) {
    document.body.style.background = post.bgColor;
    const r = parseInt(post.bgColor.slice(1, 3), 16);
    const g = parseInt(post.bgColor.slice(3, 5), 16);
    const b = parseInt(post.bgColor.slice(5, 7), 16);
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    document.body.style.color = luminance < 128 ? "#eeeeee" : "#222222";
  }
  if (post.title) document.title = post.title;

  app.innerHTML = "";

  if (post.title) {
    const h = document.createElement("h1");
    h.className = "viewer-title";
    h.textContent = post.title;
    app.appendChild(h);
  }

  if (images.length === 0) {
    showStatus("등록된 이미지가 없습니다.");
  } else if (post.type === "page") {
    app.appendChild(renderPaged(images));
  } else {
    app.appendChild(renderScroll(images));
  }

  const bgm = renderBgm(post.bgm);
  if (bgm) document.body.appendChild(bgm);
}

main();
