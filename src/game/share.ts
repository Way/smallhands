// Getting text and pictures out of the game and into the player's hands.
//
// Smallhands is a static build with no server, so every route out is a browser
// one: a download, the clipboard, or the OS share sheet. All three can be
// refused — an insecure context, a browser without ClipboardItem, an iOS Safari
// that will not take a blob: download — so nothing here assumes success. Each
// call reports what actually happened and the caller says so honestly, rather
// than printing "saved!" over a file that never left the page.

// Whether this browser can save a generated file at all. iOS Safari historically
// cannot, and telling the player "saved" when nothing happened is worse than
// telling them to use Copy instead.
export const CAN_DOWNLOAD =
  typeof HTMLAnchorElement !== 'undefined' && 'download' in HTMLAnchorElement.prototype;

export interface OutFile {
  name: string;
  body: string | Blob;
}

export function canvasDataUrl(canvas: HTMLCanvasElement): string | null {
  try {
    return canvas.toDataURL('image/png');
  } catch {
    return null; // tainted canvas or an out-of-memory browser
  }
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(',');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: /:(.*?);/.exec(head)?.[1] ?? 'application/octet-stream' });
}

// All clicks fire synchronously: deferring them past the gesture is what gets a
// multi-file download blocked. Chrome asks once per site before allowing the
// second and third file; that prompt is the browser's call, not ours.
export function downloadAll(files: OutFile[]): void {
  for (const f of files) {
    const blob = typeof f.body === 'string' ? new Blob([f.body], { type: 'text/markdown' }) : f.body;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false; // insecure context, denied permission, or no clipboard API
  }
}

// Copying an *image* is a narrower road than copying text: it needs
// ClipboardItem, which Firefox only grew recently and which throws outright on
// an insecure origin. Callers fall back to the download button.
export const CAN_COPY_IMAGE =
  typeof ClipboardItem !== 'undefined' && typeof navigator !== 'undefined' && !!navigator.clipboard?.write;

export async function copyImage(blob: Blob): Promise<boolean> {
  if (!CAN_COPY_IMAGE) return false;
  try {
    await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })]);
    return true;
  } catch {
    return false;
  }
}

// ---- the OS share sheet ----------------------------------------------------
//
// Mostly a phone affordance: on a desktop browser navigator.share is usually
// absent, and canShare() is what tells us whether *files* (not just links) are
// allowed through. Cancelling the sheet is a normal outcome, not a failure —
// the caller must not report an error for it, so it gets its own result.

export type ShareResult = 'shared' | 'cancelled' | 'unsupported' | 'failed';

export function canShareFiles(files: File[]): boolean {
  return typeof navigator !== 'undefined' && !!navigator.canShare?.({ files }) && !!navigator.share;
}

export async function shareFiles(files: File[], data: { title?: string; text?: string }): Promise<ShareResult> {
  if (!canShareFiles(files)) return 'unsupported';
  try {
    await navigator.share({ files, ...data });
    return 'shared';
  } catch (e) {
    // The user dismissing the sheet rejects with AbortError. That is a choice,
    // not a problem, and must not surface as "sharing failed".
    return (e as DOMException)?.name === 'AbortError' ? 'cancelled' : 'failed';
  }
}

// A filesystem-safe stem built from a level name and an ISO timestamp, so a
// folder of saved shots sorts by level and by when it was taken.
export function fileStem(kind: string, levelName: string, isoStamp: string): string {
  const slug = levelName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
  const stamp = isoStamp.replace(/[:.]/g, '-').slice(0, 19);
  return `smallhands-${kind}-${slug || 'level'}-${stamp}`;
}
