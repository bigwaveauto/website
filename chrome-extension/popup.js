// Big Wave Auto — Popup
// Reads scan data cached by the content script via chrome.storage.local

const $ = (s) => document.getElementById(s);

function isSupportedUrl(url) {
  if (!url) return false;
  return url.includes('manheim.com') || url.includes('insightcr') ||
         url.includes('adesa.com') || url.includes('openlane.com') ||
         isFbMarketplaceItem(url);
}

function isFbMarketplaceItem(url) {
  return !!(url && url.includes('facebook.com/marketplace/item/'));
}

function vinCheckDigitValid(vin) {
  const v = String(vin).toUpperCase();
  if (v.length !== 17) return false;
  const map = {A:1,B:2,C:3,D:4,E:5,F:6,G:7,H:8,J:1,K:2,L:3,M:4,N:5,P:7,R:9,S:2,T:3,U:4,V:5,W:6,X:7,Y:8,Z:9};
  const weights = [8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2];
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const c = v[i];
    const val = isNaN(c) ? (map[c] || 0) : parseInt(c);
    sum += val * weights[i];
  }
  const rem = sum % 11;
  return v[8] === (rem === 10 ? 'X' : String(rem));
}

function vinFromUrl(url) {
  if (!url) return null;
  const patterns = [
    /[#/]([A-HJ-NPR-Z0-9]{17})(?:[/?#]|$)/i,
    /\/(?:details|vehicle|cr|listing|vin)\/([A-HJ-NPR-Z0-9]{17})/i,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m && vinCheckDigitValid(m[1])) return m[1].toUpperCase();
  }
  return null;
}

let extractedData = null;
let selectedCustomer = null; // { name, id } or { name } for new

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

function displayData(data) {
  if (!data) return;
  extractedData = data;

  // VIN
  if (data.vin) {
    $('vinSection').style.display = 'block';
    $('vinValue').textContent = data.vin;
  }

  // Vehicle info
  const v = data.vehicle || {};
  const hasVehicle = v.year || v.make || v.model || v.mileage;
  if (hasVehicle) {
    let html = '';
    if (v.year || v.make || v.model) {
      html += `<div class="vi-title">${[v.year, v.make, v.model, v.trim].filter(Boolean).join(' ')}</div>`;
    }
    const fields = [
      ['Mileage', v.mileage ? Number(v.mileage).toLocaleString() + ' mi' : null],
      ['Exterior', v.exterior_color], ['Interior', v.interior_color],
      ['Engine', v.engine], ['Transmission', v.transmission],
      ['Drivetrain', v.drivetrain], ['Fuel', v.fuel],
      ['Body', v.body], ['Grade', v.grade],
    ];
    for (const [label, val] of fields) {
      if (val) html += `<div class="vi-row"><span class="vi-label">${label}</span><span class="vi-value">${val}</span></div>`;
    }
    $('vehicleInfo').innerHTML = html;
    $('vehicleInfo').style.display = 'block';
  }

  // Auction data
  if (data.auction) {
    const a = data.auction;
    let html = `<div class="vi-title">${a.channel || 'Auction'}</div>`;
    if (a.buy_now) html += `<div class="vi-row"><span class="vi-label">Buy Now</span><span class="vi-value" style="color:#16a34a;font-size:16px">$${a.buy_now.toLocaleString()}</span></div>`;
    if (a.current_bid) html += `<div class="vi-row"><span class="vi-label">Current Bid</span><span class="vi-value">$${a.current_bid.toLocaleString()}</span></div>`;
    if (a.starting_bid) html += `<div class="vi-row"><span class="vi-label">Starting Bid</span><span class="vi-value">$${a.starting_bid.toLocaleString()}</span></div>`;
    if (a.mmr) html += `<div class="vi-row"><span class="vi-label">MMR</span><span class="vi-value" style="color:#2563eb">$${a.mmr.toLocaleString()}</span></div>`;
    if (a.sale_date) html += `<div class="vi-row"><span class="vi-label">Sale Date</span><span class="vi-value">${a.sale_date}</span></div>`;
    if (a.lane) html += `<div class="vi-row"><span class="vi-label">Lane</span><span class="vi-value">${a.lane}</span></div>`;
    $('auctionInfo').innerHTML = html;
    $('auctionInfo').style.display = 'block';

    // Show MMR push button if MMR was found
    if (a.mmr) {
      $('mmrBtn').style.display = 'flex';
      $('mmrBtn').textContent = `🌊 Send MMR $${a.mmr.toLocaleString()} to Appraisal`;
    }
  }

  // Condition summary
  const cr = data.condition || {};
  const parts = [];
  if (cr.damage?.length) parts.push(`<b>${cr.damage.length}</b> damage notes`);
  if (cr.options?.length) parts.push(`<b>${cr.options.length}</b> options`);
  if (cr.announcements?.length) parts.push(`<b>${cr.announcements.length}</b> announcements`);
  if (parts.length) {
    $('scanSummary').innerHTML = 'Extracted: ' + parts.join(' · ');
    $('scanSummary').style.display = 'block';
  }

  // Photos
  if (data.photos?.length) {
    const isAdesa = data.page_type === 'adesa_listing' || data.page_type === 'openlane_listing';
    const supabaseHost = 'supabase.co';
    const photosUploaded = data.photos.every(p => p.includes(supabaseHost));
    $('photoCount').textContent = `${data.photos.length} photos`;
    if (isAdesa && !photosUploaded) {
      $('photosPreview').innerHTML = '<span style="color:#94a3b8;font-size:11px">Uploading photos to server… will update when done.</span>';
    } else {
      $('photosPreview').innerHTML = data.photos.slice(0, 20).map(url => `<img src="${url}" />`).join('');
    }
    $('photosSection').style.display = 'block';
  }

  $('submitBtn').style.display = 'flex';
  $('customerSection').style.display = 'block';
  const ago = data.extracted_at ? Math.round((Date.now() - new Date(data.extracted_at)) / 1000) : 0;
  showStatus(`Ready — captured ${ago}s ago`, 'success');
}

// ── Customer Search ──
let customerSearchTimer = null;

async function searchCustomers(query) {
  const serverUrl = ($('serverUrl').value || 'https://bigwaveauto.com').replace(/\/+$/, '');
  const apiKey = $('apiKey').value;
  if (!apiKey) return [];
  try {
    const res = await fetch(`${serverUrl}/api/admin/customers/search?q=${encodeURIComponent(query)}`, {
      headers: { 'X-API-Key': apiKey },
    });
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

function setCustomer(customer) {
  selectedCustomer = customer;
  $('customerBadgeName').textContent = customer.name;
  $('customerBadge').style.display = 'block';
  $('customerInputWrap').style.display = 'none';
  $('customerDropdown').classList.remove('open');
}

function clearCustomer() {
  selectedCustomer = null;
  $('customerBadge').style.display = 'none';
  $('customerInputWrap').style.display = 'block';
  $('customerInput').value = '';
  $('customerDropdown').classList.remove('open');
}

$('clearCustomer').addEventListener('click', clearCustomer);

$('customerInput').addEventListener('input', () => {
  const val = $('customerInput').value.trim();
  clearTimeout(customerSearchTimer);
  if (!val) { $('customerDropdown').classList.remove('open'); return; }

  customerSearchTimer = setTimeout(async () => {
    const results = await searchCustomers(val);
    const dd = $('customerDropdown');
    dd.innerHTML = '';

    // Existing customers
    for (const c of results) {
      const div = document.createElement('div');
      div.className = 'customer-option';
      div.textContent = c.name + (c.phone ? ` · ${c.phone}` : '');
      div.addEventListener('mousedown', () => setCustomer(c));
      dd.appendChild(div);
    }

    // Always show "New: [typed name]" option
    const newOpt = document.createElement('div');
    newOpt.className = 'customer-option new-customer';
    newOpt.textContent = `+ New: "${val}"`;
    newOpt.addEventListener('mousedown', () => setCustomer({ name: val, id: null }));
    dd.appendChild(newOpt);

    dd.classList.add('open');
  }, 300);
});

$('customerInput').addEventListener('blur', () => {
  setTimeout(() => $('customerDropdown').classList.remove('open'), 150);
});

// ── Scan: request content script to re-extract, then read from storage ──
$('scanBtn').addEventListener('click', async () => {
  showStatus('Scanning...', 'working');
  $('scanBtn').disabled = true;
  $('submitBtn').style.display = 'none';
  $('vinSection').style.display = 'none';
  $('vehicleInfo').style.display = 'none';
  $('auctionInfo').style.display = 'none';
  $('scanSummary').style.display = 'none';
  $('photosSection').style.display = 'none';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!isSupportedUrl(tab?.url)) {
      const isFb = tab?.url?.includes('facebook.com');
      if (isFb) {
        showStatus('Open a specific Facebook Marketplace listing (facebook.com/marketplace/item/…), then use Import FB Listing — or use the batch button if you have multiple item tabs open.', 'error');
      } else {
        showStatus('Navigate to a Manheim or ADESA/OpenLane listing first.', 'error');
      }
      $('scanBtn').disabled = false;
      return;
    }

    // Ask content script to re-scan now
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'rescan' });
    } catch (e) {
      // Content script might not be injected yet — inject it
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await new Promise(r => setTimeout(r, 300));
      await chrome.tabs.sendMessage(tab.id, { action: 'rescan' }).catch(() => {});
    }

    // Wait for extraction to complete (content script caches in storage)
    await new Promise(r => setTimeout(r, 1200));

    // Read from storage — keyed by VIN extracted from URL, or fall back to last scan
    const vin = vinFromUrl(tab.url);
    const storageKey = vin ? `bwa_scan_${vin}` : 'bwa_last_scan';
    const stored = await chrome.storage.local.get([storageKey, 'bwa_last_scan']);
    const data = stored[storageKey] || stored['bwa_last_scan'];

    if (!data?.vin) {
      showStatus('Nothing captured yet — page may still be loading. Try again in a moment.', 'error');
      $('scanBtn').disabled = false;
      return;
    }

    displayData(data);

  } catch (err) {
    showStatus('Scan failed: ' + err.message, 'error');
  }

  $('scanBtn').disabled = false;
});

// ── Listen for real-time push from content script ──
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'scanReady' && msg.data) {
    displayData(msg.data);
  }
});

// On popup open — auto-load last cached scan for current tab
(async () => {
  try {
    const [[tab], allTabs] = await Promise.all([
      chrome.tabs.query({ active: true, currentWindow: true }),
      chrome.tabs.query({}),
    ]);

    // Show batch/rivian buttons whenever FB marketplace tabs are open (any page)
    const fbTabs = allTabs.filter(t => isFbMarketplaceItem(t.url));
    if (fbTabs.length > 0) {
      $('fbBatchBtn').style.display = 'flex';
      $('fbBatchBtn').textContent = `📘 Import All ${fbTabs.length} FB Tab${fbTabs.length !== 1 ? 's' : ''} → Proposals`;
      $('fbRivianBtn').style.display = 'flex';
      $('fbRivianBtn').textContent = `🌿 Scan ${fbTabs.length} FB Tab${fbTabs.length !== 1 ? 's' : ''} → Rivian Watch`;
    }

    // Show tile scraper buttons on any FB marketplace browse/search/category page
    const isFbBrowse = tab?.url?.includes('facebook.com/marketplace') && !isFbMarketplaceItem(tab?.url);
    if (isFbBrowse) {
      $('scanBtn').style.display = 'none';
      $('fbTilesBtn').style.display = 'flex';
      $('fbRivianTilesBtn').style.display = 'flex';
    }

    if (!isSupportedUrl(tab?.url) && !isFbBrowse) return;

    const vinMatch = tab.url.match(/[#/]([A-HJ-NPR-Z0-9]{17})(?:[/?#]|$)/i) ||
                     tab.url.match(/\/(?:details|vehicle|cr|listing)\/([A-HJ-NPR-Z0-9]{17})/i);
    const vin = vinMatch?.[1]?.toUpperCase();
    const storageKey = vin ? `bwa_scan_${vin}` : 'bwa_last_scan';
    const stored = await chrome.storage.local.get([storageKey, 'bwa_last_scan', 'bwa_list_scan']);
    const data = stored[storageKey] || stored['bwa_last_scan'];
    if (data?.vin) displayData(data);

    // Show Rivian bulk scan button on Manheim pages without a VIN in URL
    const isManheimList = tab.url?.includes('manheim.com') && !vin;
    if (isManheimList) {
      $('rivianScanBtn').style.display = 'flex';
      if (stored.bwa_list_scan?.listings?.length) {
        $('rivianScanBtn').textContent = `🌿 ${stored.bwa_list_scan.listings.length} listings cached — Ingest Now`;
      }
    }

    // Show FB import button on Facebook Marketplace item pages
    if (isFbMarketplaceItem(tab.url)) {
      $('scanBtn').style.display = 'none';
      $('fbImportBtn').style.display = 'flex';
    }
  } catch (e) {}
})();

// ── Rivian Bulk Scan ──
$('rivianScanBtn').addEventListener('click', async () => {
  const serverUrl = ($('serverUrl').value || 'https://bigwaveauto.com').replace(/\/+$/, '');
  const apiKey = $('apiKey').value;

  if (!apiKey) { showStatus('Enter API key first.', 'error'); return; }

  $('rivianScanBtn').disabled = true;
  showStatus('Scanning page for listings...', 'working');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Ask content script to do bulk scan
    let listings = [];
    try {
      const resp = await chrome.tabs.sendMessage(tab.id, { action: 'bulkScan' });
      listings = resp?.listings || [];
    } catch (e) {
      // Inject content script if not loaded
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await new Promise(r => setTimeout(r, 600));
      const resp = await chrome.tabs.sendMessage(tab.id, { action: 'bulkScan' }).catch(() => ({}));
      listings = resp?.listings || [];
    }

    if (!listings.length) {
      showStatus('No listings found — make sure you\'re on a Manheim search results page.', 'error');
      $('rivianScanBtn').disabled = false;
      return;
    }

    showStatus(`Found ${listings.length} listings — ingesting to admin...`, 'working');

    const response = await fetch(`${serverUrl}/api/admin/rivian/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify({ listings }),
    });

    if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
    const result = await response.json();

    $('rivianScanBtn').textContent = `✓ ${result.ingested || listings.length} ingested`;
    $('rivianScanBtn').style.background = '#16a34a';
    showStatus(`Ingested ${result.ingested || listings.length} Rivian listings into admin.`, 'success');

    // Open admin Rivians tab
    const allTabs = await chrome.tabs.query({});
    const adminTab = allTabs.find(t => t.url && t.url.includes('/admin/rivians'));
    if (adminTab) {
      await chrome.tabs.update(adminTab.id, { active: true });
      await chrome.tabs.reload(adminTab.id);
    } else {
      await chrome.tabs.create({ url: `${serverUrl}/admin/rivians`, active: true });
    }
  } catch (err) {
    showStatus('Ingest failed: ' + err.message, 'error');
    $('rivianScanBtn').disabled = false;
  }
});

// ── Send MMR to Appraisal Tab ──
$('mmrBtn').addEventListener('click', async () => {
  if (!extractedData?.auction?.mmr) { showStatus('No MMR found on this page.', 'error'); return; }
  const mmr = extractedData.auction.mmr;
  const vin = extractedData.vin;
  const serverUrl = ($('serverUrl').value || 'https://bigwaveauto.com').replace(/\/+$/, '');

  try {
    // Find the appraisal tab
    const allTabs = await chrome.tabs.query({});
    const appraisalTab = allTabs.find(t => t.url && (t.url.includes(serverUrl) || t.url.includes('bigwaveauto.com')) && t.url.includes('/admin/appraisal'));

    if (!appraisalTab) {
      // Open appraisal tab
      const tab = await chrome.tabs.create({ url: `${serverUrl}/admin/appraisal`, active: true });
      // Wait for tab to load then push
      await new Promise(r => setTimeout(r, 3000));
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (mmrVal, vinVal) => {
          localStorage.setItem('bwa_mmr_push', JSON.stringify({ mmr: mmrVal, vin: vinVal, ts: Date.now() }));
          window.dispatchEvent(new StorageEvent('storage', { key: 'bwa_mmr_push', newValue: JSON.stringify({ mmr: mmrVal, vin: vinVal, ts: Date.now() }) }));
        },
        args: [mmr, vin],
      });
    } else {
      // Push to existing tab
      await chrome.scripting.executeScript({
        target: { tabId: appraisalTab.id },
        func: (mmrVal, vinVal) => {
          localStorage.setItem('bwa_mmr_push', JSON.stringify({ mmr: mmrVal, vin: vinVal, ts: Date.now() }));
          window.dispatchEvent(new StorageEvent('storage', { key: 'bwa_mmr_push', newValue: JSON.stringify({ mmr: mmrVal, vin: vinVal, ts: Date.now() }) }));
        },
        args: [mmr, vin],
      });
      await chrome.tabs.update(appraisalTab.id, { active: true });
    }

    $('mmrBtn').textContent = '✓ MMR Sent!';
    $('mmrBtn').style.background = '#16a34a';
    showStatus(`MMR $${mmr.toLocaleString()} sent to appraisal tool.`, 'success');
  } catch (err) {
    showStatus('Failed to send MMR: ' + err.message, 'error');
  }
});

// ── Shared FB Marketplace scraper (injected into page context via executeScript) ──
function fbPageScraper() {
  function vinOk(vin) {
    const v = String(vin).toUpperCase();
    if (v.length !== 17) return false;
    const map = {A:1,B:2,C:3,D:4,E:5,F:6,G:7,H:8,J:1,K:2,L:3,M:4,N:5,P:7,R:9,S:2,T:3,U:4,V:5,W:6,X:7,Y:8,Z:9};
    const weights = [8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2];
    let sum = 0;
    for (let i = 0; i < 17; i++) {
      const c = v[i];
      sum += (isNaN(c) ? (map[c] || 0) : parseInt(c)) * weights[i];
    }
    const rem = sum % 11;
    return v[8] === (rem === 10 ? 'X' : String(rem));
  }

  const url = window.location.href;
  const listingIdMatch = url.match(/marketplace\/item\/(\d+)/);
  const listingId = listingIdMatch?.[1] || String(Date.now());

  let title = document.querySelector('meta[property="og:title"]')?.content || '';
  let description = '';
  let price = null;
  const photos = [];
  const seen = new Set();

  const ogImg = document.querySelector('meta[property="og:image"]')?.content || '';
  if (ogImg && !seen.has(ogImg)) { photos.push(ogImg); seen.add(ogImg); }

  for (const s of document.querySelectorAll('script')) {
    const text = s.textContent || '';
    if (!text.includes('scontent') || text.length < 200) continue;

    const matches = [...text.matchAll(/"uri"\s*:\s*"(https:\\?\/\\?\/scontent[^"\\]*(?:\\.[^"\\]*)*)"/g)];
    for (const m of matches) {
      const imgUrl = m[1].replace(/\\u002F/g, '/').replace(/\\n/g, '').replace(/\\/g, '');
      if (!seen.has(imgUrl) && photos.length < 30) { photos.push(imgUrl); seen.add(imgUrl); }
    }

    if (!description) {
      const dm = text.match(/"description"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (dm && dm[1].length > 20) description = dm[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\/g, '');
    }

    if (!price) {
      const pm = text.match(/"formatted_amount"\s*:\s*"\$?([\d,]+)"/);
      if (pm) price = parseInt(pm[1].replace(/,/g, ''));
    }
    if (!price) {
      const pm2 = text.match(/"amount"\s*:\s*"(\d+)"/);
      if (pm2) {
        const raw = parseInt(pm2[1]);
        price = raw > 100000 ? Math.round(raw / 100) : raw;
      }
    }

    if (!title) {
      const tm = text.match(/"marketplace_listing_item"[^{]*\{[^}]*"name"\s*:\s*"([^"]+)"/);
      if (tm) title = tm[1];
    }
  }

  if (photos.length <= 1) {
    for (const img of document.querySelectorAll('img')) {
      const src = img.src || '';
      if (!src.includes('scontent') || seen.has(src)) continue;
      if ((img.naturalWidth || img.width) >= 200) {
        photos.push(src); seen.add(src);
        if (photos.length >= 20) break;
      }
    }
  }

  let vin = null;
  const textToSearch = title + ' ' + description;
  const vinMatches = [...textToSearch.matchAll(/\b([A-HJ-NPR-Z0-9]{17})\b/gi)];
  for (const m of vinMatches) {
    if (vinOk(m[1])) { vin = m[1].toUpperCase(); break; }
  }

  const yearMatch = title.match(/\b(19[89]\d|20[012]\d)\b/);
  const year = yearMatch?.[0] || null;

  const mileMatch = (description + ' ' + title).match(/(\d[\d,]*)\s*(?:miles?|mi(?:\b|$))/i);
  const mileage = mileMatch ? parseInt(mileMatch[1].replace(/,/g, '')) : null;

  return { listing_id: listingId, source: 'facebook', source_url: url, title, price, description, photos, vin, year, mileage, extracted_at: new Date().toISOString() };
}

// ── Facebook Marketplace Import (single tab) ──
$('fbImportBtn').addEventListener('click', async () => {
  const serverUrl = ($('serverUrl').value || 'https://bigwaveauto.com').replace(/\/+$/, '');
  const apiKey = $('apiKey').value;
  if (!apiKey) { showStatus('Enter API key first.', 'error'); return; }

  $('fbImportBtn').disabled = true;
  showStatus('Scraping Facebook listing...', 'working');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: fbPageScraper });

    const fbData = results[0]?.result;
    if (!fbData) throw new Error('Scrape returned no data — try reloading the FB page first');
    if (!fbData.photos.length) throw new Error('No photos found — make sure you\'re on a Marketplace item page (not a search result)');

    showStatus(`Found ${fbData.photos.length} photo(s) — uploading to server...`, 'working');

    const resp = await fetch(`${serverUrl}/api/ext/fb-proposal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify(fbData),
    });

    if (!resp.ok) throw new Error(`Server error ${resp.status}: ${await resp.text()}`);
    const result = await resp.json();

    $('fbImportBtn').textContent = '✓ Imported!';
    $('fbImportBtn').style.background = '#16a34a';
    showStatus(`Proposal created — ${result.photos ?? fbData.photos.length} photos imported.`, 'success');

    const adminUrl = result.id ? `${serverUrl}/admin/proposals?open=${result.id}` : `${serverUrl}/admin/proposals`;
    const allTabs = await chrome.tabs.query({});
    const adminTab = allTabs.find(t => t.url?.includes('/admin/proposals'));
    if (adminTab) {
      await chrome.tabs.update(adminTab.id, { active: true, url: adminUrl });
    } else {
      await chrome.tabs.create({ url: adminUrl, active: true });
    }
  } catch (err) {
    showStatus('Import failed: ' + err.message, 'error');
    $('fbImportBtn').disabled = false;
  }
});

// ── Facebook Marketplace Batch Import (all open FB tabs) ──
$('fbBatchBtn').addEventListener('click', async () => {
  const serverUrl = ($('serverUrl').value || 'https://bigwaveauto.com').replace(/\/+$/, '');
  const apiKey = $('apiKey').value;
  if (!apiKey) { showStatus('Enter API key first.', 'error'); return; }

  $('fbBatchBtn').disabled = true;

  const allTabs = await chrome.tabs.query({});
  const fbTabs = allTabs.filter(t => isFbMarketplaceItem(t.url));

  if (!fbTabs.length) {
    showStatus('No Facebook Marketplace listing tabs are open.', 'error');
    $('fbBatchBtn').disabled = false;
    return;
  }

  // Scrape each tab
  const scraped = [];
  for (let i = 0; i < fbTabs.length; i++) {
    const tab = fbTabs[i];
    showStatus(`Scraping tab ${i + 1} of ${fbTabs.length}...`, 'working');
    try {
      const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: fbPageScraper });
      const data = results[0]?.result;
      if (data?.photos?.length) scraped.push(data);
    } catch (e) {
      // Skip tabs that can't be scraped (not loaded, wrong page, etc.)
    }
  }

  if (!scraped.length) {
    showStatus('No data scraped — make sure all tabs are fully loaded FB Marketplace item pages.', 'error');
    $('fbBatchBtn').disabled = false;
    return;
  }

  // Submit each to server sequentially
  let submitted = 0;
  let lastId = null;
  for (let i = 0; i < scraped.length; i++) {
    showStatus(`Uploading ${i + 1} of ${scraped.length}...`, 'working');
    try {
      const resp = await fetch(`${serverUrl}/api/ext/fb-proposal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
        body: JSON.stringify(scraped[i]),
      });
      if (resp.ok) {
        const result = await resp.json();
        submitted++;
        if (result.id) lastId = result.id;
      }
    } catch (e) {}
  }

  $('fbBatchBtn').textContent = `✓ ${submitted} of ${fbTabs.length} imported`;
  $('fbBatchBtn').style.background = '#16a34a';
  showStatus(`Done! ${submitted} proposal${submitted !== 1 ? 's' : ''} created from ${fbTabs.length} tabs.`, 'success');

  const adminUrl = `${serverUrl}/admin/proposals`;
  const adminTab = allTabs.find(t => t.url?.includes('/admin/proposals'));
  if (adminTab) {
    await chrome.tabs.update(adminTab.id, { active: true, url: adminUrl });
    await chrome.tabs.reload(adminTab.id);
  } else {
    await chrome.tabs.create({ url: adminUrl, active: true });
  }
});

// ── Rivian spec parser — runs on already-scraped FB listing data ──
function parseRivianSpecs(data) {
  const text = `${data.title || ''} ${data.description || ''}`;
  const model = /r1s/i.test(text) ? 'R1S' : /r1t/i.test(text) ? 'R1T' : null;
  let trim = null;
  if (/launch edition|launch ed/i.test(text)) trim = 'Launch Edition';
  else if (/adventure/i.test(text)) trim = 'Adventure';
  else if (/explore/i.test(text)) trim = 'Explore';
  else if (/performance/i.test(text)) trim = 'Performance';
  let battery = null;
  if (/max pack|max range/i.test(text)) battery = 'Max';
  else if (/large pack|extended range|180\s*k/i.test(text)) battery = 'Large';
  else if (/standard pack|standard range|135\s*k/i.test(text)) battery = 'Standard';
  let drive = null;
  if (/quad.motor|quad motor/i.test(text)) drive = 'Quad-Motor';
  else if (/dual.motor|dual motor|awd/i.test(text)) drive = 'Dual-Motor AWD';
  const colorMap = [
    ['Forest Green', /forest green/i], ['Limestone', /limestone/i],
    ['Glacier White', /glacier white/i], ['El Cap Granite', /el cap granite/i],
    ['Rivian Blue', /rivian blue/i], ['Launch Green', /launch green/i],
    ['Red Canyon', /red canyon/i], ['Midnight', /midnight/i],
    ['Neptune', /neptune/i], ['Compass Yellow', /compass yellow/i],
  ];
  let exterior_color = data.exterior_color || null;
  if (!exterior_color) {
    for (const [name, re] of colorMap) { if (re.test(text)) { exterior_color = name; break; } }
  }
  const interiorMap = [
    ['Forest Edge', /forest edge/i], ['Dark Ash Wood', /dark ash/i],
    ['Ocean Coast', /ocean coast/i], ['Black Mountain', /black mountain/i],
  ];
  let interior_color = null;
  for (const [name, re] of interiorMap) { if (re.test(text)) { interior_color = name; break; } }
  return { model, trim, battery, drive, exterior_color, interior_color };
}

// ── FB Tabs → Rivian Watch ──
$('fbRivianBtn').addEventListener('click', async () => {
  const serverUrl = ($('serverUrl').value || 'https://bigwaveauto.com').replace(/\/+$/, '');
  const apiKey = $('apiKey').value;
  if (!apiKey) { showStatus('Enter API key first.', 'error'); return; }

  $('fbRivianBtn').disabled = true;
  showStatus('Scanning FB tabs for Rivian data…', 'working');

  try {
    const allTabs = await chrome.tabs.query({});
    const fbTabs = allTabs.filter(t => isFbMarketplaceItem(t.url));
    if (!fbTabs.length) { showStatus('No FB Marketplace item tabs open.', 'error'); $('fbRivianBtn').disabled = false; return; }

    const scraped = [];
    for (const tab of fbTabs) {
      try {
        const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: fbPageScraper });
        if (result?.title) scraped.push(result);
      } catch (e) {}
    }

    if (!scraped.length) { showStatus('Could not scrape any tabs — make sure pages are fully loaded.', 'error'); $('fbRivianBtn').disabled = false; return; }

    showStatus(`Scraped ${scraped.length} listings — saving to Rivian Watch…`, 'working');

    const listings = scraped.map(d => {
      const specs = parseRivianSpecs(d);
      return {
        source: 'facebook',
        source_url: d.source_url,
        listing_id: d.listing_id,
        vin: d.vin || null,
        year: d.year ? parseInt(d.year) : specs.model ? 2022 : null,
        model: specs.model,
        trim: specs.trim,
        battery: specs.battery,
        drive_config: specs.drive,
        exterior_color: specs.exterior_color,
        interior_color: specs.interior_color,
        mileage: d.mileage || null,
        asking_price: d.price || null,
        photos: d.photos || [],
        description: d.description || '',
        location: d.location || null,
      };
    });

    const resp = await fetch(`${serverUrl}/api/admin/rivian/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify({ listings }),
    });
    if (!resp.ok) throw new Error(await resp.text());
    const result = await resp.json();

    $('fbRivianBtn').textContent = `✓ ${result.ingested} saved`;
    $('fbRivianBtn').style.background = '#16a34a';
    showStatus(`${result.ingested} Rivian listing${result.ingested !== 1 ? 's' : ''} added to Rivian Watch.`, 'success');

    const allOpenTabs = await chrome.tabs.query({});
    const adminTab = allOpenTabs.find(t => t.url?.includes('/admin/rivians'));
    const adminUrl = `${serverUrl}/admin/rivians`;
    if (adminTab) { await chrome.tabs.update(adminTab.id, { active: true, url: adminUrl }); }
    else { await chrome.tabs.create({ url: adminUrl, active: true }); }
  } catch (err) {
    showStatus('Failed: ' + err.message, 'error');
    $('fbRivianBtn').disabled = false;
  }
});

// ── Facebook Marketplace Tile Scraper (injected into the browse/search page) ──
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

    // Collect leaf-node text spans — FB tiles have price, title, mileage as separate spans
    const spans = [...link.querySelectorAll('span')]
      .map(s => s.childElementCount === 0 ? s.textContent.trim() : '')
      .filter(t => t.length > 1 && t.length < 120);

    const priceText = spans.find(t => /^\$[\d,]+/.test(t)) || '';
    const price = priceText ? parseInt(priceText.replace(/\D/g, '')) : null;
    const title = spans.find(t => /\b(19|20)\d{2}\b/.test(t)) || spans[0] || '';
    const mileageText = spans.find(t => /[\d,]+\s*miles?/i.test(t)) || '';
    const mileage = mileageText ? parseInt(mileageText.replace(/\D/g, '')) : null;
    const location = spans.find(t => t !== priceText && t !== title && t !== mileageText && t.length > 2) || '';

    listings.push({
      listing_id: listingId,
      source: 'facebook',
      source_url: `https://www.facebook.com/marketplace/item/${listingId}/`,
      title,
      price,
      photos: photo ? [photo] : [],
      mileage,
      location,
      extracted_at: new Date().toISOString(),
    });
  }
  return listings;
}

$('fbTilesBtn').addEventListener('click', async () => {
  const serverUrl = ($('serverUrl').value || 'https://bigwaveauto.com').replace(/\/+$/, '');
  const apiKey = $('apiKey').value;
  if (!apiKey) { showStatus('Enter API key first.', 'error'); return; }

  $('fbTilesBtn').disabled = true;
  showStatus('Scraping visible listings...', 'working');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [{ result: listings }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: fbTilesScraper,
    });

    if (!listings?.length) {
      showStatus('No listings found — scroll down to load tiles then try again.', 'error');
      $('fbTilesBtn').disabled = false;
      return;
    }

    showStatus(`Found ${listings.length} listings — importing...`, 'working');

    let imported = 0;
    let lastId = null;
    for (const listing of listings) {
      try {
        const resp = await fetch(`${serverUrl}/api/ext/fb-proposal`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
          body: JSON.stringify(listing),
        });
        if (resp.ok) {
          const result = await resp.json();
          imported++;
          if (result.id) lastId = result.id;
        }
      } catch (e) {}
    }

    $('fbTilesBtn').textContent = `✓ ${imported} of ${listings.length} imported`;
    $('fbTilesBtn').style.background = '#16a34a';
    showStatus(`Done! ${imported} proposal${imported !== 1 ? 's' : ''} created.`, 'success');

    const adminBase = `${serverUrl}/admin/proposals`;
    const adminUrl = lastId ? `${adminBase}?open=${lastId}` : adminBase;
    const allTabs = await chrome.tabs.query({});
    const adminTab = allTabs.find(t => t.url?.includes('/admin/proposals'));
    if (adminTab) {
      await chrome.tabs.update(adminTab.id, { active: true, url: adminUrl });
    } else {
      await chrome.tabs.create({ url: adminUrl, active: true });
    }
  } catch (err) {
    showStatus('Failed: ' + err.message, 'error');
    $('fbTilesBtn').disabled = false;
  }
});

// ── FB Tiles → Rivian Watch ──
$('fbRivianTilesBtn').addEventListener('click', async () => {
  const serverUrl = ($('serverUrl').value || 'https://bigwaveauto.com').replace(/\/+$/, '');
  const apiKey = $('apiKey').value;
  if (!apiKey) { showStatus('Enter API key first.', 'error'); return; }

  $('fbRivianTilesBtn').disabled = true;
  showStatus('Scanning visible listings for Rivian data…', 'working');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [{ result: tiles }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: fbTilesScraper,
    });

    if (!tiles?.length) {
      showStatus('No listings found — scroll to load tiles then try again.', 'error');
      $('fbRivianTilesBtn').disabled = false;
      return;
    }

    showStatus(`Found ${tiles.length} listings — saving to Rivian Watch…`, 'working');

    const listings = tiles.map(d => {
      const specs = parseRivianSpecs(d);
      return {
        source: 'facebook',
        source_url: d.source_url,
        listing_id: d.listing_id,
        year: d.year ? parseInt(d.year) : null,
        model: specs.model,
        trim: specs.trim,
        battery: specs.battery,
        drive_config: specs.drive,
        exterior_color: specs.exterior_color,
        interior_color: specs.interior_color,
        mileage: d.mileage || null,
        asking_price: d.price || null,
        photos: d.photos || [],
        description: d.title || '',
        location: d.location || null,
      };
    });

    const resp = await fetch(`${serverUrl}/api/admin/rivian/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify({ listings }),
    });
    if (!resp.ok) throw new Error(await resp.text());
    const result = await resp.json();

    $('fbRivianTilesBtn').textContent = `✓ ${result.ingested} saved`;
    $('fbRivianTilesBtn').style.background = '#16a34a';
    showStatus(`${result.ingested} listing${result.ingested !== 1 ? 's' : ''} added to Rivian Watch.`, 'success');

    const allTabs = await chrome.tabs.query({});
    const adminTab = allTabs.find(t => t.url?.includes('/admin/rivians'));
    const adminUrl = `${serverUrl}/admin/rivians`;
    if (adminTab) { await chrome.tabs.update(adminTab.id, { active: true, url: adminUrl }); }
    else { await chrome.tabs.create({ url: adminUrl, active: true }); }
  } catch (err) {
    showStatus('Failed: ' + err.message, 'error');
    $('fbRivianTilesBtn').disabled = false;
  }
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
    // Re-read storage so we pick up any photos uploaded by background worker after popup opened
    const vin = extractedData.vin;
    const scanKey = vin ? `bwa_scan_${vin}` : 'bwa_last_scan';
    const latest = await chrome.storage.local.get([scanKey, 'bwa_last_scan']);
    const freshData = latest[scanKey] || latest['bwa_last_scan'] || extractedData;
    // Use freshData for photos/fields, but keep extractedData as fallback
    const payload = { ...extractedData, ...freshData };
    if (selectedCustomer) {
      payload.customer_name = selectedCustomer.name;
      if (selectedCustomer.id) payload.customer_id = selectedCustomer.id;
    }

    const response = await fetch(`${serverUrl}/api/ext/proposal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify(payload),
    });

    if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);

    const result = await response.json();
    const adminBase = `${serverUrl}/admin/proposals`;
    // Include ?open=ID so the proposals page auto-selects this proposal
    const adminUrl = result.id ? `${adminBase}?open=${result.id}` : adminBase;

    if (result.merged) {
      showStatus('Proposal updated — price & deal info preserved.', 'success');
      $('submitBtn').textContent = 'Updated ✓';
    } else {
      showStatus('Submitted! Opening admin...', 'success');
      $('submitBtn').textContent = 'Submitted ✓';
    }

    // Open (or focus) the admin proposals tab — always navigate to the specific proposal
    const allTabs = await chrome.tabs.query({});
    const adminTab = allTabs.find(t => t.url && t.url.includes(adminBase));
    if (adminTab) {
      await chrome.tabs.update(adminTab.id, { active: true, url: adminUrl });
    } else {
      await chrome.tabs.create({ url: adminUrl, active: true });
    }

  } catch (err) {
    showStatus('Failed: ' + err.message, 'error');
    $('submitBtn').disabled = false;
  }
});
