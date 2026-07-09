// 방명록(GUESTBOOK) 인라인 작성 헬퍼.
// - 관리자: 프루프 없이 직접 생성
// - 게스트(코드 모드): getGuestProofHash() 로 post_write_proofs 동봉 (validGuestPostCreate)
// - 게스트(공개 모드, board skinOptions.guestbookAccess === "open"): 프루프 없이 생성
//   (firestore.rules 의 validOpenGuestbookPostCreate 필요 — 규칙 배포 후 동작)
import { db } from "../core/firebase.js";
import {
  collection,
  doc,
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getGuestProofHash, sha256Hex } from "../core/state.js";
import { sanitizeHTML } from "./html-sanitizer-v2.js";

function randomSaltHex() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function messageToHtml(message) {
  return sanitizeHTML(
    String(message || "").replace(/\r\n/g, "\n").replace(/\n/g, "<br>\n"),
    { allowIframes: false }
  );
}

/**
 * 방명록 항목을 생성한다.
 * @param {object} opts
 * @param {string} opts.boardId
 * @param {string} opts.message   본문
 * @param {string} opts.authorName
 * @param {boolean} opts.isSecret
 * @param {string} opts.password  비밀글 비밀번호
 * @param {boolean} opts.isAdmin  관리자 여부
 * @param {boolean} opts.open     공개(누구나) 모드 여부
 * @returns {Promise<string>} 생성된 post 문서 ID
 */
export async function createGuestbookEntry(opts = {}) {
  const { boardId, message, authorName, isSecret = false, password = "", isAdmin = false, open = false } = opts;
  const text = String(message || "").trim();
  if (!text) throw new Error("내용을 입력해 주세요.");

  const entry = {
    boardId,
    skinType: "GUESTBOOK",
    authorType: "GUEST",
    authorName: String(authorName || "").trim() || "GUEST",
    isPublic: true,
    isSecret: isSecret === true,
    status: isSecret === true ? "SECRET" : "PUBLISHED",
    contentText: text,
    commentHtml: messageToHtml(message),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  if (entry.isSecret) {
    if (String(password).length < 1) throw new Error("비밀글은 비밀번호가 필요합니다.");
    const salt = randomSaltHex();
    entry.secretSalt = salt;
    entry.secretHash = await sha256Hex(`${salt}:${password}`);
  }

  const postRef = doc(collection(db, "posts"));
  const batch = writeBatch(db);
  batch.set(postRef, entry);

  // 관리자·공개 모드는 프루프 불필요, 코드 모드만 게스트 프루프 동봉
  if (!isAdmin && !open) {
    const proofHash = getGuestProofHash();
    if (!proofHash) throw new Error("게스트 코드를 먼저 입력하세요.");
    batch.set(doc(db, "post_write_proofs", postRef.id), {
      postId: postRef.id,
      boardId,
      proofHash,
      createdAt: serverTimestamp()
    });
  }

  await batch.commit();
  return postRef.id;
}
