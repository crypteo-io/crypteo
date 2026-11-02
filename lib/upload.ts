import { ApiError } from "./api-client";

/**
 * Multipart upload with apiRequest's error semantics (apiRequest only sends
 * JSON). XHR rather than fetch, because fetch reports no upload progress.
 */
export function uploadWithProgress<T>(
  url: string,
  fields: Record<string, string | Blob>,
  onProgress: (fraction: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const body = new FormData();
    for (const [key, value] of Object.entries(fields)) body.append(key, value);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new Error("Network error. Check your connection and try again."));
    xhr.onload = () => {
      const data = xhr.response ?? {};
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data as T);
      reject(
        new ApiError(
          (typeof data?.error === "string" && data.error) || `Upload failed (${xhr.status})`,
          xhr.status,
        ),
      );
    };
    xhr.send(body);
  });
}
