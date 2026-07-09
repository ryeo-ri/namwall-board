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
    },
    extraImageAlign: {
      type: "select",
      label: "추가 이미지 정렬",
      options: [
        { value: "left", label: "좌측" },
        { value: "center", label: "가운데" },
        { value: "right", label: "우측" }
      ],
      defaultValue: "left",
      help: "게시글 추가 이미지를 한 장씩 줄바꿈해 표시할 때의 정렬 위치입니다."
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
