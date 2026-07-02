import { renderPageList, renderPageView } from "./renderer.js";
import { createSkinDefinition } from "../skin-definition.js";

export const skin = createSkinDefinition({
  type: "PAGE",
  aliases: ["page"],
  cssNamespace: "skin-page",
  boardOptionsSchema: {
    boardWidth: {
      type: "number",
      label: "페이지 가로",
      defaultValue: 900,
      min: 1,
      step: 1,
      placeholder: "기본 900 / 100 이하는 %",
      help: "PAGE 상세 화면의 최대 가로 폭입니다."
    }
  },
  postFields: [
    {
      key: "page.mode",
      label: "표시 방식",
      type: "select",
      defaultValue: "srcdoc",
      options: [
        { value: "srcdoc", label: "HTML 직접 입력" },
        { value: "url", label: "외부 URL iframe" }
      ]
    },
    {
      key: "page.html",
      label: "HTML 소스",
      type: "textarea",
      rows: 16,
      visibleWhen: { key: "page.mode", value: "srcdoc" },
      placeholder: "<div>HTML, CSS, JS를 자유롭게 입력하세요.</div>"
    },
    {
      key: "page.iframeUrl",
      label: "외부 iframe URL",
      type: "url",
      visibleWhen: { key: "page.mode", value: "url" },
      placeholder: "https://example.com"
    },
    {
      key: "page.height",
      label: "iframe 높이",
      type: "number",
      defaultValue: 720,
      placeholder: "720"
    }
  ],
  capabilities: {
    board: {
      deleteModeVariant: "board"
    },
    detail: {
      supportsComments: false,
      showThumbnail: false
    },
    write: {
      adminOnly: true,
      disabled: true,
      supportsTitle: true,
      requiresTitle: false,
      supportsContent: false,
      contentField: "contentHtml"
    }
  },
  renderBoardList(posts, board, options) {
    return renderPageList(posts, board, options);
  },
  renderDetail(post, board, options) {
    return {
      ...renderPageView(post, board, options),
      hideTags: true
    };
  },
  buildSkinData({ title = "", fieldData = {} } = {}) {
    const page = fieldData.page && typeof fieldData.page === "object" ? { ...fieldData.page } : {};
    const mode = page.mode === "url" ? "url" : "srcdoc";
    const height = parsePositiveNumber(page.height) || 720;
    return {
      page: {
        mode,
        title: String(title || "").trim(),
        html: mode === "srcdoc" ? String(page.html || "").trim() : "",
        iframeUrl: mode === "url" ? String(page.iframeUrl || "").trim() : "",
        height
      }
    };
  }
});

function parsePositiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export default skin;
