import { renderBoardList } from "./list-renderer.js";
import { createSkinDefinition } from "../skin-definition.js";

export const skin = createSkinDefinition({
  type: "BOARD",
  aliases: ["board"],
  cssNamespace: "skin-board",
  boardOptionsSchema: {
    boardWidth: { type: "number", defaultValue: 800 }
  },
  postFields: [],
  renderWriteFields: [],
  capabilities: {
    board: {
      supportsSearchSort: false,
      deleteModeVariant: "board"
    },
    write: {
      requiresTitle: true,
      contentField: "contentHtml"
    }
  },
  renderBoardList(posts, board, options) {
    return renderBoardList(posts, board, options);
  }
});

export default skin;
