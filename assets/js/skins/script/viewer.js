import { normalizeScriptData } from "./renderer.js";
import { loadScriptArchive } from "./archive-io.js";
import {
  applyScriptArchiveCss,
  createScriptMessageNode,
  decorateScriptMessageFlow,
  isHiddenScriptMessage
} from "./message-dom.js";

const CHUNK_SIZE = 300;

export async function bindScriptViewer({ post, container, secretUnlocked }) {
  if (!container || secretUnlocked === false) return;
  const shell = container.querySelector("[data-script-reader]");
  if (!shell) return;

  const script = normalizeScriptData(post);
  const statusEl = shell.querySelector("[data-script-status]");
  const messagesEl = shell.querySelector("[data-script-messages]");
  const moreButton = shell.querySelector("[data-script-more]");
  const sentinel = shell.querySelector("[data-script-sentinel]");

  try {
    const archive = await loadScriptArchive(script.archiveUrl);
    const messages = (Array.isArray(archive.messages) ? archive.messages : [])
      .filter((message) => !isHiddenScriptMessage(message));
    const assets = Array.isArray(archive.assets) ? archive.assets : [];
    const speakerAvatars = archive.speakerAvatars || {};
    const narratorSpeakers = new Set(archive.narratorSpeakers || []);
    let rendered = 0;
    let speakerFlowOpen = false;
    let autoLoadArmed = true;
    let isAppending = false;
    let observer = null;

    applyScriptArchiveCss(shell, archive.css);

    const updateLoadControls = () => {
      const hasMore = rendered < messages.length;
      moreButton.classList.toggle("hidden", !hasMore);
      sentinel?.classList.toggle("hidden", !hasMore);
      if (!hasMore) observer?.disconnect();
    };
    const appendChunk = () => {
      if (isAppending || rendered >= messages.length) return;
      isAppending = true;
      const fragment = document.createDocumentFragment();
      messages.slice(rendered, rendered + CHUNK_SIZE).forEach((message) => {
        const node = createScriptMessageNode(message, assets, { speakerAvatars, narratorSpeakers });
        speakerFlowOpen = decorateScriptMessageFlow(node, speakerFlowOpen);
        fragment.appendChild(node);
      });
      messagesEl.appendChild(fragment);
      rendered = Math.min(rendered + CHUNK_SIZE, messages.length);
      updateLoadControls();
      requestAnimationFrame(() => {
        isAppending = false;
      });
    };

    if (!messages.length) {
      statusEl.textContent = "저장된 플레이 로그가 없습니다.";
      moreButton.classList.add("hidden");
      sentinel?.classList.add("hidden");
      return;
    }

    statusEl.classList.add("hidden");
    moreButton.addEventListener("click", () => {
      autoLoadArmed = false;
      appendChunk();
    });
    appendChunk();
    if (sentinel && "IntersectionObserver" in window && rendered < messages.length) {
      observer = new IntersectionObserver(([entry]) => {
        if (!entry?.isIntersecting) {
          autoLoadArmed = true;
          return;
        }
        if (!autoLoadArmed || isAppending) return;
        autoLoadArmed = false;
        appendChunk();
      }, { rootMargin: "600px 0px", threshold: 0 });
      observer.observe(sentinel);
    }
  } catch (error) {
    console.error("SCRIPT archive load failed:", error);
    statusEl.classList.remove("hidden");
    statusEl.textContent = "플레이 로그를 불러오지 못했습니다. 저장된 파일 주소와 Storage 규칙을 확인해주세요.";
    moreButton.classList.add("hidden");
    sentinel?.classList.add("hidden");
  }
}
