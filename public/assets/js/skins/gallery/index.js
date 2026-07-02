import { renderGalleryList } from "./list-renderer.js";
import { createSkinDefinition } from "../skin-definition.js";

export const skin = createSkinDefinition({
  type: "GALLERY",
  aliases: ["gal", "gallery"],
  cssNamespace: "skin-gallery",
  boardOptionsSchema: {
    boardWidth: {
      type: "number",
      label: "게시판 가로",
      defaultValue: 800,
      min: 1,
      step: 1,
      placeholder: "기본 800 / 100 이하는 %",
      help: "100 이하는 %, 그 이상은 px로 적용됩니다."
    },
    galleryColumns: {
      type: "number",
      label: "1줄 게시물 수",
      defaultValue: 4,
      min: 1,
      step: 1,
      placeholder: "기본 4",
      help: "한 줄에 들어갈 카드 수입니다."
    }
  },
  postFields: [
    { key: "source", label: "출처", type: "text" }
  ],
  renderWriteFields: [
    { key: "source", label: "출처", type: "text" }
  ],
  capabilities: {
    board: {
      useCursorPagination: true,
      deleteModeVariant: "gallery"
    },
    detail: {
      supportsComments: false
    },
    write: {
      supportsTitle: false,
      supportsGalleryFields: true,
      requiresThumbnail: true,
      supportsSource: true,
      contentPlaceholder: "본문 코멘트",
      contentField: "commentHtml"
    }
  },
  renderBoardList(posts, board, options) {
    return renderGalleryList(posts, board, options);
  }
});

export default skin;
