import { renderGuestbook } from "./renderer.js";
import { createSkinDefinition } from "../skin-definition.js";

export const skin = createSkinDefinition({
  type: "GUESTBOOK",
  aliases: ["guestbook", "gb"],
  cssNamespace: "skin-guestbook",
  boardOptionsSchema: {
    boardWidth: {
      type: "number",
      label: "게시판 가로",
      min: 1,
      step: 1,
      placeholder: "기본 800 / 100 이하는 %",
      help: "100 이하는 %, 그 이상은 px로 적용됩니다."
    },
    guestbookAccess: {
      type: "select",
      label: "작성 권한",
      options: [
        { value: "code", label: "게스트 코드 사용" },
        { value: "open", label: "누구나 (이름+비밀번호)" }
      ],
      defaultValue: "code",
      help: "누구나 모드는 firestore 규칙 배포가 필요합니다(validOpenGuestbookPostCreate)."
    }
  },
  capabilities: {
    // 목록 페이지에서 인라인 폼으로 직접 작성하므로 별도 삭제모드 변형은 쓰지 않음
    board: { deleteModeVariant: "none" },
    write: {
      supportsTitle: false,
      contentPlaceholder: "방명록 내용",
      contentField: "commentHtml"
    }
  },
  renderBoardList(posts, board, options) {
    return renderGuestbook(posts, board, options);
  }
});

export default skin;
