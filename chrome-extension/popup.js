// Big Wave Auto — Manheim CR Extractor

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

// ── Scan ──
$('scanBtn').addEventListener('click', async () => {
  showStatus('Scanning page...', 'working');
  $('scanBtn').disabled = true;
  $('submitBtn').style.display = 'none';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.url?.includes('manheim.com')) {
      showStatus('Navigate to a Manheim page first.', 'error');
      $('scanBtn').disabled = false;
      return;
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractManheimData,
    });

    extractedData = results?.[0]?.result;

    if (!extractedData || (!extractedData.vin && !extractedData.photos?.length)) {
      showStatus('Nothing found on this page. Try a listing or CR page.', 'error');
      $('scanBtn').disabled = false;
      return;
    }

    // Show VIN
    if (extractedData.vin) {
      $('vinSection').style.display = 'block';
      $('vinValue').textContent = extractedData.vin;
    }

    // Show vehicle info
    const v = extractedData.vehicle || {};
    const hasVehicle = v.year || v.make || v.model;
    if (hasVehicle) {
      let html = `<div class="vi-title">${v.year || ''} ${v.make || ''} ${v.model || ''} ${v.trim || ''}</div>`;
      const fields = [
        ['Mileage', v.mileage], ['Exterior', v.exterior_color], ['Interior', v.interior_color],
        ['Engine', v.engine], ['Transmission', v.transmission], ['Drivetrain', v.drivetrain],
        ['Body', v.body], ['Grade', v.grade],
      ];
      for (const [label, val] of fields) {
        if (val) html += `<div class="vi-row"><span class="vi-label">${label}</span><span class="vi-value">${val}</span></div>`;
      }
      $('vehicleInfo').innerHTML = html;
      $('vehicleInfo').style.display = 'block';
    }

    // Show summary
    const cr = extractedData.condition || {};
    const parts = [];
    if (cr.damage?.length) parts.push(`<b>${cr.damage.length}</b> damage notes`);
    if (cr.options?.length) parts.push(`<b>${cr.options.length}</b> options`);
    if (cr.announcements?.length) parts.push(`<b>${cr.announcements.length}</b> announcements`);
    if (parts.length) {
      $('scanSummary').innerHTML = 'Extracted: ' + parts.join(' · ');
      $('scanSummary').style.display = 'block';
    }

    // Show photos
    if (extractedData.photos?.length) {
      $('photoCount').textContent = `${extractedData.photos.length} photos`;
      $('photosPreview').innerHTML = extractedData.photos
        .slice(0, 20)
        .map(url => `<img src="${url}" />`)
        .join('');
      $('photosSection').style.display = 'block';
    }

    // Show submit button
    $('submitBtn').style.display = 'flex';
    showStatus('Ready to submit.', 'success');

  } catch (err) {
    showStatus('Scan failed: ' + err.message, 'error');
  }

  $('scanBtn').disabled = false;
});

// ── Submit ──
$('submitBtn').addEventListener('click', async () => {
  const serverUrl = $('serverUrl').value.replace(/\/+$/, '');
  const apiKey = $('apiKey').value;

  if (!serverUrl) { showStatus('Enter server URL.', 'error'); return; }
  if (!apiKey) { showStatus('Enter API key.', 'error'); return; }
  if (!extractedData) { showStatus('Scan a page first.', 'error'); return; }

  $('submitBtn').disabled = true;
  showStatus('Submitting...', 'working');

  try {
    const response = await fetch(`${serverUrl}/api/ext/proposal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify(extractedData),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`${response.status}: ${err}`);
    }

    const result = await response.json();
    showStatus(`Submitted! Edit at: ${serverUrl}/admin/proposals`, 'success');
    $('submitBtn').textContent = 'Submitted';

  } catch (err) {
    showStatus('Failed: ' + err.message, 'error');
    $('submitBtn').disabled = false;
  }
});


/**
 * Runs INSIDE the Manheim page. Extracts everything.
 */
function extractManheimData() {
  const photos = new Set();
  const vehicle = {};
  const condition = { damage: [], options: [], announcements: [] };

  const pageText = document.body.innerText || '';

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

  // ── Vehicle info ──
  const fieldPatterns = [
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
      if (m) { vehicle[key] = m[1].trim().replace(/\s+/g, ' '); break; }
    }
  }

  // Year/Make/Model from title
  const titleEl = document.querySelector('h1, [class*="vehicle-title"], [class*="vehicleTitle"]');
  const titleText = titleEl?.textContent?.trim() || document.title || '';
  const ymmMatch = titleText.match(/(\d{4})\s+([\w-]+)\s+([\w-]+(?:\s+[\w-]+)?)/);
  if (ymmMatch) {
    vehicle.year = ymmMatch[1];
    vehicle.make = ymmMatch[2];
    vehicle.model = ymmMatch[3];
  }
  const trimMatch = titleText.match(/(\d{4})\s+[\w-]+\s+[\w-]+\s+(.*)/);
  if (trimMatch && trimMatch[2]) vehicle.trim = trimMatch[2].trim();

  // Grade
  const gradeMatch = pageText.match(/(?:condition\s*grade|grade|CR\s*Grade)[:\s]*([0-9.]+(?:\s*[-\/]\s*[0-9.]+)?)/i);
  if (gradeMatch) { condition.overall_grade = gradeMatch[1].trim(); vehicle.grade = gradeMatch[1].trim(); }

  // Seller
  const sellerMatch = pageText.match(/(?:seller|consignor)[:\s]*([^\n]+)/i);
  if (sellerMatch) vehicle.seller = sellerMatch[1].trim();

  // ── Damage ──
  document.querySelectorAll('[class*="damage" i], [class*="condition" i], [class*="defect" i], [data-testid*="damage" i], [data-testid*="condition" i]').forEach(el => {
    const text = el.textContent?.trim();
    if (text && text.length > 3 && text.length < 200) condition.damage.push(text);
  });

  if (condition.damage.length === 0) {
    const lines = pageText.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length > 5 && trimmed.length < 200 &&
          /(?:dent|scratch|scuff|chip|crack|tear|stain|worn|faded|rust|missing|broken|bent|gouge|paint|panel|bumper|fender|hood|door|roof|quarter|trunk|hail)/i.test(trimmed)) {
        condition.damage.push(trimmed);
      }
    }
  }
  condition.damage = [...new Set(condition.damage)];

  // ── Announcements ──
  document.querySelectorAll('[class*="announcement" i], [data-testid*="announcement" i]').forEach(el => {
    const text = el.textContent?.trim();
    if (text && text.length > 3) condition.announcements.push(text);
  });
  condition.announcements = [...new Set(condition.announcements)];

  // ── Options ──
  document.querySelectorAll('[class*="option" i], [class*="feature" i], [class*="equipment" i], [class*="package" i]').forEach(el => {
    const items = el.querySelectorAll('li, [class*="item" i], span');
    if (items.length > 0) {
      items.forEach(item => {
        const text = item.textContent?.trim();
        if (text && text.length > 2 && text.length < 100) condition.options.push(text);
      });
    } else {
      const text = el.textContent?.trim();
      if (text && text.length > 2 && text.length < 300) {
        text.split(/[,\n]/).forEach(t => { if (t.trim().length > 2) condition.options.push(t.trim()); });
      }
    }
  });
  condition.options = [...new Set(condition.options)].slice(0, 50);

  // Tires
  const tireMatch = pageText.match(/(?:tire|tyre)s?[:\s]*([^\n]+)/i);
  if (tireMatch) condition.tires = tireMatch[1].trim();

  // ── Photos ──
  document.querySelectorAll('img').forEach(img => {
    let src = img.src || img.dataset?.src || img.getAttribute('data-lazy-src') || '';
    if (!src) return;
    if (img.naturalWidth > 0 && img.naturalWidth < 50) return;
    if (/logo|icon|avatar|sprite|svg|data:image/i.test(src)) return;
    src = src.replace(/\?.*$/, '').replace(/_thumb|_small|_medium|_tn|_sm|_md/gi, '');
    if (/\.(jpg|jpeg|png|webp)/i.test(src)) photos.add(src);
  });

  document.querySelectorAll('[style*="background-image"]').forEach(el => {
    const match = el.style.backgroundImage.match(/url\(["']?(.*?)["']?\)/);
    if (match?.[1] && /\.(jpg|jpeg|png|webp)/i.test(match[1])) photos.add(match[1].replace(/\?.*$/, ''));
  });

  document.querySelectorAll('[data-src], [data-full], [data-original], [data-zoom-image], [data-large]').forEach(el => {
    const src = el.dataset.src || el.dataset.full || el.dataset.original || el.dataset.zoomImage || el.dataset.large;
    if (src && /\.(jpg|jpeg|png|webp)/i.test(src)) photos.add(src.replace(/\?.*$/, ''));
  });

  document.querySelectorAll('script').forEach(script => {
    const text = script.textContent || '';
    const matches = text.matchAll(/"(https?:\/\/[^"]+\.(jpg|jpeg|png|webp))"/gi);
    for (const m of matches) {
      if (!/logo|icon/i.test(m[1])) photos.add(m[1].replace(/\?.*$/, ''));
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
