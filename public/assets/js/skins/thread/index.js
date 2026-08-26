import { createSkinDefinition } from "../skin-definition.js";
import { renderThreadDetail, renderThreadList } from "./renderer.js";

export const skin = createSkinDefinition({
  type: "THREAD",
  aliases: ["thread", "tarae"],
  cssNamespace: "skin-thread",
  boardOptionsSchema: {
    boardWidth: {
      type: "number",
      label: "게시판 가로",
      defaultValue: 1100,
      min: 1,
      step: 1,
      placeholder: "기본 1100 / 100 이하는 %",
      help: "목록과 열람 화면의 최대 가로 폭입니다."
    },
    galleryColumns: {
      type: "number",
      label: "1줄 카드 수",
      defaultValue: 3,
      min: 1,
      max: 4,
      step: 1,
      placeholder: "기본 3",
      help: "한 줄에 표시할 타래 카드 수입니다."
    }
  },
  capabilities: {
    board: {
      deleteModeVariant: "board"
    },
    detail: {
      supportsComments: true,
      showThumbnail: false
    },
    write: {
      requiresTitle: true,
      supportsContent: true,
      contentPlaceholder: "타래 내용"
    }
  },
  renderBoardList(posts, board, options) {
    return renderThreadList(posts, board, options);
  },
  renderDetail(post, board, context) {
    return renderThreadDetail(post, board, context);
  }
});

export default skin;
