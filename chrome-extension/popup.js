// Big Wave Auto — Popup
// Reads scan data cached by the content script via chrome.storage.local

const $ = (s) => document.getElementById(s);

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
    $('photoCount').textContent = `${data.photos.length} photos`;
    $('photosPreview').innerHTML = data.photos.slice(0, 20).map(url => `<img src="${url}" />`).join('');
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

    if (!tab?.url?.includes('manheim.com') && !tab?.url?.includes('insightcr')) {
      showStatus('Navigate to a Manheim listing first.', 'error');
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
    const vinMatch = tab.url.match(/[#/]([A-HJ-NPR-Z0-9]{17})(?:[/?#]|$)/i) ||
                     tab.url.match(/\/(?:details|vehicle|cr|listing)\/([A-HJ-NPR-Z0-9]{17})/i);
    const vin = vinMatch?.[1]?.toUpperCase();

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
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.includes('manheim.com') && !tab?.url?.includes('insightcr')) return;

    const vinMatch = tab.url.match(/[#/]([A-HJ-NPR-Z0-9]{17})(?:[/?#]|$)/i) ||
                     tab.url.match(/\/(?:details|vehicle|cr|listing)\/([A-HJ-NPR-Z0-9]{17})/i);
    const vin = vinMatch?.[1]?.toUpperCase();
    const storageKey = vin ? `bwa_scan_${vin}` : 'bwa_last_scan';
    const stored = await chrome.storage.local.get([storageKey, 'bwa_last_scan']);
    const data = stored[storageKey] || stored['bwa_last_scan'];
    if (data?.vin) displayData(data);
  } catch (e) {}
})();

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
    const payload = { ...extractedData };
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

    await response.json();
    showStatus('Submitted! Open admin to edit.', 'success');
    $('submitBtn').textContent = 'Submitted ✓';

  } catch (err) {
    showStatus('Failed: ' + err.message, 'error');
    $('submitBtn').disabled = false;
  }
});
