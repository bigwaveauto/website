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

    if (!tab?.url?.includes('manheim.com') && !tab?.url?.includes('insightcr')) {
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

    // Show auction / pricing data
    if (extractedData.auction) {
      const a = extractedData.auction;
      let ahtml = `<div class="vi-title">${extractedData.page_type === 'live_listing' ? 'Live Listing' : 'Auction'} ${a.channel ? '— ' + a.channel : ''}</div>`;
      if (a.buy_now) ahtml += `<div class="vi-row"><span class="vi-label">Buy Now</span><span class="vi-value" style="color:#16a34a;font-size:16px">$${a.buy_now.toLocaleString()}</span></div>`;
      if (a.current_bid) ahtml += `<div class="vi-row"><span class="vi-label">Current Bid</span><span class="vi-value">$${a.current_bid.toLocaleString()}</span></div>`;
      if (a.starting_bid) ahtml += `<div class="vi-row"><span class="vi-label">Starting Bid</span><span class="vi-value">$${a.starting_bid.toLocaleString()}</span></div>`;
      if (a.mmr) ahtml += `<div class="vi-row"><span class="vi-label">MMR</span><span class="vi-value" style="color:#2563eb">$${a.mmr.toLocaleString()}</span></div>`;
      if (a.sale_date) ahtml += `<div class="vi-row"><span class="vi-label">Sale Date</span><span class="vi-value">${a.sale_date}</span></div>`;
      if (a.lane) ahtml += `<div class="vi-row"><span class="vi-label">Lane</span><span class="vi-value">${a.lane}</span></div>`;
      $('auctionInfo').innerHTML = ahtml;
      $('auctionInfo').style.display = 'block';
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
 * Handles both live listings (search.manheim.com) and post-sale CRs.
 */
function extractManheimData() {
  const photos = new Set();
  const vehicle = {};
  const condition = { damage: [], options: [], announcements: [] };
  const auction = {};

  const pageText = document.body.innerText || '';
  const url = window.location.href;

  // Detect page type
  const isInsightCR = url.includes('insightcr.manheim.com') || url.includes('cr-display');
  const isLiveListing = !isInsightCR && (url.includes('search.manheim.com') || url.includes('/results') || url.includes('/listing'));
  const isOVE = url.includes('/OVE') || url.includes('channel=OVE');
  const isCR = isInsightCR || url.includes('/cr/') || url.includes('condition-report') || pageText.includes('Condition Report');

  // ── VIN — try URL first (most reliable for search pages) ──
  let vin = '';
  const urlVinMatch = url.match(/\/(?:details|vehicle|cr)\/([A-HJ-NPR-Z0-9]{17})/i);
  if (urlVinMatch) vin = urlVinMatch[1];
  if (!vin) {
    // Hash-based URL: #/details/VIN/OVE
    const hashMatch = url.match(/[#/]([A-HJ-NPR-Z0-9]{17})/);
    if (hashMatch) vin = hashMatch[1];
  }
  if (!vin) {
    const metaVin = document.querySelector('meta[name*="vin" i], meta[property*="vin" i]');
    if (metaVin) vin = metaVin.content;
  }
  if (!vin) {
    const vinMatch = pageText.match(/VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i) || pageText.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
    if (vinMatch) vin = vinMatch[1];
  }

  // ── InsightCR-specific extraction (insightcr.manheim.com/cr-display) ──
  if (isInsightCR) {
    // InsightCR has detailed panels with location + severity + damage type
    // Look for damage/condition rows with structured info
    document.querySelectorAll('tr, [role="row"], [class*="row" i]').forEach(row => {
      const cells = row.querySelectorAll('td, [role="cell"], [class*="cell" i], span, div');
      if (cells.length >= 2) {
        const texts = Array.from(cells).map(c => c.textContent?.trim()).filter(t => t && t.length > 1 && t.length < 100);
        const combined = texts.join(' — ');
        // Check if this row contains damage-related info
        if (/(?:dent|scratch|scuff|chip|crack|tear|curb|rash|worn|faded|missing|broken|gouge|paint|damage)/i.test(combined)) {
          if (!isJunk(combined)) condition.damage.push(combined);
        }
      }
    });

    // InsightCR often shows damage in card-like panels
    document.querySelectorAll('[class*="panel" i], [class*="card" i], [class*="detail" i]').forEach(panel => {
      // Only grab small panels, not huge containers
      if (panel.textContent && panel.textContent.length > 500) return;
      const text = panel.textContent?.trim();
      if (text && /(?:dent|scratch|scuff|chip|crack|tear|curb|rash|worn|faded|missing|broken|gouge)/i.test(text)) {
        // Clean up: split into meaningful parts
        const lines = text.split(/\n/).map(l => l.trim()).filter(l => l.length > 3 && l.length < 150 && !isJunk(l));
        for (const line of lines) {
          if (/(?:dent|scratch|scuff|chip|crack|tear|curb|rash|worn|faded|missing|broken|gouge|paint|LF|LR|RF|RR|front|rear|hood|bumper|fender|door|roof|quarter|trunk|wheel|rim)/i.test(line)) {
            condition.damage.push(line);
          }
        }
      }
    });

    // Dedupe
    condition.damage = [...new Set(condition.damage)];

    // InsightCR shows tire tread depth per position
    const tireLines = [];
    document.querySelectorAll('[class*="tire" i], [class*="tread" i]').forEach(el => {
      const text = el.textContent?.trim();
      if (text && text.length > 3 && text.length < 150 && !isJunk(text)) tireLines.push(text);
    });
    if (tireLines.length) condition.tires = tireLines.join(' | ');
  }

  // ── Vehicle info — try structured data first (JSON-LD, data attrs) ──
  // Many Manheim pages embed vehicle data in script tags as JSON
  document.querySelectorAll('script[type="application/ld+json"], script[type="application/json"]').forEach(script => {
    try {
      const data = JSON.parse(script.textContent);
      const v = data?.vehicle || data?.listing?.vehicle || data;
      if (v?.year) vehicle.year = String(v.year);
      if (v?.make) vehicle.make = v.make;
      if (v?.model) vehicle.model = v.model;
      if (v?.trim) vehicle.trim = v.trim;
      if (v?.mileage || v?.odometer) vehicle.mileage = String(v.mileage || v.odometer);
      if (v?.exteriorColor) vehicle.exterior_color = v.exteriorColor;
      if (v?.interiorColor) vehicle.interior_color = v.interiorColor;
      if (v?.engine) vehicle.engine = v.engine;
      if (v?.transmission) vehicle.transmission = v.transmission;
      if (v?.drivetrain) vehicle.drivetrain = v.drivetrain;
      if (v?.fuelType) vehicle.fuel = v.fuelType;
      if (v?.bodyStyle) vehicle.body = v.bodyStyle;
    } catch (e) {}
  });

  // Also check for __NEXT_DATA__ or embedded app state (common in React SPAs)
  document.querySelectorAll('script').forEach(script => {
    const text = script.textContent || '';
    if (text.includes('__NEXT_DATA__') || text.includes('window.__data') || text.includes('window.__INITIAL_STATE__')) {
      try {
        const match = text.match(/(?:__NEXT_DATA__|__data|__INITIAL_STATE__)\s*=\s*({.+?});?\s*(?:<\/script>|$)/s);
        if (match) {
          const data = JSON.parse(match[1]);
          // Walk the object looking for vehicle-like data
          const findVehicle = (obj, depth = 0) => {
            if (!obj || depth > 5) return;
            if (obj.vin && obj.year) {
              if (!vin && obj.vin) vin = obj.vin;
              if (obj.year) vehicle.year = String(obj.year);
              if (obj.make) vehicle.make = obj.make;
              if (obj.model) vehicle.model = obj.model;
              if (obj.trim) vehicle.trim = obj.trim;
              if (obj.mileage || obj.odometer) vehicle.mileage = String(obj.mileage || obj.odometer);
              if (obj.exteriorColor || obj.color) vehicle.exterior_color = obj.exteriorColor || obj.color;
              if (obj.interiorColor) vehicle.interior_color = obj.interiorColor;
              if (obj.engine) vehicle.engine = typeof obj.engine === 'string' ? obj.engine : obj.engine?.description;
              if (obj.transmission) vehicle.transmission = obj.transmission;
              if (obj.drivetrain || obj.driveType) vehicle.drivetrain = obj.drivetrain || obj.driveType;
              if (obj.fuelType || obj.fuel) vehicle.fuel = obj.fuelType || obj.fuel;
              if (obj.bodyStyle || obj.body) vehicle.body = obj.bodyStyle || obj.body;
              if (obj.seller) vehicle.seller = typeof obj.seller === 'string' ? obj.seller : obj.seller?.name;
              if (obj.conditionGrade || obj.grade) { condition.overall_grade = String(obj.conditionGrade || obj.grade); vehicle.grade = condition.overall_grade; }
              return;
            }
            if (typeof obj === 'object') {
              for (const key of Object.keys(obj)) {
                findVehicle(obj[key], depth + 1);
              }
            }
          };
          findVehicle(data);
        }
      } catch (e) {}
    }
  });

  // Fallback: regex from page text
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
    if (vehicle[key]) continue; // already got from structured data
    for (const pat of patterns) {
      const m = pageText.match(pat);
      if (m) { vehicle[key] = m[1].trim().replace(/\s+/g, ' '); break; }
    }
  }

  // Year/Make/Model from title if not already set
  if (!vehicle.year) {
    const titleEl = document.querySelector('h1, [class*="vehicle-title"], [class*="vehicleTitle"], [class*="VehicleTitle"]');
    const titleText = titleEl?.textContent?.trim() || document.title || '';
    const ymmMatch = titleText.match(/(\d{4})\s+([\w-]+)\s+([\w-]+(?:\s+[\w-]+)?)/);
    if (ymmMatch) {
      vehicle.year = ymmMatch[1];
      vehicle.make = ymmMatch[2];
      vehicle.model = ymmMatch[3];
    }
    const trimMatch = titleText.match(/(\d{4})\s+[\w-]+\s+[\w-]+\s+(.*)/);
    if (trimMatch && trimMatch[2]) vehicle.trim = trimMatch[2].trim();
  }

  // Grade
  if (!condition.overall_grade) {
    const gradeMatch = pageText.match(/(?:condition\s*grade|grade|CR\s*Grade)[:\s]*([0-9.]+(?:\s*[-\/]\s*[0-9.]+)?)/i);
    if (gradeMatch) { condition.overall_grade = gradeMatch[1].trim(); vehicle.grade = gradeMatch[1].trim(); }
  }

  // Seller
  if (!vehicle.seller) {
    const sellerMatch = pageText.match(/(?:seller|consignor|sold\s*by)[:\s]*([^\n]+)/i);
    if (sellerMatch) vehicle.seller = sellerMatch[1].trim();
  }

  // ── Auction / pricing data (live listings) ──
  const pricePatterns = [
    { key: 'buy_now', pattern: /(?:buy\s*now|buy\s*it\s*now|purchase\s*price)[:\s]*\$?([\d,]+)/i },
    { key: 'current_bid', pattern: /(?:current\s*bid|high\s*bid|bid)[:\s]*\$?([\d,]+)/i },
    { key: 'starting_bid', pattern: /(?:start(?:ing)?\s*bid|floor\s*price|reserve)[:\s]*\$?([\d,]+)/i },
    { key: 'mmr', pattern: /(?:MMR|manheim\s*market\s*report)[:\s]*\$?([\d,]+)/i },
  ];
  for (const { key, pattern } of pricePatterns) {
    const m = pageText.match(pattern);
    if (m) auction[key] = parseInt(m[1].replace(/,/g, ''));
  }

  // Sale channel — detect from URL and page content
  const channelMatch = pageText.match(/(?:sale\s*type|channel|auction\s*type)[:\s]*([^\n]+)/i);
  if (channelMatch) {
    auction.channel = channelMatch[1].trim();
  } else if (isOVE) {
    auction.channel = 'OVE';
  } else if (/simulcast/i.test(pageText)) {
    auction.channel = 'Simulcast';
  } else if (/in[\s-]*lane/i.test(pageText)) {
    auction.channel = 'In-Lane';
  } else if (isLiveListing) {
    auction.channel = 'Digital';
  }

  // Sale date / lane
  const saleDateMatch = pageText.match(/(?:sale\s*date|auction\s*date)[:\s]*([^\n]+)/i);
  if (saleDateMatch) auction.sale_date = saleDateMatch[1].trim();
  const laneMatch = pageText.match(/(?:lane|run)[:\s]*([^\n]+)/i);
  if (laneMatch) auction.lane = laneMatch[1].trim();

  // ── Damage / Condition Notes ──
  // Junk filter: skip CSS artifacts, UI chrome, and vague labels
  const isJunk = (text) => {
    if (!text || text.length < 5 || text.length > 200) return true;
    // CSS/SVG artifacts
    if (/\{|fill:|\.dash|stroke|class=|<svg|<path/i.test(text)) return true;
    // UI labels, not actual condition data
    if (/^(sort by|filter|condition details|type|condition|location|severity|miscellaneous)$/i.test(text)) return true;
    // Generic headers
    if (/^(view|show|hide|close|expand|collapse|back|next|previous|cancel)$/i.test(text)) return true;
    return false;
  };

  // Look for leaf-level damage items (not parent containers)
  document.querySelectorAll('[class*="damage-item" i], [class*="defect-item" i], [class*="condition-item" i], [data-testid*="damage-item" i]').forEach(el => {
    const text = el.textContent?.trim();
    if (!isJunk(text)) condition.damage.push(text);
  });

  // Fallback: scan text for actual damage descriptions
  if (condition.damage.length === 0) {
    const lines = pageText.split('\n');
    const damageKeywords = /(?:dent|scratch|scuff|chip|crack|tear|stain|worn|faded|rust|missing|broken|bent|gouge|curb\s*rash|hail)/i;
    const locationKeywords = /(?:wheel|bumper|fender|hood|door|roof|quarter|trunk|panel|mirror|windshield|rim|tire|LF|LR|RF|RR|front|rear)/i;

    for (const line of lines) {
      const trimmed = line.trim();
      if (isJunk(trimmed)) continue;
      // Must have a damage keyword AND a location, or be a clear damage phrase
      if (damageKeywords.test(trimmed) && (locationKeywords.test(trimmed) || trimmed.split(/\s+/).length >= 3)) {
        condition.damage.push(trimmed);
      }
    }
  }

  // Consolidate: merge fragments that appear to be parts of the same item
  // e.g. "LR Wheel" + "Curb Rash" + "Miscellaneous" → "LR Wheel — Curb Rash"
  const consolidated = [];
  const seen = new Set();
  for (const d of condition.damage) {
    // Skip if this text is a substring of something already added
    if (seen.has(d)) continue;
    let dominated = false;
    for (const s of seen) {
      if (s.includes(d)) { dominated = true; break; }
    }
    if (dominated) continue;
    // Remove entries that are substrings of this one
    const filtered = [...seen].filter(s => !d.includes(s));
    seen.clear();
    filtered.forEach(s => seen.add(s));
    seen.add(d);
    consolidated.push(d);
  }
  condition.damage = consolidated;

  // Also pull "No structural damages/issues" as positive signals, not damage
  const positiveNotes = [];
  const realDamage = [];
  for (const d of condition.damage) {
    if (/^no\s+(structural|other)\s+(damage|issue|condition)/i.test(d)) {
      positiveNotes.push(d);
    } else {
      realDamage.push(d);
    }
  }
  condition.damage = realDamage;
  if (positiveNotes.length) condition.positive_notes = positiveNotes;

  // ── Announcements ──
  document.querySelectorAll('[class*="announcement-item" i], [class*="announcement-text" i], [data-testid*="announcement" i]').forEach(el => {
    // Only grab leaf text, not parent containers
    if (el.children.length > 3) return; // likely a container
    const text = el.textContent?.trim();
    if (!isJunk(text)) condition.announcements.push(text);
  });
  condition.announcements = [...new Set(condition.announcements)];

  // ── Options ──
  document.querySelectorAll('[class*="option-item" i], [class*="feature-item" i], [class*="equipment-item" i], [class*="package-item" i]').forEach(el => {
    const text = el.textContent?.trim();
    if (!isJunk(text) && text.length < 100) condition.options.push(text);
  });

  // Fallback: broader selectors but only grab leaf nodes
  if (condition.options.length === 0) {
    document.querySelectorAll('[class*="option" i], [class*="feature" i], [class*="equipment" i]').forEach(el => {
      const items = el.querySelectorAll('li, span');
      items.forEach(item => {
        if (item.children.length > 1) return; // skip containers
        const text = item.textContent?.trim();
        if (!isJunk(text) && text.length > 3 && text.length < 100) condition.options.push(text);
      });
    });
  }
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
    auction: Object.keys(auction).length > 0 ? auction : null,
    photos: [...photos],
    page_type: isInsightCR ? 'insight_cr' : isLiveListing ? 'live_listing' : isCR ? 'condition_report' : 'unknown',
    source_url: window.location.href,
    source_title: document.title,
    extracted_at: new Date().toISOString(),
  };
}
