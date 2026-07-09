import { renderBoardList } from "./list-renderer.js";
import { createSkinDefinition } from "../skin-definition.js";

export const skin = createSkinDefinition({
  type: "BOARD",
  aliases: ["board"],
  cssNamespace: "skin-board",
  boardOptionsSchema: {
    boardWidth: {
      type: "number",
      label: "게시판 가로",
      defaultValue: 800,
      min: 1,
      step: 1,
      placeholder: "기본 800 / 100 이하는 %",
      help: "100 이하는 %, 그 이상은 px로 적용됩니다."
    }
  },
  postFields: [],
  renderWriteFields: [],
  capabilities: {
    board: {
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
