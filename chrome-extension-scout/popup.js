// BWA Auction Scout — popup.js

const $ = (s) => document.getElementById(s);

function showStatus(msg, type) {
  const el = $('status');
  el.textContent = msg;
  el.className = `status show ${type}`;
}

function fmt(n) { return n ? '$' + Number(n).toLocaleString() : '—'; }

// Load saved settings (shared storage key with main BWA extension)
chrome.storage.local.get(['serverUrl', 'apiKey'], (data) => {
  $('serverUrl').value = data.serverUrl || 'https://bigwaveauto.com';
  $('apiKey').value = data.apiKey || '';
});
$('serverUrl').addEventListener('change', () => chrome.storage.local.set({ serverUrl: $('serverUrl').value.replace(/\/+$/, '') }));
$('apiKey').addEventListener('change', () => chrome.storage.local.set({ apiKey: $('apiKey').value }));

// Show FB button when FB Marketplace tabs are open
(async () => {
  const allTabs = await chrome.tabs.query({});
  const fbTabs = allTabs.filter(t => t.url?.includes('facebook.com/marketplace'));
  if (fbTabs.length > 0) {
    $('fbBtn').style.display = 'flex';
    $('fbBtn').textContent = `📘 Scan ${fbTabs.length} FB Marketplace Tab${fbTabs.length !== 1 ? 's' : ''}`;
  }
})();

// ── Auction page scraper (runs in page context) ──
function scrapeAuctionPage() {
  const VIN_RE = /\b([A-HJ-NPR-Z0-9]{17})\b/;

  function findLabel(lines, label) {
    const low = label.toLowerCase();
    for (let i = 0; i < lines.length - 1; i++) {
      if (lines[i].toLowerCase() === low) {
        for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
          const v = lines[j].trim();
          if (v) return v;
        }
      }
    }
    return '';
  }

  function validCR(val) { const n = parseFloat(val); return !isNaN(n) && n >= 0 && n <= 5.0; }

  function extractCR(text) {
    let m = text.match(/Condition\s+Report\s*:?\s*([0-5](?:\.\d)?)\b/i);
    if (m && validCR(m[1])) return m[1];
    m = text.match(/\bCR\s*:?\s*([0-5](?:\.\d)?)\b/);
    if (m && validCR(m[1])) return m[1];
    return '';
  }

  const results = [];
  const seen = {};
  const diagnostics = { vinNodesFound: 0, cardsFound: 0, noCardReason: [] };

  // Walk all text nodes looking for VINs
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
  const vinTextNodes = [];
  let node;
  while ((node = walker.nextNode())) {
    if (VIN_RE.test(node.nodeValue)) vinTextNodes.push(node);
  }

  // Fallback: data attributes
  if (vinTextNodes.length === 0) {
    document.querySelectorAll('[data-vin],[data-vehicle-vin],[aria-label*="VIN"],[title*="VIN"],input[value]').forEach(el => {
      const txt = el.getAttribute('data-vin') || el.getAttribute('data-vehicle-vin') || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || '';
      const m = txt.match(VIN_RE);
      if (m && el.parentElement) vinTextNodes.push({ nodeValue: txt, parentElement: el.parentElement });
    });
  }
  diagnostics.vinNodesFound = vinTextNodes.length;

  vinTextNodes.forEach(textNode => {
    const vinMatch = textNode.nodeValue.match(VIN_RE);
    if (!vinMatch) return;
    const vin = vinMatch[1].toUpperCase();
    if (seen[vin]) return;

    let el = textNode.parentElement;
    let cardEl = null, bestEl = null;

    for (let depth = 0; depth < 25; depth++) {
      if (!el || el === document.body) break;
      const text = el.innerText || '';
      const hasImg = !!el.querySelector('img');
      const hasLabels = text.includes('Auction House') || text.includes('Odometer') ||
                        text.includes('Buy Now') || text.includes('MMR') ||
                        text.includes('CR') || text.includes('Sale Date');
      if (hasImg && hasLabels && text.length < 8000) { cardEl = el; break; }
      if (hasLabels && text.length < 8000 && !bestEl) bestEl = el;
      el = el.parentElement;
    }
    if (!cardEl) cardEl = bestEl;
    if (!cardEl) { diagnostics.noCardReason.push(vin + ': no card'); return; }
    diagnostics.cardsFound++;

    const rawText = cardEl.innerText || '';
    const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);

    // Wider context for EV Overview section
    let wideText = rawText, wideLines = lines;
    let wideEl = cardEl.parentElement;
    for (let wi = 0; wi < 8; wi++) {
      if (!wideEl || wideEl === document.body) break;
      const wt = wideEl.innerText || '';
      if (wt.includes('Battery Capacity When New') || wt.includes('Number Of Motors')) {
        const vinIdx = wt.indexOf(vin);
        if (vinIdx !== -1) {
          const scoped = wt.slice(Math.max(0, vinIdx - 500), vinIdx + 6000);
          wideText = scoped;
          wideLines = scoped.split('\n').map(l => l.trim()).filter(Boolean);
        }
        break;
      }
      wideEl = wideEl.parentElement;
    }

    // Vehicle title
    let vehicle = findLabel(lines, 'Vehicle') || findLabel(lines, 'Description') || findLabel(lines, 'Unit') || '';
    if (!vehicle) {
      const headingTags = ['h1','h2','h3','h4','strong','[class*="title"]','[class*="name"]','[class*="vehicle"]','a'];
      for (const tag of headingTags) {
        const els = cardEl.querySelectorAll(tag);
        for (const he of els) {
          const ht = (he.innerText || '').trim().replace(/\s+/g, ' ');
          if (/\b20[12]\d\b/.test(ht) && ht.length > 8 && ht.length < 120) { vehicle = ht; break; }
        }
        if (vehicle) break;
      }
    }
    if (!vehicle) {
      for (let i = 0; i < Math.min(25, lines.length); i++) {
        if (/\b20[12]\d\b/.test(lines[i]) && /rivian|ford|chevy|chevrolet|gmc|toyota|honda|nissan|bmw|mercedes|kia|hyundai|jeep|ram|dodge|tesla|lucid|audi|lexus|lincoln|cadillac/i.test(lines[i])) {
          vehicle = lines[i]; break;
        }
      }
    }
    vehicle = (vehicle || '').replace(/\s+/g, ' ').trim();

    const yearMatch = (vehicle || rawText).match(/\b(20[12]\d)\b/);
    const year = yearMatch ? parseInt(yearMatch[1]) : null;

    let make = '', model = '', motor = '', battery = '';
    const vl = (vehicle || rawText).toLowerCase();

    if (vl.includes('rivian')) {
      make = 'Rivian';
      if (vl.includes('r1s')) model = 'R1S';
      else if (vl.includes('r1t')) model = 'R1T';
      else if (vl.includes('r2')) model = 'R2';
    } else {
      const tw = vehicle.replace(/\s+/g, ' ').trim().split(' ');
      const yIdx = tw.findIndex(w => /^20[12]\d$/.test(w));
      if (yIdx !== -1) { make = tw[yIdx + 1] || ''; model = tw[yIdx + 2] || ''; }
    }

    // Rivian motor/battery from VIN + text
    if (make === 'Rivian') {
      const vinMotorChar = vin[5];
      const vinYearChar = vin[9];
      const is2025plus = vinYearChar === 'S';

      if (vinMotorChar === 'A') { motor = 'Quad'; if (!is2025plus) battery = 'Large'; }
      else if (vinMotorChar === 'B') { motor = 'Dual'; if (!is2025plus) battery = 'Large'; }
      else if (vinMotorChar === 'C') { motor = is2025plus ? 'Tri' : 'Dual'; if (!is2025plus) battery = 'Max'; }

      const vUp = vehicle.toUpperCase();
      if (/\bQUAD\b/.test(vUp)) motor = 'Quad';
      else if (/\bTRI\b/.test(vUp)) motor = 'Tri';
      else if (/\bDUAL\b/.test(vUp)) motor = 'Dual';

      if (/\bLARGE\s*\+|\bLARGE PLUS/.test(vUp)) battery = 'Large+';
      else if (/\bSTANDARD\s*\+|\bSTANDARD PLUS/.test(vUp)) battery = 'Standard+';
      else if (/\bMAX\b/.test(vUp)) battery = 'Max';
      else if (/\bLARGE\b/.test(vUp)) battery = 'Large';
      else if (/\bSTANDARD\b/.test(vUp)) battery = 'Standard';

      if (!motor) {
        const nmStr = findLabel(lines, 'Number Of Motors') || findLabel(wideLines, 'Number Of Motors')
                    || (wideText.match(/Number\s+of\s+Motors[:\s]+(\d)/i) || [])[1] || '';
        if (nmStr) { const nm = parseInt(nmStr); motor = nm === 4 ? 'Quad' : nm === 3 ? 'Tri' : nm === 2 ? 'Dual' : ''; }
      }
      if (!battery) {
        const batStr = findLabel(lines, 'Battery Capacity When New') || findLabel(wideLines, 'Battery Capacity When New')
                     || (wideText.match(/Battery\s+Capacity\s+When\s+New[:\s]+([\d.]+)\s*kWh/i) || [])[1] || '';
        if (batStr) {
          const kwh = parseFloat(batStr);
          if (!isNaN(kwh)) battery = kwh < 115 ? 'Standard' : kwh < 145 ? 'Large' : kwh < 165 ? 'Large+' : 'Max';
        }
      }
    }

    let trim = '';
    if (vehicle && model) {
      const afterIdx = vehicle.toUpperCase().indexOf(model.toUpperCase());
      if (afterIdx !== -1) {
        trim = vehicle.slice(afterIdx + model.length).trim()
          .replace(/\b(SPORT UTILITY|CREW CAB|SHORT BED|4 DOOR|4D|2D|SUV|PICKUP|SEDAN|TRUCK|CAB)\b.*/i, '').trim()
          .toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
      }
    }

    const odoStr = findLabel(lines, 'Odometer') || (rawText.match(/(\d{1,3}(?:,\d{3})*)\s*mi\b/i) || [])[1] || '';
    const colorStr = findLabel(lines, 'Color') || '';
    const locationStr = findLabel(lines, 'Location') || findLabel(lines, 'Pickup') || '';
    const auctionHouse = findLabel(lines, 'Auction House') || '';
    const saleDateStr = findLabel(lines, 'Sale Date') || findLabel(lines, 'Sale') || findLabel(lines, 'Ends') || '';

    // CR
    let crStr = '';
    const crLabelVal = findLabel(lines, 'CR') || findLabel(lines, 'Condition Report') || findLabel(wideLines, 'CR');
    if (crLabelVal && validCR(crLabelVal)) crStr = crLabelVal;
    if (!crStr) crStr = extractCR(rawText) || extractCR(wideText);

    // MMR
    let mmrStr = '';
    const adjMmrAvg = rawText.match(/Adj[\s.]*MMR[\s\S]{0,300}?Avg\.?\s*\$?\s*([\d,]+)/i) ||
                      wideText.match(/Adj[\s.]*MMR[\s\S]{0,300}?Avg\.?\s*\$?\s*([\d,]+)/i);
    if (adjMmrAvg) mmrStr = adjMmrAvg[1];
    if (!mmrStr) mmrStr = findLabel(lines, 'MMR') || findLabel(lines, 'Manheim Market Report');
    if (!mmrStr) { const m = rawText.match(/\bMMR\s*:?\s*\$?\s*([\d,]{4,})/i) || wideText.match(/\bMMR\s*:?\s*\$?\s*([\d,]{4,})/i); if (m) mmrStr = m[1]; }

    // Buy Now
    const buyNowStr = findLabel(lines, 'Buy Now') || findLabel(lines, 'Buy It Now') || findLabel(lines, 'BIN')
                   || (rawText.match(/buy[\s\-]*(?:it[\s\-]*)?now[:\s]*\$?([\d,]+)/i) || [])[1] || '';

    function numVal(s) {
      if (!s || s === 'N/A' || s === '$0.00') return null;
      const n = parseFloat(String(s).replace(/[$,]/g, ''));
      return (!isNaN(n) && n > 0) ? n : null;
    }

    // Listing URL
    let listingUrl = '';
    for (const a of cardEl.querySelectorAll('a[href]')) {
      const href = a.href || '';
      if (href && href.includes(window.location.hostname) && href.length > 30) { listingUrl = href; break; }
    }

    // Best image
    const imgs = [...cardEl.querySelectorAll('img')]
      .map(img => ({ img, score: (() => {
        const src = img.src?.toLowerCase() || '';
        if (!src || src.startsWith('data:')) return -1;
        if (/logo|icon|badge|button|header|footer|checkmark|star|blank|pixel/.test(src)) return -1;
        const w = img.naturalWidth || img.width || 0;
        const h = img.naturalHeight || img.height || 0;
        if (w > 0 && w < 60) return -1;
        const bonus = /manheim|ove\.com|adesa|vehicle|photo|cloudfront|s3\.amazonaws/.test(src) ? 500000 : 0;
        return (w || 200) * (h || 150) + bonus;
      })() }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score);
    const bestImg = imgs[0]?.img?.src || '';

    const colorParts = colorStr.split('/').map(s => s.trim());

    seen[vin] = true;
    results.push({
      vin, vehicle, year, make, model, trim, motor, battery,
      mileage: parseInt((odoStr || '').replace(/[^\d]/g, '')) || null,
      exterior_color: colorParts[0] || null,
      interior_color: colorParts[1] || null,
      condition_grade: crStr || null,
      mmr: numVal(mmrStr),
      buy_now: numVal(buyNowStr),
      asking_price: numVal(buyNowStr),
      location: locationStr || null,
      auction_channel: auctionHouse || null,
      sale_date: saleDateStr || null,
      photos: bestImg ? [bestImg] : [],
      source: 'manheim',
      source_url: listingUrl || window.location.href,
    });
  });

  return { results, diagnostics, url: window.location.href };
}

// ── FB Marketplace tile scraper ──
function fbTilesScraper() {
  const seen = new Set();
  const listings = [];

  for (const link of document.querySelectorAll('a[href*="/marketplace/item/"]')) {
    const idMatch = link.href.match(/marketplace\/item\/(\d+)/);
    if (!idMatch) continue;
    const listingId = idMatch[1];
    if (seen.has(listingId)) continue;
    seen.add(listingId);

    const img = link.querySelector('img');
    const photo = (img?.src && !img.src.startsWith('data:')) ? img.src : '';
    const spans = [...link.querySelectorAll('span')]
      .map(s => s.childElementCount === 0 ? s.textContent.trim() : '')
      .filter(t => t.length > 1 && t.length < 120);

    const priceText = spans.find(t => /^\$[\d,]+/.test(t)) || '';
    const price = priceText ? parseInt(priceText.replace(/\D/g, '')) : null;
    const title = spans.find(t => /\b(19|20)\d{2}\b/.test(t)) || spans[0] || '';
    const mileageText = spans.find(t => /[\d,]+\s*miles?/i.test(t)) || '';
    const mileage = mileageText ? parseInt(mileageText.replace(/\D/g, '')) : null;
    const location = spans.find(t => t !== priceText && t !== title && t !== mileageText && t.length > 2 && /,\s*[A-Z]{2}$/.test(t)) || '';

    const text = title + ' ' + (location || '');
    const modelMatch = /r1s/i.test(text) ? 'R1S' : /r1t/i.test(text) ? 'R1T' : null;
    if (!modelMatch) continue; // Only keep Rivians

    let trim = null;
    if (/launch edition|launch ed/i.test(text)) trim = 'Launch Edition';
    else if (/adventure/i.test(text)) trim = 'Adventure';
    else if (/explore/i.test(text)) trim = 'Explore';
    else if (/performance/i.test(text)) trim = 'Performance';

    const yearMatch = title.match(/\b(19|20)\d{2}\b/);
    const year = yearMatch ? parseInt(yearMatch[0]) : null;

    listings.push({
      listing_id: listingId,
      source: 'facebook',
      source_url: `https://www.facebook.com/marketplace/item/${listingId}/`,
      title,
      model: modelMatch,
      trim,
      year,
      asking_price: price,
      photos: photo ? [photo] : [],
      mileage,
      location: location || null,
      extracted_at: new Date().toISOString(),
    });
  }
  return listings;
}

function showResults(vehicles, ingested, skipped) {
  const el = $('results');
  el.classList.add('show');

  const withPrice = vehicles.filter(v => v.buy_now || v.asking_price).length;
  const withMMR = vehicles.filter(v => v.mmr).length;
  const models = {};
  vehicles.forEach(v => { const m = v.model || 'Unknown'; models[m] = (models[m] || 0) + 1; });

  let statsHtml = `
    <div class="stat-row"><span class="stat-label">Found on page</span><span class="stat-val">${vehicles.length}</span></div>
    <div class="stat-row"><span class="stat-label">Saved to Rivian Watch</span><span class="stat-val green">${ingested}</span></div>
  `;
  if (skipped) statsHtml += `<div class="stat-row"><span class="stat-label">Filtered out (parts/junk)</span><span class="stat-val muted">${skipped}</span></div>`;
  if (withPrice) statsHtml += `<div class="stat-row"><span class="stat-label">With price</span><span class="stat-val">${withPrice}</span></div>`;
  if (withMMR) statsHtml += `<div class="stat-row"><span class="stat-label">With MMR</span><span class="stat-val blue">${withMMR}</span></div>`;
  Object.keys(models).sort().forEach(m => {
    statsHtml += `<div class="stat-row"><span class="stat-label">${m}</span><span class="stat-val">${models[m]}</span></div>`;
  });
  $('statsArea').innerHTML = statsHtml;

  const listEl = $('vehicleList');
  listEl.innerHTML = '';
  for (const v of vehicles.slice(0, 10)) {
    const card = document.createElement('div');
    card.className = 'vehicle-card';
    const title = [v.year, 'Rivian', v.model, v.trim].filter(Boolean).join(' ') || v.vehicle || v.vin;
    const meta = [
      v.motor ? `${v.motor}-Motor` : '',
      v.battery ? `${v.battery} Pack` : '',
      v.mileage ? `${v.mileage.toLocaleString()} mi` : '',
      v.condition_grade ? `CR ${v.condition_grade}` : '',
      v.location || '',
    ].filter(Boolean);
    card.innerHTML = `
      <div class="vc-title">${title}</div>
      <div class="vc-meta">
        ${v.buy_now || v.asking_price ? `<span class="vc-price">${fmt(v.buy_now || v.asking_price)}</span>` : ''}
        ${v.mmr ? `<span class="vc-mmr">MMR ${fmt(v.mmr)}</span>` : ''}
        ${meta.map(m => `<span>${m}</span>`).join('')}
      </div>
    `;
    listEl.appendChild(card);
  }
  if (vehicles.length > 10) {
    $('hint').textContent = `+ ${vehicles.length - 10} more — see full list in Admin → Rivian Watch`;
  } else if (ingested > 0) {
    $('hint').textContent = 'Open Admin → Rivian Watch to view all listings';
  }
}

async function ingest(serverUrl, apiKey, listings) {
  const resp = await fetch(`${serverUrl}/api/admin/rivian/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
    body: JSON.stringify({ listings }),
  });
  if (!resp.ok) throw new Error(`Server error ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

// ── Scan auction page ──
$('scanBtn').addEventListener('click', async () => {
  const serverUrl = ($('serverUrl').value || 'https://bigwaveauto.com').replace(/\/+$/, '');
  const apiKey = $('apiKey').value;
  if (!apiKey) { showStatus('Enter API key first.', 'error'); return; }

  $('scanBtn').disabled = true;
  showStatus('Scanning page for Rivians…', 'working');
  $('results').classList.remove('show');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const isAuctionPage = tab?.url && (
      tab.url.includes('manheim.com') || tab.url.includes('ove.com') ||
      tab.url.includes('adesa.com') || tab.url.includes('openlane.com')
    );
    if (!isAuctionPage) {
      showStatus('Navigate to a Manheim, OVE, or ADESA search results page first.', 'error');
      $('scanBtn').disabled = false;
      return;
    }

    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: scrapeAuctionPage });
    const allVehicles = result?.results || [];
    const rivians = allVehicles.filter(v => v.make === 'Rivian' || /rivian/i.test(v.vehicle || '') || ['R1T','R1S','R2'].includes(v.model));

    if (rivians.length === 0) {
      const diag = result?.diagnostics || {};
      showStatus(`No Rivians found. VIN nodes: ${diag.vinNodesFound || 0}, cards matched: ${diag.cardsFound || 0}. Scroll to load all cards then try again.`, 'error');
      $('scanBtn').disabled = false;
      return;
    }

    showStatus(`Found ${rivians.length} Rivian${rivians.length !== 1 ? 's' : ''} — saving…`, 'working');
    const result2 = await ingest(serverUrl, apiKey, rivians);
    showStatus(`✓ ${result2.ingested} saved to Rivian Watch${result2.skipped ? ` (${result2.skipped} filtered)` : ''}`, 'success');
    showResults(rivians, result2.ingested, result2.skipped || 0);

  } catch (err) {
    showStatus('Error: ' + err.message, 'error');
  }
  $('scanBtn').disabled = false;
});

// ── Scan FB Marketplace tabs ──
$('fbBtn').addEventListener('click', async () => {
  const serverUrl = ($('serverUrl').value || 'https://bigwaveauto.com').replace(/\/+$/, '');
  const apiKey = $('apiKey').value;
  if (!apiKey) { showStatus('Enter API key first.', 'error'); return; }

  $('fbBtn').disabled = true;
  showStatus('Scraping FB Marketplace tabs…', 'working');
  $('results').classList.remove('show');

  try {
    const allTabs = await chrome.tabs.query({});
    const fbTabs = allTabs.filter(t => t.url?.includes('facebook.com/marketplace'));

    if (fbTabs.length === 0) {
      showStatus('No Facebook Marketplace tabs found.', 'error');
      $('fbBtn').disabled = false;
      return;
    }

    const listings = [];
    for (const tab of fbTabs) {
      try {
        const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: fbTilesScraper });
        if (result?.length) listings.push(...result);
      } catch (e) { console.warn('Tab scrape failed:', tab.url, e); }
    }

    // Deduplicate by source_url
    const seen = new Set();
    const unique = listings.filter(l => { if (seen.has(l.source_url)) return false; seen.add(l.source_url); return true; });

    if (unique.length === 0) {
      showStatus('No Rivian listings found in those tabs. Make sure FB Marketplace search results are visible.', 'error');
      $('fbBtn').disabled = false;
      return;
    }

    showStatus(`Found ${unique.length} Rivian tile${unique.length !== 1 ? 's' : ''} — saving…`, 'working');
    const result = await ingest(serverUrl, apiKey, unique);
    showStatus(`✓ ${result.ingested} saved to Rivian Watch${result.skipped ? ` (${result.skipped} filtered)` : ''}`, 'success');
    showResults(unique, result.ingested, result.skipped || 0);

  } catch (err) {
    showStatus('Error: ' + err.message, 'error');
  }
  $('fbBtn').disabled = false;
});
