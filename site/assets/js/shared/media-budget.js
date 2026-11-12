// NAMWALL Edition Copyright (c) 2026 NAMWALL — MPL-2.0 (https://mozilla.org/MPL/2.0/)
import { runQuery } from "../core/naru-client.js";

export const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

// 소유자 로그인은 무제한, 회원 세션(관리자에 연결한 회원 포함)은 시간당 30개다.
export async function createMediaUploadSession(uploader, help = "로그 이미지 백업을 끄거나 잠시 후 다시 저장해 주세요.") {
  const budget = uploader.query ? await uploader.query("board:uploadBudget") : await runQuery("board:uploadBudget");
  if (!budget || typeof budget.limited !== "boolean" || (budget.limited && !Number.isInteger(budget.remaining))) {
    throw new Error("업로드 가능 횟수를 확인하지 못했습니다. 잠시 후 다시 저장해 주세요.");
  }
  let remaining = budget.limited ? Math.max(0, budget.remaining) : Infinity;
  const assertAvailable = (count) => {
    if (count > remaining) {
      throw new Error(`파일 ${count}개를 올려야 하지만 남은 업로드 횟수는 ${remaining}회입니다. ${help}`);
    }
  };
  return {
    assertAvailable,
    async upload(file, options) {
      assertAvailable(1);
      // 병렬 이미지 백업도 예약한 횟수 안에서만 시작한다. 실패 여부가 불확실하면 돌려주지 않는다.
      remaining -= 1;
      return uploader.media.upload(file, options);
    }
  };
}
