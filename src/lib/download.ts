/**
 * Blob download helper shared by the settings-backup export and the About
 * tab's diagnostic report.
 *
 * The object URL is revoked on the next macrotask rather than immediately after
 * `click()`: the webview starts the download asynchronously, so revoking in the
 * same tick can cancel it before it begins (a long-standing Chromium/WebView2
 * behaviour). The anchor is also attached to the DOM before clicking, which
 * some engines require for a programmatic download to register at all.
 */
export function downloadTextFile(filename: string, contents: string, mimeType: string): void {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';

  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 0);
}
