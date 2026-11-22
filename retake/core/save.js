// Save a file to the user's Downloads folder, in a Retake subfolder.
// Uses Chrome's downloads system when available, so the name is kept exactly.
export async function saveFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    if (globalThis.chrome?.downloads?.download) {
      await chrome.downloads.download({ url, filename: `Retake/${filename}`, saveAs: false, conflictAction: 'uniquify' });
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
    }
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 120_000);
  }
}
