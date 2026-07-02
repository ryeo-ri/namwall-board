import { renderProfileList } from "./renderer.js";
import { createSkinDefinition } from "../skin-definition.js";

export const skin = createSkinDefinition({
  type: "PROFILE",
  aliases: ["profile"],
  cssNamespace: "skin-profile",
  boardOptionsSchema: {
    boardWidth: { type: "number" }
  },
  postFields: [
    { key: "profile", label: "프로필", type: "group" }
  ],
  renderWriteFields: [
    { key: "profile", label: "프로필", type: "group" }
  ],
  capabilities: {
    detail: {
      showThumbnail: true
    },
    write: {
      requiresTitle: true,
      contentPlaceholder: "캐릭터 한마디",
      contentField: "contentHtml"
    }
  },
  renderBoardList(posts, board, options) {
    return renderProfileList(posts, board, options);
  }
});

export default skin;
