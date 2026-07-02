import { renderLogSkin } from "./renderer.js";
import { createSkinDefinition } from "../skin-definition.js";

export const skin = createSkinDefinition({
  type: "LOG",
  aliases: ["log"],
  cssNamespace: "skin-log",
  boardOptionsSchema: {
    boardWidth: { type: "number" },
    imageWidth: { type: "number" },
    commentPosition: { type: "select", options: ["default", "bottom"] }
  },
  postFields: [
    { key: "logNo", label: "로그번호", type: "number" }
  ],
  renderWriteFields: [
    { key: "logNo", label: "로그번호", type: "number" }
  ],
  capabilities: {
    board: {
      deleteModeVariant: "log"
    },
    write: {
      supportsTitle: false,
      supportsLogFields: true,
      autoLogNumber: true,
      contentPlaceholder: "로그 코멘트",
      contentField: "commentHtml"
    }
  },
  renderBoardList(posts, board, options) {
    return renderLogSkin(posts, board, options);
  }
});

export default skin;
