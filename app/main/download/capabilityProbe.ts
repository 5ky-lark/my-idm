import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { DownloadCapability } from "../../shared/types.js";
import { logMain, logMainWarn } from "../logger.js";
import { mergeDownloadHeaders } from "./httpDefaults.js";

function requestFor(url: string) {
  return url.startsWith("https:") ? httpsRequest : httpRequest;
}

function summarizeHeaders(headers: Record<string, string | string[] | undefined>) {
  return {
    acceptRanges: headers["accept-ranges"] ?? null,
    contentLengthHeader: headers["content-length"] ?? null,
    contentType: headers["content-type"] ?? null,
    location: headers["location"] ?? null
  };
}

export async function probeCapability(url: string): Promise<DownloadCapability> {
  const reqImpl = requestFor(url);
  const merged = mergeDownloadHeaders();

  const headResult = await new Promise<DownloadCapability>((resolve) => {
    const req = reqImpl(url, { method: "HEAD", headers: merged }, (res) => {
      const statusCode = res.statusCode ?? 0;
      const headers = summarizeHeaders(res.headers as Record<string, string | string[] | undefined>);
      const acceptsRanges = /bytes/i.test(String(res.headers["accept-ranges"] ?? ""));
      const length = Number(res.headers["content-length"]);
      const capability: DownloadCapability = {
        acceptsRanges,
        contentLength: Number.isFinite(length) ? length : null
      };

      logMain(
        "probe",
        "HEAD completed",
        {
          urlSnippet: truncateUrl(url, 140),
          statusCode,
          statusMessage: res.statusMessage ?? "",
          ...headers,
          inferredAcceptRanges: acceptsRanges,
          inferredContentLength: capability.contentLength
        }
      );

      if (statusCode >= 400) {
        logMainWarn("probe", "HEAD returned HTTP error — GET may behave differently", {
          statusCode,
          urlSnippet: truncateUrl(url, 140)
        });
      } else if (statusCode >= 300 && headers.location) {
        logMainWarn("probe", "HEAD returned redirect — Node downloader does not follow redirects yet", {
          statusCode,
          locationSnippet: truncateStr(String(headers.location), 140)
        });
      }

      resolve(capability);
      res.resume();
    });
    req.on("error", (err: Error & { cause?: unknown }) => {
      logMainWarn("probe", "HEAD failed (network/request error)", {
        urlSnippet: truncateUrl(url, 140),
        message: err.message,
        code: (err as NodeJS.ErrnoException).code
      });
      resolve({ acceptsRanges: false, contentLength: null });
    });
    req.end();
  });

  return headResult;
}

function truncateUrl(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function truncateStr(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}
