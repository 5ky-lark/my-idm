/** Prefix all main-process diagnostics so terminals are searchable. */

const PREFIX = "[MyIDM:main]";

export function formatJobBrief(jobId: string): string {
  return jobId.length >= 8 ? jobId.slice(0, 8) : jobId;
}

export function logMain(area: string, message: string, detail?: Record<string, unknown>): void {
  const line = `${PREFIX} [${area}] ${message}`;
  if (detail && Object.keys(detail).length > 0) {
    console.log(line, JSON.stringify(detail));
  } else {
    console.log(line);
  }
}

export function logMainWarn(area: string, message: string, detail?: Record<string, unknown>): void {
  logWith(console.warn, area, message, detail);
}

export function logMainError(area: string, message: string, detail?: Record<string, unknown>): void {
  logWith(console.error, area, message, detail);
}

function logWith(
  fn: typeof console.log,
  area: string,
  message: string,
  detail?: Record<string, unknown>
): void {
  const line = `${PREFIX} [${area}] ${message}`;
  if (detail && Object.keys(detail).length > 0) {
    fn(line, JSON.stringify(detail));
  } else {
    fn(line);
  }
}
