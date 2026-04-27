// Big Wave Auto — Manheim Photo Grabber popup

const $ = (s) => document.getElementById(s);

let extractedPhotos = [];
let detectedVin = '';

// Load saved settings
chrome.storage.local.get(['serverUrl', 'apiKey'], (data) => {
  $('serverUrl').value = data.serverUrl || 'https://bigwaveauto.com';
  $('apiKey').value = data.apiKey || '';
});

$('serverUrl').addEventListener('change', () => {
  chrome.storage.local.set({ serverUrl: $('serverUrl').value.replace(/\/+$/, '') });
});

$('apiKey').addEventListener('change', () => {
  chrome.storage.local.set({ apiKey: $('apiKey').value });
});

function showStatus(msg, type) {
  const el = $('status');
  el.textContent = msg;
  el.className = `status show ${type}`;
}

function hideStatus() {
  $('status').className = 'status';
}

// Scan button
$('scanBtn').addEventListener('click', async () => {
  hideStatus();
  showStatus('Scanning page...', 'working');
  $('scanBtn').disabled = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.url?.includes('manheim.com')) {
      showStatus('Navigate to a Manheim listing first.', 'error');
      $('scanBtn').disabled = false;
      return;
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractManheimData,
    });

    const data = results?.[0]?.result;

    if (!data || !data.photos?.length) {
      showStatus('No photos found on this page.', 'error');
      $('noPhotos').style.display = 'block';
      $('resultsSection').style.display = 'none';
      $('scanBtn').disabled = false;
      return;
    }

    extractedPhotos = data.photos;
    detectedVin = data.vin || '';

    // Show VIN
    if (detectedVin) {
      $('vinSection').style.display = 'block';
      $('vinValue').textContent = detectedVin;
    }

    // Show photos
    $('photoCount').textContent = `${extractedPhotos.length} photos found`;
    $('photosPreview').innerHTML = extractedPhotos
      .slice(0, 30)
      .map(url => `<img src="${url}" />`)
      .join('');
    $('resultsSection').style.display = 'block';
    $('noPhotos').style.display = 'none';

    showStatus(`Found ${extractedPhotos.length} photos.`, 'success');
  } catch (err) {
    showStatus('Scan failed: ' + err.message, 'error');
  }

  $('scanBtn').disabled = false;
});

// Send to vehicle profile
$('sendBtn').addEventListener('click', async () => {
  const serverUrl = $('serverUrl').value.replace(/\/+$/, '');
  const apiKey = $('apiKey').value;
  if (!serverUrl) { showStatus('Enter your server URL first.', 'error'); return; }
  if (!apiKey) { showStatus('Enter your API key first.', 'error'); return; }
  if (!extractedPhotos.length) return;

  $('sendBtn').disabled = true;
  showStatus(`Sending ${extractedPhotos.length} photos...`, 'working');

  try {
    const response = await fetch(`${serverUrl}/api/ext/manheim-photos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({
        vin: detectedVin,
        photos: extractedPhotos,
      }),
    });

    if (!response.ok) throw new Error(`Server returned ${response.status}`);

    const result = await response.json();
    showStatus(`Sent ${result.count || extractedPhotos.length} photos to ${detectedVin || 'vehicle'}.`, 'success');
  } catch (err) {
    showStatus('Failed to send: ' + err.message, 'error');
  }

  $('sendBtn').disabled = false;
});

// Download all as ZIP (via background)
$('downloadBtn').addEventListener('click', async () => {
  if (!extractedPhotos.length) return;
  $('downloadBtn').disabled = true;
  showStatus('Starting downloads...', 'working');

  try {
    chrome.runtime.sendMessage({
      action: 'downloadPhotos',
      photos: extractedPhotos,
      vin: detectedVin,
    }, (resp) => {
      if (resp?.success) {
        showStatus(`Downloading ${extractedPhotos.length} photos.`, 'success');
      } else {
        showStatus('Download failed.', 'error');
      }
      $('downloadBtn').disabled = false;
    });
  } catch (err) {
    showStatus('Download error: ' + err.message, 'error');
    $('downloadBtn').disabled = false;
  }
});


/**
 * This function runs INSIDE the Manheim page tab.
 * It extracts high-res photo URLs and the VIN.
 */
function extractManheimData() {
  const photos = new Set();

  // Strategy 1: Image elements — find high-res versions
  document.querySelectorAll('img').forEach(img => {
    let src = img.src || img.dataset?.src || img.getAttribute('data-lazy-src') || '';
    if (!src) return;

    // Skip tiny icons, logos, avatars
    if (img.naturalWidth > 0 && img.naturalWidth < 50) return;
    if (src.includes('logo') || src.includes('icon') || src.includes('avatar') || src.includes('sprite')) return;
    if (src.includes('svg') || src.includes('data:image')) return;

    // Upgrade to high-res: remove size suffixes, request full size
    src = src.replace(/\?.*$/, ''); // strip query params (often have w=, h=, size=)
    src = src.replace(/_thumb|_small|_medium|_tn|_sm|_md/gi, ''); // strip size suffixes
    src = src.replace(/\/s\/\d+x\d+\//, '/s/0x0/'); // some CDNs use /s/WxH/
    src = src.replace(/\/resize\/\d+x\d+\//, '/'); // strip resize paths
    src = src.replace(/\/w_\d+,h_\d+/, ''); // Cloudinary-style
    src = src.replace(/\/(fit|fill|crop)-in\/\d+x\d+\//, '/'); // thumbor-style

    // Only keep vehicle-like images (large photos, not UI elements)
    if (src.match(/\.(jpg|jpeg|png|webp)/i)) {
      photos.add(src);
    }
  });

  // Strategy 2: Background images in galleries/carousels
  document.querySelectorAll('[style*="background-image"]').forEach(el => {
    const match = el.style.backgroundImage.match(/url\(["']?(.*?)["']?\)/);
    if (match?.[1] && match[1].match(/\.(jpg|jpeg|png|webp)/i)) {
      let src = match[1].replace(/\?.*$/, '');
      photos.add(src);
    }
  });

  // Strategy 3: Data attributes commonly used for lightboxes/galleries
  document.querySelectorAll('[data-src], [data-full], [data-original], [data-zoom-image], [data-large], [data-high-res]').forEach(el => {
    const src = el.dataset.src || el.dataset.full || el.dataset.original || el.dataset.zoomImage || el.dataset.large || el.dataset.highRes;
    if (src && src.match(/\.(jpg|jpeg|png|webp)/i)) {
      photos.add(src.replace(/\?.*$/, ''));
    }
  });

  // Strategy 4: Look for JSON data in scripts (Manheim sometimes embeds image arrays)
  document.querySelectorAll('script').forEach(script => {
    const text = script.textContent || '';
    // Look for image URL arrays
    const matches = text.matchAll(/"(https?:\/\/[^"]+\.(jpg|jpeg|png|webp))"/gi);
    for (const m of matches) {
      const url = m[1];
      if (!url.includes('logo') && !url.includes('icon') && !url.includes('sprite')) {
        photos.add(url.replace(/\?.*$/, ''));
      }
    }
  });

  // Strategy 5: Source elements inside picture tags
  document.querySelectorAll('picture source').forEach(el => {
    const srcset = el.getAttribute('srcset') || '';
    // Get the largest image from srcset
    const parts = srcset.split(',').map(s => s.trim().split(/\s+/));
    let best = '';
    let bestW = 0;
    for (const [url, descriptor] of parts) {
      const w = parseInt(descriptor) || 0;
      if (w > bestW || !best) { best = url; bestW = w; }
    }
    if (best && best.match(/\.(jpg|jpeg|png|webp)/i)) {
      photos.add(best.replace(/\?.*$/, ''));
    }
  });

  // Extract VIN — look for common patterns
  let vin = '';

  // Check meta tags
  const metaVin = document.querySelector('meta[name*="vin" i], meta[property*="vin" i]');
  if (metaVin) vin = metaVin.content;

  // Check page text for 17-char VIN pattern
  if (!vin) {
    const pageText = document.body.innerText;
    const vinMatch = pageText.match(/\b[A-HJ-NPR-Z0-9]{17}\b/);
    if (vinMatch) vin = vinMatch[0];
  }

  // Check URL for VIN
  if (!vin) {
    const urlMatch = window.location.href.match(/[A-HJ-NPR-Z0-9]{17}/);
    if (urlMatch) vin = urlMatch[0];
  }

  return {
    vin,
    photos: [...photos],
    pageUrl: window.location.href,
    pageTitle: document.title,
  };
}
