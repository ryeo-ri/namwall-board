import { renderProfileList, renderProfileView } from "./renderer.js";
import { createSkinDefinition } from "../skin-definition.js";
import { sanitizeHTML } from "../../shared/html-sanitizer-v2.js";

export const skin = createSkinDefinition({
  type: "PROFILE",
  aliases: ["profile"],
  cssNamespace: "skin-profile",
  boardOptionsSchema: {
    galleryColumns: {
      type: "number",
      label: "1줄 게시물 수",
      defaultValue: 4,
      min: 1,
      step: 1,
      placeholder: "기본 4",
      help: "프로필 카드 크기는 고정하고, 한 줄에 보이는 카드 수만 조정합니다."
    }
  },
  postFields: [
    { key: "profile.nameEn", label: "영문 이름", type: "text", placeholder: "English name" },
    { key: "profile.meta.age", label: "나이", type: "text", placeholder: "예: 21" },
    { key: "profile.meta.gender", label: "성별", type: "text", placeholder: "예: 여성" },
    { key: "profile.meta.height", label: "키", type: "text", placeholder: "예: 165cm" },
    { key: "profile.fullBodyImage", label: "캐릭터 전신 이미지", type: "image", placeholder: "https://..." },
    { key: "profile.headImage", label: "캐릭터 두상 이미지", type: "image", placeholder: "https://..." },
    { key: "profile.oneLine", label: "한마디", type: "text", placeholder: "짧은 한마디" },
    { key: "profile.appearance", label: "외형", type: "textarea", rows: 4, placeholder: "외형을 입력하세요." },
    { key: "profile.personality", label: "성격", type: "textarea", rows: 4, placeholder: "성격을 입력하세요." },
    { key: "profile.etc", label: "기타", type: "textarea", rows: 4, placeholder: "기타 정보를 입력하세요.", htmlToggleKey: "profile.etcIsHtml" }
  ],
  capabilities: {
    board: {
      deleteModeVariant: "board"
    },
    detail: {
      supportsComments: false,
      showThumbnail: true
    },
    write: {
      requiresTitle: true,
      contentPlaceholder: "캐릭터 한마디",
      supportsContent: false,
      contentField: "contentHtml"
    }
  },
  renderBoardList(posts, board, options) {
    return renderProfileList(posts, board, options);
  },
  renderDetail(post, board, options) {
    return {
      ...renderProfileView(post, board, options),
      hideTags: true
    };
  },
  buildSkinData({ title = "", contentText = "", fieldData = {} } = {}) {
    const profile = fieldData.profile && typeof fieldData.profile === "object" ? { ...fieldData.profile } : {};
    const etcIsHtml = profile.etcIsHtml === true || profile.etcIsHtml === "true";
    const etcRaw = String(profile.etc || "").trim();
    return {
      profile: {
        ...profile,
        nameKo: String(title || "").trim(),
        oneLine: String(profile.oneLine || contentText || "").trim(),
        etc: etcIsHtml ? sanitizeHTML(etcRaw, { allowIframes: true }) : etcRaw,
        etcIsHtml
      }
    };
  }
});

export default skin;
