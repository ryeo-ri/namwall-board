import { db, storage } from "../core/firebase.js";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { deleteObject, ref as storageRef } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

export async function deletePostsByIds(postIds) {
  const uniqueIds = Array.from(new Set((postIds || []).filter(Boolean)));
  let deletedPosts = 0;

  for (const postId of uniqueIds) {
    await deleteSinglePost(postId);
    deletedPosts += 1;
  }

  return { deletedPosts };
}

export async function deleteBoardContent(board) {
  const posts = await findPostsForBoard(board);
  const categories = await findCategoriesForBoard(board?.id || "");

  await deletePostsByIds(posts.map((post) => post.id));
  for (const category of categories) {
    await deleteDoc(doc(db, "categories", category.id));
  }

  return {
    deletedPosts: posts.length,
    deletedCategories: categories.length
  };
}

async function deleteSinglePost(postId) {
  const postRef = doc(db, "posts", postId);
  const postSnap = await getDoc(postRef);
  if (!postSnap.exists()) return;

  const post = { id: postSnap.id, ...postSnap.data() };
  await deletePostComments(postId);
  await deletePostStorageAssets(post);
  await deleteDoc(postRef);
}

async function deletePostComments(postId) {
  const commentsSnap = await getDocs(collection(db, "posts", postId, "comments"));
  for (const commentDoc of commentsSnap.docs) {
    await deleteDoc(commentDoc.ref);
  }
}

async function deletePostStorageAssets(post) {
  const paths = new Set();
  const thumbPath = extractStoragePath(post.thumbnailAttachment);
  if (thumbPath) paths.add(thumbPath);

  (Array.isArray(post.extraAttachments) ? post.extraAttachments : []).forEach((attachment) => {
    const storagePathValue = extractStoragePath(attachment);
    if (storagePathValue) paths.add(storagePathValue);
  });

  const scriptData = post?.skinData?.script || {};
  if (isManagedStoragePath(scriptData.archivePath)) paths.add(scriptData.archivePath);
  (Array.isArray(scriptData.archiveHistory) ? scriptData.archiveHistory : []).forEach((entry) => {
    if (isManagedStoragePath(entry?.archivePath)) paths.add(entry.archivePath);
  });
  (Array.isArray(scriptData.assetPaths) ? scriptData.assetPaths : []).forEach((path) => {
    if (isManagedStoragePath(path)) paths.add(path);
  });

  for (const path of paths) {
    try {
      await deleteObject(storageRef(storage, path));
    } catch (error) {
      if (error?.code !== "storage/object-not-found") {
        throw error;
      }
    }
  }
}

function extractStoragePath(value) {
  const candidates = [value?.storagePath, value?.path, value?.url]
    .filter((item) => typeof item === "string" && item.trim());

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (isManagedStoragePath(trimmed)) {
      return trimmed;
    }

    if (trimmed.includes("/o/")) {
      try {
        const parsed = new URL(trimmed);
        const objectPath = decodeURIComponent(parsed.pathname.split("/o/")[1] || "");
        if (isManagedStoragePath(objectPath)) {
          return objectPath;
        }
      } catch (_error) {
        // Ignore URL parse failures.
      }
    }
  }

  return "";
}

function isManagedStoragePath(value) {
  const path = String(value || "").trim();
  return ["gallery_thumbs/", "gallery_extra/", "profile_images/", "script_archives/", "script_assets/"]
    .some((prefix) => path.startsWith(prefix));
}

function getBoardStorageIdCandidates(rawBoardId) {
  const originalBoardId = String(rawBoardId || "").trim();
  if (!originalBoardId) return [];
  return Array.from(new Set([originalBoardId, originalBoardId.toLowerCase()]));
}

async function findPostsForBoard(board) {
  const boardCandidates = getBoardStorageIdCandidates(board?.id || "");
  const queryCandidates = Array.from(new Set(
    boardCandidates.map((item) => String(item || "").trim()).filter(Boolean)
  )).slice(0, 10);
  const normalizedCandidates = new Set(queryCandidates.map((item) => item.toLowerCase()));
  if (!queryCandidates.length) return [];

  try {
    if (queryCandidates.length > 1) {
      const snapshot = await getDocs(query(collection(db, "posts"), where("boardId", "in", queryCandidates)));
      return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    }

    const [singleBoardId] = queryCandidates;
    const snapshot = await getDocs(query(collection(db, "posts"), where("boardId", "==", singleBoardId)));
    return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  } catch (error) {
    console.warn("Direct board content query failed. Falling back to client-side match.", error);
  }

  const snapshot = await getDocs(query(collection(db, "posts"), orderBy("createdAt", "desc")));
  return snapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter((post) => {
      const candidates = [
        post.boardId,
        post.board,
        post.bo,
        post.board_id,
        post.boardRef,
        post.boardPath
      ]
        .flatMap(extractBoardCandidates)
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean);

      return candidates.some((value) => normalizedCandidates.has(value));
    });
}

async function findCategoriesForBoard(boardId) {
  const normalizedBoardId = String(boardId || "").trim();
  if (!normalizedBoardId) return [];

  const snapshot = await getDocs(query(collection(db, "categories"), where("boardId", "==", normalizedBoardId)));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

function extractBoardCandidates(value) {
  if (!value) return [];

  if (typeof value === "string") {
    const normalized = value.trim();
    const parts = normalized.split("/").filter(Boolean);
    const tail = parts.length ? parts[parts.length - 1] : normalized;
    return [normalized, tail];
  }

  if (typeof value === "object") {
    const values = [];
    if (typeof value.id === "string") values.push(value.id);
    if (typeof value.path === "string") values.push(value.path);
    if (typeof value._key?.path?.canonicalString === "function") {
      values.push(value._key.path.canonicalString());
    }
    return values.flatMap(extractBoardCandidates);
  }

  return [String(value)];
}
