// Background service worker — handles downloads

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'downloadPhotos') {
    downloadAll(msg.photos, msg.vin).then(() => {
      sendResponse({ success: true });
    }).catch((err) => {
      sendResponse({ success: false, error: err.message });
    });
    return true; // async response
  }

  if (msg.action === 'openPopup') {
    // Can't open popup programmatically in MV3, but we can show a notification
    // The user needs to click the extension icon
  }
});

async function downloadAll(photos, vin) {
  const folder = vin ? `manheim-photos/${vin}` : 'manheim-photos';

  for (let i = 0; i < photos.length; i++) {
    const url = photos[i];
    const ext = url.match(/\.(jpg|jpeg|png|webp)/i)?.[1] || 'jpg';
    const filename = `${folder}/photo_${String(i + 1).padStart(2, '0')}.${ext}`;

    try {
      await chrome.downloads.download({
        url: url,
        filename: filename,
        conflictAction: 'uniquify',
      });
    } catch (err) {
      console.error(`Failed to download ${url}:`, err);
    }

    // Small delay to avoid hammering
    if (i < photos.length - 1) {
      await new Promise(r => setTimeout(r, 200));
    }
  }
}
