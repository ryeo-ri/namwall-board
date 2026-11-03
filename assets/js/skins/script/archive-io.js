import { storage } from "../../core/firebase.js";
import {
  deleteObject,
  getDownloadURL,
  ref as storageRef,
  uploadBytes
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

const SUPPORTED_ARCHIVE_VERSION = 1;

export async function loadScriptArchive(url, options = {}) {
  const archiveUrl = String(url || "").trim();
  if (!archiveUrl) throw new Error("플레이 로그 파일 주소가 없습니다.");

  const response = await fetch(archiveUrl, { cache: options.cache || "default" });
  if (!response.ok) throw new Error(`Archive request failed: ${response.status}`);

  const bytes = new Uint8Array(await response.arrayBuffer());
  const isGzipPayload = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  let text = "";
  if (isGzipPayload) {
    if (typeof DecompressionStream !== "function") {
      throw new Error("이 브라우저는 압축된 플레이 로그를 열 수 없습니다.");
    }
    text = await new Response(
      new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))
    ).text();
  } else {
    // CDN이 Content-Encoding을 해제한 뒤 본문을 전달하는 경우도 지원합니다.
    text = new TextDecoder().decode(bytes);
  }

  const archive = JSON.parse(text);
  if (Number(archive?.version) !== SUPPORTED_ARCHIVE_VERSION || !Array.isArray(archive?.messages)) {
    throw new Error("지원하지 않는 SCRIPT 아카이브 형식입니다.");
  }

  const assets = Array.isArray(archive.assets) ? archive.assets.slice() : [];
  return {
    ...archive,
    version: SUPPORTED_ARCHIVE_VERSION,
    css: String(archive.css || ""),
    assets,
    speakerAvatars: normalizeScriptSpeakerAvatars(archive.speakerAvatars, assets.length),
    narratorSpeakers: normalizeScriptNarratorSpeakers(archive.narratorSpeakers),
    messages: archive.messages.slice()
  };
}

export async function createScriptArchiveBlob(archive) {
  const jsonBlob = new Blob([JSON.stringify(archive)], { type: "application/json" });
  if (typeof CompressionStream !== "function") {
    return { blob: jsonBlob, encoding: "identity", extension: "json" };
  }

  const compressed = await new Response(
    jsonBlob.stream().pipeThrough(new CompressionStream("gzip"))
  ).blob();
  return {
    blob: new Blob([compressed], { type: "application/gzip" }),
    encoding: "gzip",
    extension: "json.gz"
  };
}

export function createScriptArchiveId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const suffix = Array.from(bytes, (byte) => byte.toString(36).padStart(2, "0")).join("").slice(0, 12);
  return `${Date.now()}_${suffix}`;
}

export async function uploadScriptArchive({ archive, boardId, archiveId = createScriptArchiveId() }) {
  const packed = await createScriptArchiveBlob(archive);
  const safeBoardId = safePathSegment(boardId || "script");
  const safeArchiveId = safePathSegment(archiveId);
  const archivePath = `script_archives/${safeBoardId}/${safeArchiveId}.${packed.extension}`;
  const archiveRef = storageRef(storage, archivePath);
  await uploadBytes(archiveRef, packed.blob, {
    contentType: packed.blob.type,
    cacheControl: "public,max-age=31536000,immutable"
  });

  return {
    archiveId: safeArchiveId,
    archivePath,
    archiveUrl: await getDownloadURL(archiveRef),
    archiveEncoding: packed.encoding,
    archiveVersion: SUPPORTED_ARCHIVE_VERSION,
    archiveBytes: packed.blob.size
  };
}

export async function deleteScriptArchive(path) {
  const storagePath = String(path || "").trim();
  if (!storagePath.startsWith("script_archives/")) return false;
  try {
    await deleteObject(storageRef(storage, storagePath));
    return true;
  } catch (error) {
    if (error?.code === "storage/object-not-found") return false;
    throw error;
  }
}

export async function uploadScriptAsset({ blob, boardId, archiveId, fileName }) {
  if (!(blob instanceof Blob) || !/^image\//i.test(blob.type)) {
    throw new Error("업로드할 SCRIPT 이미지가 올바르지 않습니다.");
  }
  const safeBoardId = safePathSegment(boardId || "script");
  const safeArchiveId = safePathSegment(archiveId || createScriptArchiveId());
  const safeFileName = safePathSegment(fileName || "asset.webp");
  const assetPath = `script_assets/${safeBoardId}/${safeArchiveId}/${safeFileName}`;
  const assetRef = storageRef(storage, assetPath);
  await uploadBytes(assetRef, blob, {
    contentType: blob.type,
    cacheControl: "public,max-age=31536000,immutable"
  });
  try {
    return {
      assetPath,
      assetUrl: await getDownloadURL(assetRef)
    };
  } catch (error) {
    await deleteObject(assetRef).catch(() => {});
    throw error;
  }
}

export async function deleteScriptAsset(path) {
  const storagePath = String(path || "").trim();
  if (!storagePath.startsWith("script_assets/")) return false;
  try {
    await deleteObject(storageRef(storage, storagePath));
    return true;
  } catch (error) {
    if (error?.code === "storage/object-not-found") return false;
    throw error;
  }
}

function safePathSegment(value) {
  return String(value || "script").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "script";
}

export function normalizeScriptSpeakerAvatars(value, assetCount) {
  const output = Object.create(null);
  if (!value || typeof value !== "object" || Array.isArray(value)) return output;
  Object.entries(value).forEach(([speaker, rawIndex]) => {
    const name = String(speaker || "").trim().slice(0, 120);
    if (!name || !Number.isInteger(rawIndex) || rawIndex < 0 || rawIndex >= assetCount) return;
    output[name] = rawIndex;
  });
  return output;
}

export function normalizeScriptNarratorSpeakers(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const output = [];
  value.forEach((speaker) => {
    const name = String(speaker || "").trim().slice(0, 120);
    if (!name || seen.has(name) || output.length >= 500) return;
    seen.add(name);
    output.push(name);
  });
  return output;
}
