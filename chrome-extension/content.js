// Big Wave Auto — Manheim Content Script
// Runs on Manheim pages, watches for React to render specs, caches extracted data.

(function () {
  'use strict';

  // ── Floating button ──
  function injectButton() {
    if (document.getElementById('bwa-grab-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'bwa-grab-btn';
    btn.textContent = '🌊 BWA';
    btn.title = 'Big Wave Auto — Open popup to scan';
    Object.assign(btn.style, {
      position: 'fixed', bottom: '20px', right: '20px', zIndex: '999999',
      padding: '10px 16px', background: '#1e293b', color: 'white',
      border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: '800',
      fontFamily: '-apple-system, sans-serif', cursor: 'pointer',
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)', transition: 'transform 0.15s, background 0.15s',
    });
    btn.addEventListener('mouseenter', () => { btn.style.transform = 'scale(1.05)'; btn.style.background = '#334155'; });
    btn.addEventListener('mouseleave', () => { btn.style.transform = 'scale(1)'; btn.style.background = '#1e293b'; });
    btn.addEventListener('click', () => { chrome.runtime.sendMessage({ action: 'openPopup' }); });
    document.body.appendChild(btn);
  }

  // ── Extraction ──

  function getVin() {
    const url = window.location.href;
    // Hash SPA: #/details/VIN/OVE
    const hashMatch = url.match(/[#/]([A-HJ-NPR-Z0-9]{17})(?:[/?#]|$)/i);
    if (hashMatch) return hashMatch[1].toUpperCase();
    // Path
    const pathMatch = url.match(/\/(?:details|vehicle|cr|listing)\/([A-HJ-NPR-Z0-9]{17})/i);
    if (pathMatch) return pathMatch[1].toUpperCase();
    // Meta tag
    const meta = document.querySelector('meta[name*="vin" i], meta[property*="vin" i]');
    if (meta?.content?.match(/^[A-HJ-NPR-Z0-9]{17}$/i)) return meta.content.toUpperCase();
    // Page text last resort
    const m = document.body.innerText.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
    if (m) return m[1].toUpperCase();
    return '';
  }

  const LABEL_MAP = {
    'odometer': 'mileage', 'mileage': 'mileage', 'miles': 'mileage',
    'exterior color': 'exterior_color', 'ext color': 'exterior_color', 'ext. color': 'exterior_color',
    'interior color': 'interior_color', 'int color': 'interior_color', 'int. color': 'interior_color',
    'engine': 'engine', 'displacement': 'engine',
    'transmission': 'transmission', 'trans': 'transmission',
    'drive type': 'drivetrain', 'drivetrain': 'drivetrain', 'drive': 'drivetrain',
    'fuel type': 'fuel', 'fuel': 'fuel',
    'body style': 'body', 'body': 'body', 'body type': 'body',
    'cylinders': 'cylinders', 'doors': 'doors',
    'condition grade': 'grade', 'cr grade': 'grade', 'grade': 'grade',
    'seller': 'seller',
  };

  const JUNK_RE = /manage|run list|international|^vehicle$|^cycle$|selectable mode|search\b|^n\/a$/i;

  function cleanVal(val) {
    if (!val) return null;
    const v = val.trim().replace(/\s+/g, ' ');
    if (!v || v.length > 80 || JUNK_RE.test(v)) return null;
    return v;
  }

  function extractSpecs() {
    const vehicle = {};

    // Strategy 1: JSON-LD / embedded app state in script tags
    document.querySelectorAll('script[type="application/ld+json"], script[type="application/json"]').forEach(s => {
      try {
        const data = JSON.parse(s.textContent);
        const v = data?.vehicle || data?.listing?.vehicle || data;
        if (v?.year) vehicle.year = String(v.year);
        if (v?.make) vehicle.make = v.make;
        if (v?.model) vehicle.model = v.model;
        if (v?.trim) vehicle.trim = v.trim;
        if (v?.mileage || v?.odometer) vehicle.mileage = String(v.mileage || v.odometer).replace(/,/g, '');
        if (v?.exteriorColor) vehicle.exterior_color = v.exteriorColor;
        if (v?.interiorColor) vehicle.interior_color = v.interiorColor;
        if (v?.engine) vehicle.engine = typeof v.engine === 'string' ? v.engine : v.engine?.description;
        if (v?.transmission) vehicle.transmission = v.transmission;
        if (v?.driveType || v?.drivetrain) vehicle.drivetrain = v.driveType || v.drivetrain;
        if (v?.fuelType || v?.fuel) vehicle.fuel = v.fuelType || v.fuel;
        if (v?.bodyStyle || v?.body) vehicle.body = v.bodyStyle || v.body;
      } catch (e) {}
    });

    // Strategy 2: __NEXT_DATA__ / window.__INITIAL_STATE__
    document.querySelectorAll('script').forEach(s => {
      const text = s.textContent || '';
      if (!text.includes('__NEXT_DATA__') && !text.includes('window.__') && !text.includes('"vin"')) return;
      try {
        const match = text.match(/(?:__NEXT_DATA__|__data|__INITIAL_STATE__)\s*=\s*({[\s\S]+?});\s*(?:<\/script>|$)/);
        if (!match) return;
        const walk = (obj, depth = 0) => {
          if (!obj || depth > 6 || typeof obj !== 'object') return;
          if (obj.vin && obj.year && String(obj.vin).length === 17) {
            if (!vehicle.year) vehicle.year = String(obj.year);
            if (!vehicle.make) vehicle.make = obj.make;
            if (!vehicle.model) vehicle.model = obj.model;
            if (!vehicle.trim) vehicle.trim = obj.trim;
            if (!vehicle.mileage && (obj.mileage || obj.odometer)) vehicle.mileage = String(obj.mileage || obj.odometer).replace(/,/g, '');
            if (!vehicle.exterior_color && (obj.exteriorColor || obj.color)) vehicle.exterior_color = obj.exteriorColor || obj.color;
            if (!vehicle.interior_color && obj.interiorColor) vehicle.interior_color = obj.interiorColor;
            if (!vehicle.engine && obj.engine) vehicle.engine = typeof obj.engine === 'string' ? obj.engine : obj.engine?.description;
            if (!vehicle.transmission && obj.transmission) vehicle.transmission = obj.transmission;
            if (!vehicle.drivetrain && (obj.driveType || obj.drivetrain)) vehicle.drivetrain = obj.driveType || obj.drivetrain;
            if (!vehicle.fuel && (obj.fuelType || obj.fuel)) vehicle.fuel = obj.fuelType || obj.fuel;
            if (!vehicle.body && (obj.bodyStyle || obj.body)) vehicle.body = obj.bodyStyle || obj.body;
            if (!vehicle.grade && (obj.conditionGrade || obj.grade)) vehicle.grade = String(obj.conditionGrade || obj.grade);
            return;
          }
          for (const key of Object.keys(obj)) walk(obj[key], depth + 1);
        };
        walk(JSON.parse(match[1]));
      } catch (e) {}
    });

    // Strategy 3: DOM label→value pairs (dt/dd, spec rows, attribute rows)
    const tryLabel = (labelText, valText) => {
      const label = labelText?.trim().toLowerCase().replace(/[:\s*]+$/, '');
      const val = cleanVal(valText);
      if (!label || !val) return;
      const field = LABEL_MAP[label];
      if (field && !vehicle[field]) vehicle[field] = val;
    };

    // dt/dd
    document.querySelectorAll('dl').forEach(dl => {
      const dts = dl.querySelectorAll('dt');
      const dds = dl.querySelectorAll('dd');
      dts.forEach((dt, i) => tryLabel(dt.textContent, dds[i]?.textContent));
    });

    // Table rows: th/td
    document.querySelectorAll('table tr').forEach(row => {
      const cells = row.querySelectorAll('th, td');
      if (cells.length >= 2) tryLabel(cells[0].textContent, cells[1].textContent);
    });

    // Generic spec/info rows with 2+ children
    document.querySelectorAll([
      '[class*="spec-row"]', '[class*="specRow"]',
      '[class*="info-row"]', '[class*="infoRow"]',
      '[class*="detail-row"]', '[class*="detailRow"]',
      '[class*="attribute-row"]', '[class*="attributeRow"]',
      '[class*="vehicle-detail"]', '[class*="vehicleDetail"]',
      '[class*="vehicle-info"]', '[class*="vehicleInfo"]',
      '[class*="listing-detail"]', '[class*="listingDetail"]',
    ].join(',')).forEach(row => {
      const kids = Array.from(row.children).filter(c => c.textContent?.trim());
      if (kids.length >= 2) tryLabel(kids[0].textContent, kids[kids.length - 1].textContent);
    });

    // Sibling label+value spans within any container
    document.querySelectorAll('[class*="label"],[class*="Label"]').forEach(lbl => {
      const val = lbl.nextElementSibling;
      if (val) tryLabel(lbl.textContent, val.textContent);
    });

    // Strategy 4: Tight regex fallbacks (mileage + colors only — most reliable)
    const pageText = document.body.innerText || '';
    if (!vehicle.mileage) {
      const m = pageText.match(/(?:odometer|mileage)[^\d]*([0-9,]+)\s*(?:mi|miles)?/i);
      if (m) vehicle.mileage = m[1].replace(/,/g, '');
    }
    if (!vehicle.exterior_color) {
      const m = pageText.match(/ext(?:erior)?\s+color[:\s]+([A-Za-z][A-Za-z /]{1,25}?)(?:\n|int|$)/im);
      if (m) vehicle.exterior_color = cleanVal(m[1]);
    }
    if (!vehicle.interior_color) {
      const m = pageText.match(/int(?:erior)?\s+color[:\s]+([A-Za-z][A-Za-z /]{1,25}?)(?:\n|ext|$)/im);
      if (m) vehicle.interior_color = cleanVal(m[1]);
    }

    // Final cleanup — remove any junk that slipped through
    for (const key of Object.keys(vehicle)) {
      if (!cleanVal(vehicle[key])) delete vehicle[key];
    }

    return vehicle;
  }

  function extractAuction() {
    const auction = {};
    const url = window.location.href;
    const pageText = document.body.innerText || '';
    const isOVE = url.includes('/OVE') || url.includes('channel=OVE');

    // Channel
    if (isOVE) auction.channel = 'OVE';
    else if (/simulcast/i.test(pageText)) auction.channel = 'Simulcast';
    else if (/in[\s-]*lane/i.test(pageText)) auction.channel = 'In-Lane';
    else auction.channel = 'Digital';

    // Pricing — look for labeled values in DOM first
    const priceLabels = {
      'buy now': 'buy_now', 'buy it now': 'buy_now',
      'current bid': 'current_bid', 'high bid': 'current_bid',
      'starting bid': 'starting_bid', 'floor': 'starting_bid',
      'mmr': 'mmr', 'manheim market report': 'mmr',
    };
    document.querySelectorAll('[class*="price"],[class*="Price"],[class*="bid"],[class*="Bid"],[class*="mmr"],[class*="MMR"]').forEach(el => {
      const parent = el.closest('[class*="row"],[class*="Row"],[class*="item"],[class*="Item"]') || el.parentElement;
      if (!parent) return;
      const labelEl = parent.querySelector('[class*="label"],[class*="Label"]') || parent.children[0];
      const valEl = parent.querySelector('[class*="value"],[class*="Value"],[class*="amount"],[class*="Amount"]') || parent.children[parent.children.length - 1];
      if (!labelEl || !valEl || labelEl === valEl) return;
      const label = labelEl.textContent?.trim().toLowerCase();
      const valText = valEl.textContent?.trim().replace(/[$,]/g, '');
      const val = parseInt(valText);
      if (!val || isNaN(val)) return;
      const field = priceLabels[label];
      if (field && !auction[field]) auction[field] = val;
    });

    // Regex fallbacks for prices
    const pricePatterns = [
      { key: 'buy_now', re: /buy\s*(?:it\s*)?now[:\s]*\$?([\d,]+)/i },
      { key: 'current_bid', re: /(?:current|high)\s*bid[:\s]*\$?([\d,]+)/i },
      { key: 'starting_bid', re: /start(?:ing)?\s*bid[:\s]*\$?([\d,]+)/i },
      { key: 'mmr', re: /\bMMR\b[:\s]*\$?([\d,]+)/i },
    ];
    for (const { key, re } of pricePatterns) {
      if (auction[key]) continue;
      const m = pageText.match(re);
      if (m) auction[key] = parseInt(m[1].replace(/,/g, ''));
    }

    // Sale date / lane
    const dateM = pageText.match(/sale\s*date[:\s]*([^\n]+)/i);
    if (dateM) auction.sale_date = dateM[1].trim();
    const laneM = pageText.match(/\blane[:\s]*(\w+)/i);
    if (laneM) auction.lane = laneM[1].trim();

    return Object.keys(auction).length > 1 ? auction : (auction.channel ? auction : null);
  }

  function extractCondition() {
    const condition = { damage: [], options: [], announcements: [] };
    const pageText = document.body.innerText || '';
    const isJunk = t => !t || t.length < 4 || t.length > 200 ||
      /\{|fill:|stroke|class=|<svg|^(sort|filter|type|condition|location|severity|view|show|hide|close|expand|back|next|cancel|miscellaneous)$/i.test(t);

    // Damage — targeted selectors first
    document.querySelectorAll([
      '[class*="damage-item"]', '[class*="damageItem"]',
      '[class*="defect-item"]', '[class*="defectItem"]',
      '[class*="condition-item"]', '[class*="conditionItem"]',
      '[data-testid*="damage"]',
    ].join(',')).forEach(el => {
      if (el.children.length > 4) return;
      const t = el.textContent?.trim();
      if (!isJunk(t)) condition.damage.push(t);
    });

    // Fallback: scan for damage keywords in text lines
    if (!condition.damage.length) {
      const damageRe = /dent|scratch|scuff|chip|crack|tear|stain|worn|faded|rust|missing|broken|bent|gouge|curb\s*rash|hail/i;
      const locationRe = /wheel|bumper|fender|hood|door|roof|quarter|trunk|panel|mirror|windshield|rim|tire|LF|LR|RF|RR|front|rear/i;
      for (const line of pageText.split('\n')) {
        const t = line.trim();
        if (!isJunk(t) && damageRe.test(t) && (locationRe.test(t) || t.split(/\s+/).length >= 3)) {
          condition.damage.push(t);
        }
      }
    }

    // Options / equipment
    document.querySelectorAll([
      '[class*="option-item"]', '[class*="optionItem"]',
      '[class*="feature-item"]', '[class*="featureItem"]',
      '[class*="equipment-item"]', '[class*="equipmentItem"]',
      '[class*="package-item"]', '[class*="packageItem"]',
    ].join(',')).forEach(el => {
      const t = el.textContent?.trim();
      if (!isJunk(t) && t.length < 100) condition.options.push(t);
    });

    if (!condition.options.length) {
      document.querySelectorAll('[class*="option"],[class*="feature"],[class*="equipment"],[class*="package"]').forEach(el => {
        el.querySelectorAll('li, span').forEach(item => {
          if (item.children.length > 1) return;
          const t = item.textContent?.trim();
          if (!isJunk(t) && t.length < 100) condition.options.push(t);
        });
      });
    }

    // Announcements
    document.querySelectorAll('[class*="announcement"]').forEach(el => {
      if (el.children.length > 3) return;
      const t = el.textContent?.trim();
      if (!isJunk(t)) condition.announcements.push(t);
    });

    // Grade
    if (!condition.overall_grade) {
      const gm = pageText.match(/(?:condition\s*grade|cr\s*grade)[:\s]*([0-9.]+)/i);
      if (gm) condition.overall_grade = gm[1];
    }

    // Tires
    const tm = pageText.match(/tires?[:\s]+([^\n]{3,60})/i);
    if (tm) condition.tires = tm[1].trim();

    // Dedupe
    condition.damage = [...new Set(condition.damage)].slice(0, 30);
    condition.options = [...new Set(condition.options)].slice(0, 60);
    condition.announcements = [...new Set(condition.announcements)].slice(0, 20);

    return condition;
  }

  function extractPhotos() {
    const photos = new Set();

    document.querySelectorAll('img').forEach(img => {
      let src = img.src || img.dataset?.src || img.getAttribute('data-lazy-src') || '';
      if (!src || /logo|icon|avatar|sprite|svg|data:image/i.test(src)) return;
      if (img.naturalWidth > 0 && img.naturalWidth < 50) return;
      src = src.replace(/\?.*$/, '').replace(/_thumb|_small|_medium|_tn|_sm|_md/gi, '');
      if (/\.(jpg|jpeg|png|webp)/i.test(src)) photos.add(src);
    });

    document.querySelectorAll('[style*="background-image"]').forEach(el => {
      const m = el.style.backgroundImage.match(/url\(["']?(.*?)["']?\)/);
      if (m?.[1] && /\.(jpg|jpeg|png|webp)/i.test(m[1])) photos.add(m[1].replace(/\?.*$/, ''));
    });

    document.querySelectorAll('[data-src],[data-full],[data-original],[data-zoom-image],[data-large]').forEach(el => {
      const src = el.dataset.src || el.dataset.full || el.dataset.original || el.dataset.zoomImage || el.dataset.large;
      if (src && /\.(jpg|jpeg|png|webp)/i.test(src)) photos.add(src.replace(/\?.*$/, ''));
    });

    // Pull from inline scripts
    document.querySelectorAll('script').forEach(s => {
      const text = s.textContent || '';
      for (const m of text.matchAll(/"(https?:\/\/[^"]+\.(jpg|jpeg|png|webp))"/gi)) {
        if (!/logo|icon/i.test(m[1])) photos.add(m[1].replace(/\?.*$/, ''));
      }
    });

    return [...photos];
  }

  function runExtraction() {
    const url = window.location.href;
    if (!url.includes('manheim.com') && !url.includes('insightcr')) return;

    const isInsightCR = url.includes('insightcr.manheim.com') || url.includes('cr-display');
    const isLiveListing = !isInsightCR && (url.includes('search.manheim.com') || url.includes('/results') || url.includes('/listing'));

    const vin = getVin();
    if (!vin) return; // Nothing to extract without a VIN

    const vehicle = extractSpecs();
    const condition = extractCondition();
    const auction = extractAuction();
    const photos = extractPhotos();

    const data = {
      vin,
      vehicle,
      condition,
      auction,
      photos,
      page_type: isInsightCR ? 'insight_cr' : isLiveListing ? 'live_listing' : 'condition_report',
      source_url: url,
      source_title: document.title,
      extracted_at: new Date().toISOString(),
    };

    // Cache by VIN so popup can read it
    chrome.storage.local.set({ [`bwa_scan_${vin}`]: data, bwa_last_scan: data });
    console.log('[BWA] Extracted data for', vin, data);

    // Notify popup if open
    chrome.runtime.sendMessage({ action: 'scanReady', data }).catch(() => {});
  }

  // ── MutationObserver — fire when the page stabilizes ──
  let extractTimer = null;
  let lastUrl = window.location.href;
  let extracted = false;

  function scheduleExtraction(delay = 1500) {
    clearTimeout(extractTimer);
    extracted = false;
    extractTimer = setTimeout(() => {
      runExtraction();
      extracted = true;
    }, delay);
  }

  // Watch for React rendering content into the DOM
  const observer = new MutationObserver((mutations) => {
    // Check for SPA navigation
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      scheduleExtraction(2000);
      return;
    }

    // Re-extract if significant DOM changes happen and we haven't extracted yet
    if (!extracted) {
      const relevant = mutations.some(m =>
        Array.from(m.addedNodes).some(n =>
          n.nodeType === 1 && (
            (n.textContent?.length > 100) ||
            n.querySelector?.('[class*="spec"],[class*="detail"],[class*="vehicle"],[class*="listing"]')
          )
        )
      );
      if (relevant) scheduleExtraction(800);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Also fire on initial load + hash changes (SPA navigation)
  window.addEventListener('hashchange', () => scheduleExtraction(2000));
  window.addEventListener('popstate', () => scheduleExtraction(2000));

  // Initial extraction with delay for React to render
  if (document.readyState === 'complete') {
    scheduleExtraction(1500);
  } else {
    window.addEventListener('load', () => scheduleExtraction(1500));
  }

  // Listen for popup requesting a fresh scan
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'ping') {
      sendResponse({ ready: true });
    }
    if (msg.action === 'rescan') {
      extracted = false;
      scheduleExtraction(200);
      sendResponse({ ok: true });
    }
    if (msg.action === 'getData') {
      sendResponse({ data: null }); // popup reads from storage directly
    }
  });

  // Inject the floating button once DOM is ready
  if (document.body) injectButton();
  else document.addEventListener('DOMContentLoaded', injectButton);

})();
