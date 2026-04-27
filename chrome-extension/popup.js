// Big Wave Auto — Manheim Photo Grabber + CR Extractor

const $ = (s) => document.getElementById(s);

let extractedData = null;

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

function getSettings() {
  return {
    serverUrl: $('serverUrl').value.replace(/\/+$/, ''),
    apiKey: $('apiKey').value,
  };
}

// ── Scan button ──
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

    extractedData = results?.[0]?.result;

    if (!extractedData) {
      showStatus('Could not extract data from this page.', 'error');
      $('scanBtn').disabled = false;
      return;
    }

    // Show VIN
    if (extractedData.vin) {
      $('vinSection').style.display = 'block';
      $('vinValue').textContent = extractedData.vin;
    }

    // Show vehicle info
    if (extractedData.vehicle && Object.keys(extractedData.vehicle).length > 0) {
      const v = extractedData.vehicle;
      let html = '';
      if (v.year || v.make || v.model) {
        html += `<div class="vi-title">${v.year || ''} ${v.make || ''} ${v.model || ''} ${v.trim || ''}</div>`;
      }
      const fields = [
        ['Mileage', v.mileage],
        ['Exterior', v.exterior_color],
        ['Interior', v.interior_color],
        ['Engine', v.engine],
        ['Transmission', v.transmission],
        ['Drivetrain', v.drivetrain],
        ['Fuel', v.fuel],
        ['Body', v.body],
        ['Grade', v.grade],
        ['Seller', v.seller],
        ['Sale Date', v.sale_date],
        ['Channel', v.channel],
      ];
      for (const [label, val] of fields) {
        if (val) html += `<div class="vi-row"><span class="vi-label">${label}</span><span class="vi-value">${val}</span></div>`;
      }
      if (html) {
        $('vehicleInfo').innerHTML = html;
        $('vehicleInfo').style.display = 'block';
      }
    }

    // Show condition report details
    if (extractedData.condition) {
      const cr = extractedData.condition;
      let html = '<h3>Condition Report</h3>';

      if (cr.overall_grade) html += `<div class="cr-item"><b>Grade:</b> ${cr.overall_grade}</div>`;
      if (cr.announcements?.length) html += `<div class="cr-item"><b>Announcements:</b> ${cr.announcements.join(', ')}</div>`;

      if (cr.damage?.length) {
        html += '<h3 style="margin-top:8px">Damage / Issues</h3>';
        for (const d of cr.damage) {
          html += `<div class="cr-item damage">${d}</div>`;
        }
      }

      if (cr.options?.length) {
        html += '<h3 style="margin-top:8px">Options / Packages</h3>';
        for (const o of cr.options) {
          html += `<div class="cr-item">${o}</div>`;
        }
      }

      if (cr.tires) html += `<div class="cr-item" style="margin-top:6px"><b>Tires:</b> ${cr.tires}</div>`;

      $('crDetails').innerHTML = html;
      $('crDetails').style.display = 'block';
    }

    // Show photos
    if (extractedData.photos?.length) {
      $('photoCount').textContent = `${extractedData.photos.length} photos found`;
      $('photosPreview').innerHTML = extractedData.photos
        .slice(0, 30)
        .map(url => `<img src="${url}" />`)
        .join('');
      $('resultsSection').style.display = 'block';
      $('noPhotos').style.display = 'none';
      showStatus(`Found ${extractedData.photos.length} photos + vehicle data.`, 'success');
    } else {
      $('resultsSection').style.display = 'none';
      $('noPhotos').style.display = 'block';
      showStatus('No photos found, but extracted vehicle data.', 'info');
    }

  } catch (err) {
    showStatus('Scan failed: ' + err.message, 'error');
  }

  $('scanBtn').disabled = false;
});

// ── Create Proposal ──
$('proposalBtn').addEventListener('click', async () => {
  const { serverUrl, apiKey } = getSettings();
  if (!serverUrl || !apiKey) { showStatus('Enter server URL and API key.', 'error'); return; }
  if (!extractedData) return;

  $('proposalBtn').disabled = true;
  showStatus('Creating proposal...', 'working');

  try {
    const response = await fetch(`${serverUrl}/api/ext/proposal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify(extractedData),
    });

    if (!response.ok) throw new Error(`Server returned ${response.status}`);

    const result = await response.json();
    const link = `${serverUrl}/proposal/${result.id}`;

    $('proposalUrl').value = link;
    $('proposalResult').style.display = 'block';
    showStatus('Proposal created. Share the link.', 'success');
  } catch (err) {
    showStatus('Failed: ' + err.message, 'error');
  }

  $('proposalBtn').disabled = false;
});

// ── Copy link ──
$('copyLinkBtn').addEventListener('click', () => {
  const url = $('proposalUrl').value;
  navigator.clipboard.writeText(url).then(() => {
    $('copyLinkBtn').textContent = 'Copied!';
    setTimeout(() => { $('copyLinkBtn').textContent = 'Copy Link'; }, 2000);
  });
});

// ── Send Photos ──
$('sendBtn').addEventListener('click', async () => {
  const { serverUrl, apiKey } = getSettings();
  if (!serverUrl || !apiKey) { showStatus('Enter server URL and API key.', 'error'); return; }
  if (!extractedData?.photos?.length) return;

  $('sendBtn').disabled = true;
  showStatus(`Sending ${extractedData.photos.length} photos...`, 'working');

  try {
    const response = await fetch(`${serverUrl}/api/ext/manheim-photos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify({ vin: extractedData.vin, photos: extractedData.photos }),
    });
    if (!response.ok) throw new Error(`Server returned ${response.status}`);
    const result = await response.json();
    showStatus(`Sent ${result.count} photos.`, 'success');
  } catch (err) {
    showStatus('Failed: ' + err.message, 'error');
  }
  $('sendBtn').disabled = false;
});

// ── Download ──
$('downloadBtn').addEventListener('click', async () => {
  if (!extractedData?.photos?.length) return;
  $('downloadBtn').disabled = true;
  chrome.runtime.sendMessage({
    action: 'downloadPhotos',
    photos: extractedData.photos,
    vin: extractedData.vin,
  }, () => {
    showStatus(`Downloading ${extractedData.photos.length} photos.`, 'success');
    $('downloadBtn').disabled = false;
  });
});


/**
 * Runs INSIDE the Manheim page. Extracts everything: photos, vehicle info, condition report.
 */
function extractManheimData() {
  const photos = new Set();
  const vehicle = {};
  const condition = { damage: [], options: [], announcements: [] };

  // ── Extract all text content for parsing ──
  const pageText = document.body.innerText || '';
  const pageHtml = document.body.innerHTML || '';

  // ── VIN ──
  let vin = '';
  const metaVin = document.querySelector('meta[name*="vin" i], meta[property*="vin" i]');
  if (metaVin) vin = metaVin.content;
  if (!vin) {
    const vinMatch = pageText.match(/VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i) || pageText.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
    if (vinMatch) vin = vinMatch[1];
  }
  if (!vin) {
    const urlMatch = window.location.href.match(/[A-HJ-NPR-Z0-9]{17}/);
    if (urlMatch) vin = urlMatch[0];
  }

  // ── Vehicle info — scrape labeled fields ──
  const fieldPatterns = [
    { key: 'year', patterns: [/(\d{4})\s+([\w-]+)\s+([\w-]+)/] },
    { key: 'mileage', patterns: [/(?:mileage|odometer|miles)[:\s]*([0-9,]+)/i] },
    { key: 'exterior_color', patterns: [/(?:ext(?:erior)?[\s.]*(?:color)?)[:\s]*([A-Za-z\s]+?)(?:\n|$|Int)/i] },
    { key: 'interior_color', patterns: [/(?:int(?:erior)?[\s.]*(?:color)?)[:\s]*([A-Za-z\s]+?)(?:\n|$)/i] },
    { key: 'engine', patterns: [/(?:engine|motor)[:\s]*([^\n]+)/i] },
    { key: 'transmission', patterns: [/(?:trans(?:mission)?)[:\s]*([^\n]+)/i] },
    { key: 'drivetrain', patterns: [/(?:drive\s*train|drivetrain|drive\s*type)[:\s]*([^\n]+)/i] },
    { key: 'fuel', patterns: [/(?:fuel(?:\s*type)?)[:\s]*([^\n]+)/i] },
    { key: 'body', patterns: [/(?:body\s*(?:style|type)?)[:\s]*([^\n]+)/i] },
  ];

  for (const { key, patterns } of fieldPatterns) {
    for (const pat of patterns) {
      const m = pageText.match(pat);
      if (m) {
        vehicle[key] = m[1].trim().replace(/\s+/g, ' ');
        break;
      }
    }
  }

  // Try to extract year/make/model from title or header
  const titleEl = document.querySelector('h1, [class*="vehicle-title"], [class*="vehicleTitle"], [data-testid*="title"]');
  const titleText = titleEl?.textContent?.trim() || document.title || '';
  const ymmMatch = titleText.match(/(\d{4})\s+([\w-]+)\s+([\w-]+(?:\s+[\w-]+)?)/);
  if (ymmMatch) {
    vehicle.year = ymmMatch[1];
    vehicle.make = ymmMatch[2];
    vehicle.model = ymmMatch[3];
  }

  // Trim from title
  const trimMatch = titleText.match(/(\d{4})\s+[\w-]+\s+[\w-]+\s+(.*)/);
  if (trimMatch && trimMatch[2]) vehicle.trim = trimMatch[2].trim();

  // Grade
  const gradeMatch = pageText.match(/(?:condition\s*grade|grade|CR\s*Grade)[:\s]*([0-9.]+(?:\s*[-\/]\s*[0-9.]+)?)/i);
  if (gradeMatch) { condition.overall_grade = gradeMatch[1].trim(); vehicle.grade = gradeMatch[1].trim(); }

  // Seller
  const sellerMatch = pageText.match(/(?:seller|consignor)[:\s]*([^\n]+)/i);
  if (sellerMatch) vehicle.seller = sellerMatch[1].trim();

  // ── Condition Report: damage, dents, scratches ──
  const damagePatterns = [
    /(?:damage|dent|scratch|scuff|chip|crack|tear|stain|worn|faded|rust|corrosion|missing|broken|bent|gouge|discolor)[^\n]*/gi,
  ];
  // Look for damage in structured sections
  document.querySelectorAll('[class*="damage" i], [class*="condition" i], [class*="defect" i], [class*="announcement" i], [data-testid*="damage" i], [data-testid*="condition" i]').forEach(el => {
    const text = el.textContent?.trim();
    if (text && text.length > 3 && text.length < 200) {
      condition.damage.push(text);
    }
  });

  // Scan page text for damage keywords if no structured elements found
  if (condition.damage.length === 0) {
    const lines = pageText.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length > 5 && trimmed.length < 200) {
        if (/(?:dent|scratch|scuff|chip|crack|tear|stain|worn|faded|rust|missing|broken|bent|gouge|paint|panel|bumper|fender|hood|door|roof|quarter|trunk|hail)/i.test(trimmed)) {
          condition.damage.push(trimmed);
        }
      }
    }
  }

  // Deduplicate damage
  condition.damage = [...new Set(condition.damage)];

  // ── Announcements ──
  document.querySelectorAll('[class*="announcement" i], [data-testid*="announcement" i]').forEach(el => {
    const text = el.textContent?.trim();
    if (text && text.length > 3) condition.announcements.push(text);
  });
  // Also look for announcement text patterns
  const annMatch = pageText.match(/(?:announcements?|seller\s*disclosures?)[:\s]*([^\n]+(?:\n[^\n]+)*)/i);
  if (annMatch && condition.announcements.length === 0) {
    annMatch[1].split('\n').forEach(l => {
      const t = l.trim();
      if (t.length > 3) condition.announcements.push(t);
    });
  }
  condition.announcements = [...new Set(condition.announcements)];

  // ── Options / Packages ──
  document.querySelectorAll('[class*="option" i], [class*="feature" i], [class*="equipment" i], [class*="package" i], [data-testid*="option" i], [data-testid*="feature" i]').forEach(el => {
    // Get individual items if it's a list
    const items = el.querySelectorAll('li, [class*="item" i], span');
    if (items.length > 0) {
      items.forEach(item => {
        const text = item.textContent?.trim();
        if (text && text.length > 2 && text.length < 100) condition.options.push(text);
      });
    } else {
      const text = el.textContent?.trim();
      if (text && text.length > 2 && text.length < 300) {
        // Split comma or newline separated
        text.split(/[,\n]/).forEach(t => {
          const trimmed = t.trim();
          if (trimmed.length > 2) condition.options.push(trimmed);
        });
      }
    }
  });
  condition.options = [...new Set(condition.options)].slice(0, 50);

  // ── Tires ──
  const tireMatch = pageText.match(/(?:tire|tyre)s?[:\s]*([^\n]+)/i);
  if (tireMatch) condition.tires = tireMatch[1].trim();

  // ── Photos ──
  document.querySelectorAll('img').forEach(img => {
    let src = img.src || img.dataset?.src || img.getAttribute('data-lazy-src') || '';
    if (!src) return;
    if (img.naturalWidth > 0 && img.naturalWidth < 50) return;
    if (src.includes('logo') || src.includes('icon') || src.includes('avatar') || src.includes('sprite') || src.includes('svg') || src.includes('data:image')) return;
    src = src.replace(/\?.*$/, '');
    src = src.replace(/_thumb|_small|_medium|_tn|_sm|_md/gi, '');
    src = src.replace(/\/s\/\d+x\d+\//, '/s/0x0/');
    src = src.replace(/\/resize\/\d+x\d+\//, '/');
    if (src.match(/\.(jpg|jpeg|png|webp)/i)) photos.add(src);
  });

  document.querySelectorAll('[style*="background-image"]').forEach(el => {
    const match = el.style.backgroundImage.match(/url\(["']?(.*?)["']?\)/);
    if (match?.[1] && match[1].match(/\.(jpg|jpeg|png|webp)/i)) photos.add(match[1].replace(/\?.*$/, ''));
  });

  document.querySelectorAll('[data-src], [data-full], [data-original], [data-zoom-image], [data-large]').forEach(el => {
    const src = el.dataset.src || el.dataset.full || el.dataset.original || el.dataset.zoomImage || el.dataset.large;
    if (src && src.match(/\.(jpg|jpeg|png|webp)/i)) photos.add(src.replace(/\?.*$/, ''));
  });

  document.querySelectorAll('script').forEach(script => {
    const text = script.textContent || '';
    const matches = text.matchAll(/"(https?:\/\/[^"]+\.(jpg|jpeg|png|webp))"/gi);
    for (const m of matches) {
      if (!m[1].includes('logo') && !m[1].includes('icon')) photos.add(m[1].replace(/\?.*$/, ''));
    }
  });

  return {
    vin,
    vehicle,
    condition,
    photos: [...photos],
    source_url: window.location.href,
    source_title: document.title,
    extracted_at: new Date().toISOString(),
  };
}
