import { json, getSessionUser } from "./_lib/session.js";
import {
  listDriveFiles,
  resolveFileId,
  downloadDriveFile,
  getDriveFileMetadata,
} from "./_lib/drive.js";
import { checkDailyUse, consumeDailyUse } from "./_lib/users.js";

function looksLikeDriveId(value) {
  const id = String(value || "").trim();
  if (!id) return false;
  if (/^\d+$/.test(id)) return false;
  return id.length >= 15;
}

export async function handler(event) {
  const user = getSessionUser(event);
  if (!user) {
    return json(401, { error: "Unauthorized" });
  }

  const requestedId = String(event.queryStringParameters?.id || "").trim();
  if (!requestedId) {
    return json(400, { error: "Missing file id" });
  }

  try {
    const usage = await checkDailyUse(user.id);
    if (!usage.allowed) {
      if (usage.reason === "banned") {
        return json(403, { error: "Account is restricted" });
      }
      return json(429, { error: "Daily download limit reached" });
    }
  } catch (usageErr) {
    // Ignore usage-store failures and continue download flow.
  }

  const driveMode = process.env.DRIVE_MODE === "drive";
  if (!driveMode) {
    const filename = `${requestedId}.txt`;
    const body =
      `Demo download for App ID ${requestedId}\n\n` +
      "This is a placeholder file. Enable DRIVE_MODE=drive for real downloads.\n";

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/plain",
        "Content-Disposition": `attachment; filename=\"${filename}\"`,
      },
      body,
    };
  }

  const folderId = String(process.env.GOOGLE_FOLDER_ID || "").trim();
  if (!folderId) {
    return json(400, { error: "Missing GOOGLE_FOLDER_ID" });
  }

  try {
    let fileId = "";
    let knownSize = null;

    if (looksLikeDriveId(requestedId)) {
      fileId = requestedId;
    }

    if (!fileId) {
      const files = await listDriveFiles(folderId);
      const resolved = resolveFileId(files, requestedId);
      if (!resolved) {
        return json(404, { error: "Drive file not found" });
      }

      fileId = resolved;
      const meta = files.find((f) => String(f.id) === String(fileId));
      if (meta?.size && Number.isFinite(Number(meta.size))) {
        knownSize = Number(meta.size);
      }
    }

    const maxBytes = Number(process.env.MAX_PROXY_BYTES || 8 * 1024 * 1024);
    if (!knownSize) {
      try {
        const meta = await getDriveFileMetadata(fileId);
        if (meta?.size && Number.isFinite(Number(meta.size))) {
          knownSize = Number(meta.size);
        }
      } catch (metaErr) {
        // If metadata lookup fails, continue and let download attempt decide.
      }
    }

    if (knownSize && knownSize > maxBytes) {
      return json(413, {
        error: "File is too large for Netlify function proxy",
        detail: "Use external backend hosting for large binary downloads.",
      });
    }

    const downloaded = await downloadDriveFile(fileId);
    try {
      await consumeDailyUse(user.id);
    } catch (usageErr) {
      // Ignore usage-store failures after successful download.
    }

    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        "Content-Type": downloaded.mimeType,
        "Content-Disposition": `attachment; filename=\"${downloaded.filename}\"`,
      },
      body: downloaded.body,
    };
  } catch (err) {
    return json(500, { error: "Download failed", detail: err.message });
  }
}
