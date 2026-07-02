import { renderGalleryList } from "./list-renderer.js";
import { createSkinDefinition } from "../skin-definition.js";

export const skin = createSkinDefinition({
  type: "GALLERY",
  aliases: ["gal", "gallery"],
  cssNamespace: "skin-gallery",
  boardOptionsSchema: {
    boardWidth: { type: "number", defaultValue: 800 },
    galleryColumns: { type: "number", defaultValue: 4 }
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
