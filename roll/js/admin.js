import { makeNaru, extractYouTubeId, naruErrorMessage } from "./common.js";

const COLLECTION = "posts";
const DEFAULT_BG = "#ffffff";

const app = document.getElementById("app");
let naru = null;
let admin = null;

// 편집 상태: null이면 폼 닫힘, { id: null }이면 새 게시물
let editing = null;

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const child of children) node.appendChild(child);
  return node;
}

function notice(message, isError = false) {
  const box = document.getElementById("notice");
  if (!box) return;
  box.innerHTML = "";
  if (!message) return;
  box.appendChild(el("div", { class: isError ? "notice error" : "notice", text: message }));
}

function postUrl(id) {
  return new URL(`post.html?id=${encodeURIComponent(id)}`, location.href).href;
}

// ---------- 로그인 ----------

function renderLogin() {
  app.innerHTML = "";
  app.appendChild(
    el("div", {}, [
      el("p", { text: "관리자 전용 페이지입니다. naru 로그인이 필요합니다." }),
      el("p", {}, [
        el("button", {
          class: "primary",
          text: "관리자 로그인",
          onclick: () => naru.auth.signIn({ collections: [COLLECTION] }),
        }),
      ]),
    ])
  );
}

// ---------- 게시물 목록 ----------

async function loadPosts() {
  const posts = [];
  for await (const page of admin.collection(COLLECTION).pages({
    sort: [[{ metadata: "createdAt" }, "desc"]],
    size: 100,
  })) {
    posts.push(...page.documents);
  }
  return posts;
}

async function renderMain() {
  app.innerHTML = "";
  app.appendChild(el("div", { id: "notice" }));
  app.appendChild(
    el("div", { class: "admin-toolbar" }, [
      el("button", {
        class: "primary",
        text: "새 게시물",
        onclick: () => {
          editing = { id: null, revision: null, title: "", type: "scroll", bgm: "", bgColor: DEFAULT_BG, images: [] };
          renderForm();
        },
      }),
      el("button", { text: "새로고침", onclick: () => renderMain().catch(showFatal) }),
      el("button", {
        text: "로그아웃",
        onclick: async () => {
          await admin.signOut().catch(() => {});
          admin = null;
          renderLogin();
        },
      }),
    ])
  );

  const listWrap = el("div", { id: "list-wrap" }, [el("p", { class: "viewer-status", text: "목록 불러오는 중…" })]);
  app.appendChild(listWrap);
  app.appendChild(el("div", { id: "form-wrap" }));

  let posts;
  try {
    posts = await loadPosts();
  } catch (err) {
    listWrap.innerHTML = "";
    listWrap.appendChild(el("div", { class: "notice error", text: naruErrorMessage(err) }));
    if (err && err.code === "AUTH_REQUIRED") {
      admin = null;
      renderLogin();
    }
    return;
  }

  listWrap.innerHTML = "";
  if (posts.length === 0) {
    listWrap.appendChild(el("p", { class: "viewer-status", text: "게시물이 없습니다. 새 게시물을 만들어 보세요." }));
    return;
  }

  const tbody = el("tbody");
  for (const doc of posts) {
    const d = doc.data || {};
    tbody.appendChild(
      el("tr", {}, [
        el("td", { text: d.title || "(제목 없음)" }),
        el("td", { text: d.type === "page" ? "페이지형" : "스크롤형" }),
        el("td", { text: String(Array.isArray(d.images) ? d.images.length : 0) }),
        el("td", { text: doc.createdAt ? new Date(doc.createdAt).toLocaleDateString("ko-KR") : "" }),
        el("td", { class: "actions" }, [
          el("button", {
            text: "링크 복사",
            onclick: async () => {
              try {
                await navigator.clipboard.writeText(postUrl(doc.id));
                notice(`링크를 복사했습니다: ${postUrl(doc.id)}`);
              } catch {
                notice(`복사에 실패했습니다. 직접 복사하세요: ${postUrl(doc.id)}`, true);
              }
            },
          }),
          el("button", {
            text: "열기",
            onclick: () => window.open(postUrl(doc.id), "_blank"),
          }),
          el("button", {
            text: "수정",
            onclick: () => {
              editing = {
                id: doc.id,
                revision: doc.revision,
                title: d.title || "",
                type: d.type === "page" ? "page" : "scroll",
                bgm: d.bgm || "",
                bgColor: typeof d.bgColor === "string" ? d.bgColor : DEFAULT_BG,
                images: Array.isArray(d.images) ? d.images.slice() : [],
              };
              renderForm();
            },
          }),
          el("button", {
            text: "삭제",
            onclick: async () => {
              if (!confirm(`"${d.title || doc.id}" 게시물을 삭제할까요? 되돌릴 수 없습니다.`)) return;
              try {
                await admin.collection(COLLECTION).delete(doc.id, { condition: { revision: doc.revision } });
                await renderMain();
                notice("삭제했습니다.");
              } catch (err) {
                notice(naruErrorMessage(err), true);
              }
            },
          }),
        ]),
      ])
    );
  }

  listWrap.appendChild(
    el("table", { class: "post-table" }, [
      el("thead", {}, [
        el("tr", {}, [
          el("th", { text: "제목" }),
          el("th", { text: "형식" }),
          el("th", { text: "이미지" }),
          el("th", { text: "생성일" }),
          el("th", { text: "관리" }),
        ]),
      ]),
      tbody,
    ])
  );
}

// ---------- 편집 폼 ----------

function renderForm() {
  const formWrap = document.getElementById("form-wrap");
  if (!formWrap || !editing) return;
  formWrap.innerHTML = "";

  const titleInput = el("input", { type: "text", value: editing.title, placeholder: "게시물 제목" });
  titleInput.value = editing.title;

  const typeSelect = el("select");
  typeSelect.appendChild(el("option", { value: "scroll", text: "스크롤형 — 이미지를 세로로 이어서 표시" }));
  typeSelect.appendChild(el("option", { value: "page", text: "페이지형 — 클릭하면 다음 이미지로 이동" }));
  typeSelect.value = editing.type;

  const bgmInput = el("input", { type: "url", placeholder: "https://www.youtube.com/watch?v=… (비워두면 BGM 없음)" });
  bgmInput.value = editing.bgm;

  const colorPicker = el("input", { type: "color" });
  colorPicker.value = editing.bgColor;
  const colorText = el("input", { type: "text", maxlength: "7", placeholder: "#ffffff" });
  colorText.value = editing.bgColor;
  colorPicker.addEventListener("input", () => {
    colorText.value = colorPicker.value;
  });
  colorText.addEventListener("input", () => {
    if (/^#[0-9a-fA-F]{6}$/.test(colorText.value.trim())) colorPicker.value = colorText.value.trim();
  });

  const imgList = el("ul", { class: "img-list" });
  const progress = el("p", { class: "upload-progress" });

  function refreshImgList() {
    imgList.innerHTML = "";
    editing.images.forEach((img, i) => {
      imgList.appendChild(
        el("li", {}, [
          el("img", { src: img.url, alt: "" }),
          el("span", { class: "img-name", text: img.name || img.url }),
          el("button", {
            text: "▲",
            disabled: i === 0 ? "" : undefined,
            onclick: () => {
              [editing.images[i - 1], editing.images[i]] = [editing.images[i], editing.images[i - 1]];
              refreshImgList();
            },
          }),
          el("button", {
            text: "▼",
            disabled: i === editing.images.length - 1 ? "" : undefined,
            onclick: () => {
              [editing.images[i], editing.images[i + 1]] = [editing.images[i + 1], editing.images[i]];
              refreshImgList();
            },
          }),
          el("button", {
            text: "삭제",
            onclick: () => {
              editing.images.splice(i, 1);
              refreshImgList();
            },
          }),
        ])
      );
    });
  }
  refreshImgList();

  const fileInput = el("input", { type: "file", accept: "image/*", multiple: "" });
  fileInput.addEventListener("change", async () => {
    const files = Array.from(fileInput.files || []);
    fileInput.value = "";
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const result = await admin.media.upload(file, {
          onProgress: (p) => {
            if (p.phase === "uploading" && p.total > 0) {
              progress.textContent = `업로드 중 (${i + 1}/${files.length}) ${file.name} — ${Math.round((p.loaded / p.total) * 100)}%`;
            } else {
              progress.textContent = `업로드 중 (${i + 1}/${files.length}) ${file.name} — ${p.phase === "preparing" ? "준비" : "마무리"}…`;
            }
          },
        });
        editing.images.push({ url: result.url, name: file.name });
        refreshImgList();
      } catch (err) {
        notice(`"${file.name}" 업로드 실패: ${naruErrorMessage(err)}`, true);
      }
    }
    progress.textContent = "";
  });

  const saveBtn = el("button", {
    class: "primary",
    text: editing.id ? "수정 저장" : "게시물 등록",
    onclick: async () => {
      const title = titleInput.value.trim();
      const bgm = bgmInput.value.trim();
      const bgColor = colorText.value.trim().toLowerCase();

      if (!title) return notice("제목을 입력하세요.", true);
      if (editing.images.length === 0) return notice("이미지를 한 장 이상 등록하세요.", true);
      if (bgm && !extractYouTubeId(bgm)) return notice("BGM 링크가 유튜브 영상 주소가 아닙니다.", true);
      if (!/^#[0-9a-f]{6}$/.test(bgColor)) return notice("배경색은 #rrggbb 형식으로 입력하세요.", true);

      const data = {
        title,
        type: typeSelect.value === "page" ? "page" : "scroll",
        bgm: bgm || null,
        bgColor,
        images: editing.images,
      };

      saveBtn.disabled = true;
      try {
        const col = admin.collection(COLLECTION);
        if (editing.id) {
          await col.set(editing.id, data, { condition: { revision: editing.revision } });
        } else {
          await col.add(data);
        }
        editing = null;
        await renderMain();
        notice("저장했습니다.");
      } catch (err) {
        saveBtn.disabled = false;
        notice(naruErrorMessage(err), true);
        if (err && err.code === "AUTH_REQUIRED") {
          admin = null;
          renderLogin();
        }
      }
    },
  });

  formWrap.appendChild(
    el("div", { class: "edit-form" }, [
      el("h2", { text: editing.id ? "게시물 수정" : "새 게시물" }),
      el("div", { class: "form-row" }, [el("label", { text: "제목" }), titleInput]),
      el("div", { class: "form-row" }, [el("label", { text: "표시 형식" }), typeSelect]),
      el("div", { class: "form-row" }, [
        el("label", { text: "BGM 유튜브 링크 (선택)" }),
        bgmInput,
        el("p", { class: "hint", text: "방문자 페이지 하단에 소형 플레이어로 표시됩니다. 소리는 방문자가 직접 재생해야 합니다." }),
      ]),
      el("div", { class: "form-row" }, [
        el("label", { text: "배경색" }),
        el("div", { class: "color-row" }, [colorPicker, colorText]),
        el("p", { class: "hint", text: "이미지가 표시되는 페이지 전체의 배경색입니다." }),
      ]),
      el("div", { class: "form-row" }, [el("label", { text: "이미지 (여러 장 선택 가능)" }), fileInput, progress, imgList]),
      el("div", { class: "form-actions" }, [
        saveBtn,
        el("button", {
          text: "취소",
          onclick: () => {
            editing = null;
            formWrap.innerHTML = "";
          },
        }),
      ]),
    ])
  );
  formWrap.scrollIntoView();
}

// ---------- 시작 ----------

function showFatal(err) {
  app.innerHTML = "";
  app.appendChild(el("div", { class: "notice error", text: naruErrorMessage(err) }));
}

async function main() {
  try {
    naru = makeNaru();
    admin = await naru.auth.session();
  } catch (err) {
    showFatal(err);
    return;
  }
  if (!admin) {
    renderLogin();
    return;
  }
  await renderMain().catch(showFatal);
}

main();
