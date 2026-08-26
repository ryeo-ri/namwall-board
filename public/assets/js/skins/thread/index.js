import { createSkinDefinition } from "../skin-definition.js";
import { bindThreadDetail, renderThreadDetail, renderThreadList } from "./renderer.js";

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
    },
    commentPosition: {
      type: "select",
      label: "댓글 위치",
      options: [
        { value: "bottom", label: "하단" },
        { value: "left", label: "좌측" }
      ],
      defaultValue: "bottom",
      help: "상세 화면에서 댓글 영역을 놓을 위치입니다."
    },
    detailThumb: {
      type: "select",
      label: "상세 썸네일",
      options: [
        { value: "show", label: "노출" },
        { value: "hide", label: "숨김" }
      ],
      defaultValue: "show",
      help: "상세 화면 패널에 썸네일 이미지를 표시할지 여부입니다."
    }
  },
  capabilities: {
    board: {
      deleteModeVariant: "board"
    },
    detail: {
      supportsComments: true,
      showThumbnail: false,
      commentImages: true,
      commentDateFirst: true
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
  },
  bindDetail(context) {
    return bindThreadDetail(context);
  }
});

export default skin;
