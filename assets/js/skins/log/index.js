import { renderLogSkin } from "./renderer.js";
import { createSkinDefinition } from "../skin-definition.js";

export const skin = createSkinDefinition({
  type: "LOG",
  aliases: ["log"],
  cssNamespace: "skin-log",
  boardOptionsSchema: {
    boardWidth: {
      type: "number",
      label: "게시판 가로",
      min: 1,
      step: 1,
      placeholder: "기본 800 / 100 이하는 %",
      help: "100 이하는 %, 그 이상은 px로 적용됩니다."
    },
    imageWidth: {
      type: "number",
      label: "이미지 폭 크기",
      min: 0,
      step: 1,
      placeholder: "자동",
      help: "0을 입력하면 이미지 폭 제한을 두지 않습니다."
    },
    commentPosition: {
      type: "select",
      label: "덧글 위치",
      options: [
        { value: "default", label: "우측" },
        { value: "bottom", label: "하단" }
      ],
      defaultValue: "default"
    }
  },
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
