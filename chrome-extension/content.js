// Big Wave Auto — Auction Content Script
// Runs on Manheim and ADESA/OpenLane pages, extracts vehicle data and caches it.

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

  // VIN check-digit validation — filters out random 17-char strings (photo tokens, IDs, etc.)
  function vinCheckDigitValid(vin) {
    const v = vin.toUpperCase();
    const map = {A:1,B:2,C:3,D:4,E:5,F:6,G:7,H:8,J:1,K:2,L:3,M:4,N:5,P:7,R:9,S:2,T:3,U:4,V:5,W:6,X:7,Y:8,Z:9};
    const weights = [8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2];
    let sum = 0;
    for (let i = 0; i < 17; i++) {
      const c = v[i];
      const val = isNaN(c) ? (map[c] || 0) : parseInt(c);
      sum += val * weights[i];
    }
    const rem = sum % 11;
    const expected = rem === 10 ? 'X' : String(rem);
    return v[8] === expected;
  }

  function getVin() {
    const url = window.location.href;
    const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/i;

    const isVin = (v) => v && String(v).length === 17 && VIN_RE.test(v) && vinCheckDigitValid(v);

    // 1. URL — hash SPA (#/details/VIN) or path segment (/vin/VIN, /vehicle/VIN, etc.)
    const hashMatch = url.match(/[#/]([A-HJ-NPR-Z0-9]{17})(?:[/?#]|$)/i);
    if (hashMatch && isVin(hashMatch[1])) return hashMatch[1].toUpperCase();
    const pathMatch = url.match(/\/(?:details|vehicle|cr|listing|vin)\/([A-HJ-NPR-Z0-9]{17})/i);
    if (pathMatch && isVin(pathMatch[1])) return pathMatch[1].toUpperCase();

    // 2. Meta tag
    const meta = document.querySelector('meta[name*="vin" i], meta[property*="vin" i]');
    if (meta?.content && isVin(meta.content)) return meta.content.toUpperCase();

    // 3. DOM — find a "VIN" label element and grab the value from a sibling or same element
    const allEls = document.querySelectorAll('span, div, dt, td, p, li, strong, b');
    for (const el of allEls) {
      const txt = el.textContent?.trim() || '';
      // Element contains ONLY the VIN value (sibling pattern: <label>VIN</label><value>XXXX</value>)
      if (el.children.length === 0 && /^vin[:\s]*$/i.test(txt)) {
        const candidates = [
          el.nextElementSibling,
          el.parentElement?.querySelector('[class*="value"],[class*="Value"],[class*="data"],[class*="content"]'),
          el.parentElement?.children[el.parentElement.children.length - 1],
        ];
        for (const c of candidates) {
          const v = c?.textContent?.trim().replace(/\s+/g, '');
          if (isVin(v)) return v.toUpperCase();
        }
      }
      // Element contains "VIN: XXXX" all together
      if (el.children.length === 0 && /VIN[:\s]+([A-HJ-NPR-Z0-9]{17})/i.test(txt)) {
        const m = txt.match(/VIN[:\s]+([A-HJ-NPR-Z0-9]{17})/i);
        if (m && isVin(m[1])) return m[1].toUpperCase();
      }
    }

    // 4. Embedded JSON — parse __NEXT_DATA__ and find a vehicle object with VIN + vehicle context
    for (const s of document.querySelectorAll('script')) {
      const text = s.textContent || '';
      const nd = text.match(/__NEXT_DATA__\s*=\s*({[\s\S]+?});\s*(?:<\/script>|$)/)?.[1] ||
                 text.match(/window\.__(?:PRELOADED_STATE|INITIAL_STATE|STATE)__\s*=\s*({[\s\S]+?});\s*(?:<\/script>|$)/)?.[1];
      if (!nd) continue;
      try {
        let foundVin = null;
        const walk = (obj, depth = 0) => {
          if (!obj || depth > 10 || typeof obj !== 'object' || foundVin) return;
          const v = obj.vin || obj.VIN || obj.vehicleVin;
          if (v && isVin(v) && (obj.year || obj.modelYear || obj.make || obj.model)) {
            foundVin = String(v).toUpperCase();
            return;
          }
          for (const k of Object.keys(obj)) walk(obj[k], depth + 1);
        };
        walk(JSON.parse(nd));
        if (foundVin) return foundVin;
      } catch (e) {}
    }

    // 5. Page text — labeled "VIN: XXXXX", check-digit validated
    const pageText = document.body.innerText || '';
    for (const m of pageText.matchAll(/VIN[^A-HJ-NPR-Z0-9\n]{0,5}([A-HJ-NPR-Z0-9]{17})/gi)) {
      if (isVin(m[1])) return m[1].toUpperCase();
    }

    // 6. Last resort — any check-digit-valid VIN anywhere on the page
    for (const m of pageText.matchAll(/\b([A-HJ-NPR-Z0-9]{17})\b/g)) {
      if (isVin(m[1])) return m[1].toUpperCase();
    }

    return '';
  }

  const LABEL_MAP = {
    'odometer': 'mileage', 'mileage': 'mileage', 'miles': 'mileage', 'odometer reading': 'mileage',
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
        const parsed = JSON.parse(match[1]);
        const walk = (obj, depth = 0) => {
          if (!obj || depth > 12 || typeof obj !== 'object') return;
          if (obj.vin && String(obj.vin).length === 17 && (obj.year || obj.modelYear || obj.make || obj.model)) {
            if (!vehicle.year) vehicle.year = String(obj.year || obj.modelYear || '');
            if (!vehicle.make) vehicle.make = obj.make || obj.makeName || '';
            if (!vehicle.model) vehicle.model = obj.model || obj.modelName || '';
            if (!vehicle.trim) vehicle.trim = obj.trim || obj.trimLevel || '';
            const mi = obj.mileage || obj.odometer || obj.odometerReading || obj.currentOdometer || obj.miles;
            if (!vehicle.mileage && mi) vehicle.mileage = String(mi).replace(/,/g, '');
            if (!vehicle.exterior_color && (obj.exteriorColor || obj.extColor || obj.color)) vehicle.exterior_color = obj.exteriorColor || obj.extColor || obj.color;
            if (!vehicle.interior_color && (obj.interiorColor || obj.intColor)) vehicle.interior_color = obj.interiorColor || obj.intColor;
            if (!vehicle.engine && obj.engine) vehicle.engine = typeof obj.engine === 'string' ? obj.engine : (obj.engine?.description || obj.engineDescription || '');
            if (!vehicle.transmission && (obj.transmission || obj.transmissionType)) vehicle.transmission = obj.transmission || obj.transmissionType;
            if (!vehicle.drivetrain && (obj.driveType || obj.drivetrain || obj.driveTrain)) vehicle.drivetrain = obj.driveType || obj.drivetrain || obj.driveTrain;
            if (!vehicle.fuel && (obj.fuelType || obj.fuel)) vehicle.fuel = obj.fuelType || obj.fuel;
            if (!vehicle.body && (obj.bodyStyle || obj.bodyType || obj.body)) vehicle.body = obj.bodyStyle || obj.bodyType || obj.body;
            if (!vehicle.grade && (obj.conditionGrade || obj.grade || obj.crGrade)) vehicle.grade = String(obj.conditionGrade || obj.grade || obj.crGrade);
            return;
          }
          for (const key of Object.keys(obj)) walk(obj[key], depth + 1);
        };
        walk(parsed);
        // Broader mileage scan — Manheim stores odometer at lot level, not always on the VIN object
        if (!vehicle.mileage) {
          const mileWalk = (obj, depth = 0) => {
            if (!obj || depth > 14 || typeof obj !== 'object' || vehicle.mileage) return;
            for (const key of ['odometer', 'odometerReading', 'currentOdometer', 'miles', 'mileage']) {
              if (obj[key] != null) {
                const n = parseFloat(String(obj[key]).replace(/,/g, ''));
                if (!isNaN(n) && n > 100 && n < 999999) { vehicle.mileage = String(Math.round(n)); return; }
              }
            }
            for (const key of Object.keys(obj)) mileWalk(obj[key], depth + 1);
          };
          mileWalk(parsed);
        }
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

    // Strategy 4: Tight regex fallbacks + data-qa DOM selectors
    const pageText = document.body.innerText || '';
    if (!vehicle.mileage) {
      // Check Manheim/ADESA data-qa attributes first (most precise)
      const odomEl = document.querySelector(
        '[data-qa*="odometer"],[data-testid*="odometer"],[data-qa*="mileage"],[data-testid*="mileage"]'
      );
      if (odomEl) {
        const n = parseInt((odomEl.textContent || '').replace(/[^0-9]/g, ''));
        if (!isNaN(n) && n > 100 && n < 999999) vehicle.mileage = String(n);
      }
    }
    if (!vehicle.mileage) {
      // Fixed regex: [0-9]{1,3}(?:,[0-9]{3})* matches any comma-formatted number (e.g. 42,368)
      const m = pageText.match(/(?:odometer(?:\s*reading)?|mileage)[^\d]*([0-9,]+)\s*(?:mi|miles)?/i)
             || pageText.match(/\b([0-9]{1,3}(?:,[0-9]{3})+)\s*(?:miles|mi)\b/i)
             || pageText.match(/\b([0-9]{4,6})\s*(?:miles|mi)\b/i);
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
    if (!vehicle.engine) {
      const m = pageText.match(/engine[:\s]+([^\n]{4,60})/i);
      if (m) vehicle.engine = cleanVal(m[1]);
    }
    if (!vehicle.transmission) {
      const m = pageText.match(/transmission[:\s]+([^\n]{4,60})/i);
      if (m) vehicle.transmission = cleanVal(m[1]);
    }
    if (!vehicle.drivetrain) {
      const m = pageText.match(/(?:drive\s*type|drivetrain)[:\s]+([^\n]{2,40})/i);
      if (m) vehicle.drivetrain = cleanVal(m[1]);
    }
    if (!vehicle.fuel) {
      const m = pageText.match(/fuel\s*(?:type)?[:\s]+([^\n]{2,30})/i);
      if (m) vehicle.fuel = cleanVal(m[1]);
    }

    // Extra fields
    const keysM = pageText.match(/(?:keys?)[:\s]+([0-9]+)/i);
    if (keysM) vehicle.keys = keysM[1];

    const msrpM = pageText.match(/msrp[:\s]*\$?([\d,]+)/i);
    if (msrpM) vehicle.msrp = parseInt(msrpM[1].replace(/,/g, ''));

    const stateM = pageText.match(/(?:location|state|region)[:\s]+([A-Z]{2}|[A-Za-z\s]{3,25}?)(?:\n|$)/i);
    if (stateM) vehicle.location = cleanVal(stateM[1]);

    // Final cleanup
    for (const key of Object.keys(vehicle)) {
      if (!cleanVal(String(vehicle[key] ?? ''))) delete vehicle[key];
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
    // packages: [{name, items[]}], equipment: [], options: [], damage: [], announcements: []
    const condition = { damage: [], packages: [], equipment: [], options: [], announcements: [] };
    const pageText = document.body.innerText || '';
    const isJunk = t => !t || t.length < 3 || t.length > 300 ||
      /\{|fill:|stroke|class=|<svg|^(sort|filter|type|condition|location|severity|view|show|hide|close|expand|back|next|cancel|miscellaneous|optional packages|standard equipment|equipment & options)$/i.test(t);

    // ── Packages & Equipment (hierarchical) ──
    // Strategy 1: walk the DOM looking for package/equipment section containers
    // Manheim renders: section header → package name (bold/h) → ul>li items
    const equipSection = Array.from(document.querySelectorAll(
      '[class*="equipment"],[class*="Equipment"],[class*="option"],[class*="Option"],[class*="package"],[class*="Package"]'
    )).find(el => el.textContent?.length > 200 && el.textContent?.length < 50000);

    if (equipSection) {
      // Walk children looking for package headers (bold/strong/h tags) followed by ul/li lists
      let currentPackage = null;
      const walk = (el) => {
        if (!el) return;
        const tag = el.tagName?.toLowerCase();
        const text = el.textContent?.trim();
        if (!text || text.length > 200) {
          // Recurse into containers
          for (const child of el.children) walk(child);
          return;
        }
        // Package header: bold text, strong, h3/h4/h5/h6, or all-caps line
        const isHeader = tag === 'strong' || tag === 'b' || /^h[2-6]$/.test(tag) ||
          (el.children.length === 0 && /^[A-Z0-9 &\-–—]+$/.test(text) && text.length > 3 && text.length < 120 && !/^(PACKAGES|EQUIPMENT|OPTIONS|STANDARD)$/i.test(text));
        if (isHeader && el.children.length <= 1) {
          // New package group
          currentPackage = { name: text, items: [] };
          condition.packages.push(currentPackage);
          return;
        }
        // List item — add to current package or equipment
        if ((tag === 'li' || el.children.length === 0) && text.length > 2 && text.length < 200) {
          if (!isJunk(text)) {
            if (currentPackage) {
              currentPackage.items.push(text);
            } else {
              condition.equipment.push(text);
            }
          }
          return;
        }
        // Section divider clears current package context
        if (/equipment/i.test(text) && text.length < 30) {
          currentPackage = null;
        }
        for (const child of el.children) walk(child);
      };
      walk(equipSection);
    }

    // Strategy 2: page text parsing — find "Packages" section then bullet lines
    if (!condition.packages.length) {
      const lines = pageText.split('\n').map(l => l.trim()).filter(l => l);
      let inSection = false;
      let currentPkg = null;
      let inEquipment = false;

      for (const line of lines) {
        if (/optional packages|packages & equipment|equipment & options/i.test(line)) { inSection = true; continue; }
        if (!inSection) continue;
        if (/standard equipment|condition report|announcements/i.test(line)) break;

        // Section sub-header
        if (/^equipment$/i.test(line)) { inEquipment = true; currentPkg = null; continue; }
        if (/^packages$/i.test(line)) { inEquipment = false; continue; }

        // Package name: all-caps or title-case with dashes (e.g. "SPORT PRESTIGE PACKAGE - 04")
        if (/^[A-Z][A-Z0-9 &\-–—]+$/.test(line) && line.length > 4 && line.length < 80 && !/^(N\/A|YES|NO)$/.test(line)) {
          currentPkg = { name: line, items: [] };
          condition.packages.push(currentPkg);
          inEquipment = false;
          continue;
        }

        // Bullet items (may start with • or just be a line)
        const item = line.replace(/^[•·\-–—]\s*/, '').trim();
        if (item.length < 3 || item.length > 200 || isJunk(item)) continue;

        if (inEquipment || !currentPkg) {
          condition.equipment.push(item);
        } else if (currentPkg) {
          currentPkg.items.push(item);
        }
      }
    }

    // Dedupe packages items and equipment
    condition.packages = condition.packages
      .filter(p => p.items.length > 0)
      .map(p => ({ name: p.name, items: [...new Set(p.items)] }));
    condition.equipment = [...new Set(condition.equipment)].slice(0, 100);

    // Flat options list (backward compat — union of all package items + equipment)
    condition.options = [
      ...condition.equipment,
      ...condition.packages.flatMap(p => p.items),
    ].slice(0, 200);

    // ── Damage ──
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
    condition.damage = [...new Set(condition.damage)].slice(0, 30);

    // ── Announcements ──
    document.querySelectorAll('[class*="announcement"]').forEach(el => {
      if (el.children.length > 3) return;
      const t = el.textContent?.trim();
      if (!isJunk(t)) condition.announcements.push(t);
    });
    condition.announcements = [...new Set(condition.announcements)].slice(0, 20);

    // ── Standard Equipment ──
    const stdSection = Array.from(document.querySelectorAll('*')).find(el =>
      /standard equipment/i.test(el.textContent) && el.textContent.length < 20000 &&
      el.querySelectorAll('li').length > 2
    );
    if (stdSection) {
      let inStd = false;
      stdSection.querySelectorAll('li, span, div').forEach(el => {
        if (/standard equipment/i.test(el.textContent) && el.textContent.length < 40) { inStd = true; return; }
        if (!inStd || el.children.length > 0) return;
        const t = el.textContent?.trim();
        if (!isJunk(t) && t.length < 150) condition.standard_equipment = [...(condition.standard_equipment || []), t];
      });
    }
    if (condition.standard_equipment?.length) {
      condition.standard_equipment = [...new Set(condition.standard_equipment)].slice(0, 100);
    }

    // ── Grade + Tires + Title ──
    const gm = pageText.match(/(?:condition\s*grade|cr\s*grade)[:\s]*([0-9.]+)/i);
    if (gm) condition.overall_grade = gm[1];

    const tm = pageText.match(/tires?[:\s]+([^\n]{3,80})/i);
    if (tm) condition.tires = tm[1].trim();

    // Tire tread by position
    const tireTread = {};
    for (const pos of ['LF', 'RF', 'LR', 'RR']) {
      const m = pageText.match(new RegExp(pos + '[:\\s]*([0-9]+(?:\\.[0-9]+)?(?:\\s*\\/\\s*[0-9]+)?\\s*(?:32nds?|mm)?)', 'i'));
      if (m) tireTread[pos] = m[1].trim();
    }
    if (Object.keys(tireTread).length) condition.tire_tread = tireTread;

    // Title status
    const titleM = pageText.match(/title[:\s]+([^\n]{2,40})/i);
    if (titleM && !/fee|transfer|cost/i.test(titleM[1])) condition.title_status = titleM[1].trim();

    // Seller
    const sellerM = pageText.match(/(?:seller|consignor|sold\s*by)[:\s]+([^\n]{2,60})/i);
    if (sellerM) condition.seller = sellerM[1].trim();

    // Panel grades (A/B/C or numeric per panel)
    const panelGrades = {};
    const panels = ['Hood', 'Roof', 'Trunk', 'Left Front', 'Right Front', 'Left Rear', 'Right Rear', 'Left Front Door', 'Right Front Door'];
    for (const panel of panels) {
      const re = new RegExp(panel.replace(' ', '[\\s-]*') + '[:\\s]*([A-E]|[0-9](?:\\.[0-9])?)', 'i');
      const m = pageText.match(re);
      if (m) panelGrades[panel] = m[1];
    }
    if (Object.keys(panelGrades).length) condition.panel_grades = panelGrades;

    return condition;
  }

  function extractPhotos() {
    const photos = new Set();
    const vin = getVin();

    const photoUrlRe = /https?:\/\/.+\.(jpg|jpeg|png|webp)/i;
    const manheimCdnRe = /https?:\/\/[^"'\s]*(?:manheim\.com|imagecache|manheimimages)[^"'\s]*/i;
    const junkRe = /logo|icon|avatar|sprite|banner|placeholder|flag|badge/i;
    const photoKeys = ['url', 'src', 'href', 'imageUrl', 'fullUrl', 'fullSizeUrl', 'largeUrl',
                       'originalUrl', 'cdnUrl', 'photoUrl', 'highResUrl', 'fullResUrl', 'uri'];
    const photoArrayKeys = ['photos', 'images', 'imageUrls', 'photoUrls', 'vehicleImages',
                            'vehiclePhotos', 'galleryImages', 'mediaItems', 'media'];

    function collectFromObj(obj, out, depth = 0) {
      if (!obj || depth > 6 || typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        for (const item of obj) {
          if (typeof item === 'string' && (photoUrlRe.test(item) || manheimCdnRe.test(item)) && !junkRe.test(item))
            out.add(item.replace(/\?.*$/, ''));
          else collectFromObj(item, out, depth + 1);
        }
        return;
      }
      for (const k of photoKeys) {
        const v = obj[k];
        if (typeof v === 'string' && (photoUrlRe.test(v) || manheimCdnRe.test(v)) && !junkRe.test(v))
          out.add(v.replace(/\?.*$/, ''));
      }
      for (const k of photoArrayKeys) {
        if (obj[k]) collectFromObj(obj[k], out, depth + 1);
      }
    }

    function findByVin(obj, targetVin, out, depth = 0) {
      if (!obj || depth > 10 || typeof obj !== 'object') return false;
      const objVin = String(obj.vin || obj.VIN || obj.vehicleVin || '').toUpperCase();
      if (objVin === targetVin && (obj.year || obj.modelYear || obj.make || obj.model)) {
        collectFromObj(obj, out, 0);
        return true;
      }
      for (const k of Object.keys(obj)) {
        if (findByVin(obj[k], targetVin, out, depth + 1)) return true;
      }
      return false;
    }

    // Strategy 1: VIN-anchored walk through __NEXT_DATA__ / app state
    if (vin) {
      for (const s of document.querySelectorAll('script')) {
        const text = s.textContent || '';
        const nd = text.match(/__NEXT_DATA__\s*=\s*({[\s\S]+?});\s*(?:<\/script>|$)/)?.[1] ||
                   text.match(/window\.__(?:PRELOADED_STATE|INITIAL_STATE|STATE)__\s*=\s*({[\s\S]+?});\s*(?:<\/script>|$)/)?.[1];
        if (!nd) continue;
        try {
          if (findByVin(JSON.parse(nd), vin.toUpperCase(), photos)) break;
        } catch (e) {}
      }
      if (photos.size > 0) return [...photos];
    }

    // Strategy 2: img tags (including lazy-loaded)
    document.querySelectorAll('img').forEach(img => {
      let src = img.src || img.dataset?.src || img.getAttribute('data-lazy-src') || '';
      if (!src || junkRe.test(src) || /svg|data:image/i.test(src)) return;
      if (img.naturalWidth > 0 && img.naturalWidth < 50) return;
      src = src.replace(/\?.*$/, '').replace(/_thumb|_small|_medium|_tn|_sm|_md/gi, '');
      if (/\.(jpg|jpeg|png|webp)/i.test(src) || manheimCdnRe.test(src)) photos.add(src);
    });

    document.querySelectorAll('[style*="background-image"]').forEach(el => {
      const m = el.style.backgroundImage.match(/url\(["']?(.*?)["']?\)/);
      if (m?.[1] && /\.(jpg|jpeg|png|webp)/i.test(m[1])) photos.add(m[1].replace(/\?.*$/, ''));
    });

    document.querySelectorAll('[data-src],[data-full],[data-original],[data-zoom-image],[data-large]').forEach(el => {
      const src = el.dataset.src || el.dataset.full || el.dataset.original || el.dataset.zoomImage || el.dataset.large;
      if (src && /\.(jpg|jpeg|png|webp)/i.test(src)) photos.add(src.replace(/\?.*$/, ''));
    });

    // Strategy 3: scan inline scripts for any Manheim CDN or photo-extension URLs
    document.querySelectorAll('script').forEach(s => {
      const text = s.textContent || '';
      for (const m of text.matchAll(/"(https?:\/\/[^"]+\.(jpg|jpeg|png|webp))"/gi)) {
        if (!junkRe.test(m[1])) photos.add(m[1].replace(/\?.*$/, ''));
      }
      // Manheim CDN URLs that may not have a file extension
      if (vin && text.toUpperCase().includes(vin.toUpperCase())) {
        for (const m of text.matchAll(/"(https?:\/\/[^"]*manheim[^"]+)"/gi)) {
          if (!junkRe.test(m[1]) && !/\.js|\.css|\.svg/i.test(m[1])) photos.add(m[1].replace(/\?.*$/, ''));
        }
      }
    });

    return [...photos];
  }

  // ── ADESA VIN detection — avoids JSON parsing which picks up related-vehicle VINs ──
  // Uses URL and visible page text only, so the main listing's VIN wins.
  function getAdesaVin() {
    const url = window.location.href;

    // 1. URL path segment or query param
    const urlPatterns = [
      /[#/]([A-HJ-NPR-Z0-9]{17})(?:[/?#]|$)/i,
      /[?&]vin=([A-HJ-NPR-Z0-9]{17})/i,
    ];
    for (const re of urlPatterns) {
      const m = url.match(re);
      if (m && vinCheckDigitValid(m[1])) return m[1].toUpperCase();
    }

    // 2. Prominent heading elements (h1, h2, data-testid containing "vin")
    for (const el of document.querySelectorAll('h1, h2, [data-testid*="vin" i], [class*="vin" i]')) {
      for (const m of (el.textContent || '').matchAll(/\b([A-HJ-NPR-Z0-9]{17})\b/g)) {
        if (vinCheckDigitValid(m[1])) return m[1].toUpperCase();
      }
    }

    // 3. "VIN" label in visible text — appears near the top of the listing
    const bodyText = document.body.innerText || '';
    for (const m of bodyText.matchAll(/\bVIN[^A-Z0-9\n]{0,15}([A-HJ-NPR-Z0-9]{17})\b/gi)) {
      if (vinCheckDigitValid(m[1])) return m[1].toUpperCase();
    }

    // 4. First check-digit-valid VIN anywhere in visible text (main vehicle is near top)
    for (const m of bodyText.matchAll(/\b([A-HJ-NPR-Z0-9]{17})\b/g)) {
      if (vinCheckDigitValid(m[1])) return m[1].toUpperCase();
    }

    return '';
  }

  // ── ADESA / OpenLane extraction ──

  function extractAdesaSpecs() {
    const vehicle = {};

    // OpenLane / ADESA embed data in __NEXT_DATA__ or window.__PRELOADED_STATE__
    document.querySelectorAll('script').forEach(s => {
      const text = s.textContent || '';
      if (!text.includes('"vin"') && !text.includes('"VIN"') && !text.includes('vehicleDetails')) return;
      try {
        // __NEXT_DATA__
        const nd = text.match(/__NEXT_DATA__\s*=\s*({[\s\S]+?});\s*(?:<\/script>|$)/)?.[1] ||
                   text.match(/window\.__(?:PRELOADED_STATE|INITIAL_STATE|STATE)__\s*=\s*({[\s\S]+?});\s*(?:<\/script>|$)/)?.[1];
        if (!nd) return;
        const walk = (obj, depth = 0) => {
          if (!obj || depth > 8 || typeof obj !== 'object') return;
          const vin = obj.vin || obj.VIN || obj.vehicleVin;
          if (vin && String(vin).length === 17) {
            if (!vehicle.year)  vehicle.year  = String(obj.year  || obj.modelYear || '');
            if (!vehicle.make)  vehicle.make  = obj.make  || obj.manufacturerName || '';
            if (!vehicle.model) vehicle.model = obj.model || obj.modelName || '';
            if (!vehicle.trim)  vehicle.trim  = obj.trim  || obj.trimLevel || '';
            const mi = obj.mileage || obj.odometer || obj.odometerReading;
            if (!vehicle.mileage && mi) vehicle.mileage = String(mi).replace(/,/g, '');
            if (!vehicle.exterior_color) vehicle.exterior_color = obj.exteriorColor || obj.extColor || obj.color || '';
            if (!vehicle.interior_color) vehicle.interior_color = obj.interiorColor || obj.intColor || '';
            if (!vehicle.engine)        vehicle.engine        = typeof obj.engine === 'string' ? obj.engine : (obj.engineDescription || obj.engineType || '');
            if (!vehicle.transmission)  vehicle.transmission  = obj.transmission || obj.transmissionType || '';
            if (!vehicle.drivetrain)    vehicle.drivetrain    = obj.driveType || obj.drivetrain || obj.driveTrain || '';
            if (!vehicle.fuel)          vehicle.fuel          = obj.fuelType  || obj.fuel || '';
            if (!vehicle.body)          vehicle.body          = obj.bodyStyle || obj.bodyType || obj.body || '';
            if (!vehicle.grade)         vehicle.grade         = String(obj.conditionGrade || obj.crGrade || obj.grade || '');
            return;
          }
          for (const k of Object.keys(obj)) walk(obj[k], depth + 1);
        };
        walk(JSON.parse(nd));
      } catch (e) {}
    });

    // DOM fallback — ADESA spec rows
    document.querySelectorAll([
      '[class*="vehicle-info"],[class*="vehicleInfo"]',
      '[class*="spec-row"],[class*="specRow"]',
      '[class*="detail-row"],[class*="detailRow"]',
      '[class*="attribute"],[data-testid*="spec"]',
    ].join(',')).forEach(row => {
      const kids = Array.from(row.children).filter(c => c.textContent?.trim());
      if (kids.length >= 2) {
        const label = kids[0].textContent.trim().toLowerCase().replace(/[:\s]+$/, '');
        const val   = cleanVal(kids[kids.length - 1].textContent);
        const field = LABEL_MAP[label];
        if (field && val && !vehicle[field]) vehicle[field] = val;
      }
    });

    // Page text fallbacks (same as Manheim)
    const pageText = document.body.innerText || '';
    if (!vehicle.mileage) {
      const m = pageText.match(/(?:odometer|mileage)[^\d]*([0-9,]+)\s*(?:mi|miles)?/i);
      if (m) vehicle.mileage = m[1].replace(/,/g, '');
    }
    if (!vehicle.engine) {
      const m = pageText.match(/engine[:\s]+([^\n]{4,60})/i);
      if (m) vehicle.engine = cleanVal(m[1]);
    }
    if (!vehicle.transmission) {
      const m = pageText.match(/transmission[:\s]+([^\n]{4,60})/i);
      if (m) vehicle.transmission = cleanVal(m[1]);
    }

    for (const key of Object.keys(vehicle)) {
      if (!cleanVal(String(vehicle[key] ?? ''))) delete vehicle[key];
    }
    return vehicle;
  }

  function extractAdesaAuction() {
    const auction = { channel: 'ADESA' };
    const url = window.location.href;
    const pageText = document.body.innerText || '';

    if (url.includes('openlane.com')) auction.channel = 'OpenLane';
    else if (/simulcast/i.test(pageText)) auction.channel = 'ADESA Simulcast';
    else if (/run\s*list|in[\s-]*lane/i.test(pageText)) auction.channel = 'ADESA In-Lane';

    const pricePatterns = [
      { key: 'buy_now',      re: /buy\s*(?:it\s*)?now[:\s]*\$?([\d,]+)/i },
      { key: 'current_bid',  re: /(?:current|high)\s*bid[:\s]*\$?([\d,]+)/i },
      { key: 'starting_bid', re: /start(?:ing)?\s*(?:bid|price)[:\s]*\$?([\d,]+)/i },
      { key: 'mmr',          re: /\bMMR\b[:\s]*\$?([\d,]+)/i },
      { key: 'buy_now',      re: /(?:asking|list)\s*price[:\s]*\$?([\d,]+)/i },
    ];
    for (const { key, re } of pricePatterns) {
      if (auction[key]) continue;
      const m = pageText.match(re);
      if (m) auction[key] = parseInt(m[1].replace(/,/g, ''));
    }

    // DOM price scraping
    document.querySelectorAll('[class*="price"],[class*="Price"],[class*="bid"],[class*="Bid"],[class*="amount"],[class*="Amount"]').forEach(el => {
      const parent = el.parentElement;
      if (!parent) return;
      const labelEl = parent.querySelector('[class*="label"],[class*="Label"]') || parent.children[0];
      const valEl   = parent.querySelector('[class*="value"],[class*="Value"]')  || parent.children[parent.children.length - 1];
      if (!labelEl || !valEl || labelEl === valEl) return;
      const label = labelEl.textContent?.trim().toLowerCase();
      const val   = parseInt(valEl.textContent?.replace(/[$,]/g, ''));
      if (!val || isNaN(val)) return;
      const map = { 'buy now': 'buy_now', 'buy it now': 'buy_now', 'current bid': 'current_bid', 'starting bid': 'starting_bid', 'mmr': 'mmr' };
      const field = map[label];
      if (field && !auction[field]) auction[field] = val;
    });

    const dateM = pageText.match(/sale\s*date[:\s]*([^\n]+)/i) || pageText.match(/auction\s*date[:\s]*([^\n]+)/i);
    if (dateM) auction.sale_date = dateM[1].trim();

    return Object.keys(auction).length > 1 ? auction : null;
  }

  function extractAdesaCondition() {
    const condition = { damage: [], options: [], announcements: [], packages: [], equipment: [] };
    const pageText = document.body.innerText || '';
    const isJunk = t => !t || t.length < 3 || t.length > 300 ||
      /\{|fill:|stroke|class=|<svg|^(sort|filter|type|condition|location|view|show|hide|close|cancel)$/i.test(t);

    // Damage items
    document.querySelectorAll('[class*="damage"],[class*="Damage"],[class*="defect"],[class*="Defect"],[data-testid*="damage"]').forEach(el => {
      if (el.children.length > 4) return;
      const t = el.textContent?.trim();
      if (!isJunk(t)) condition.damage.push(t);
    });
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
    condition.damage = [...new Set(condition.damage)].slice(0, 30);

    // Options / equipment
    document.querySelectorAll('[class*="option"],[class*="Option"],[class*="equipment"],[class*="Equipment"],[class*="feature"],[class*="Feature"]').forEach(el => {
      if (el.children.length > 8 || el.textContent.length > 5000) return;
      el.querySelectorAll('li, [class*="item"],[class*="Item"]').forEach(li => {
        const t = li.textContent?.trim();
        if (!isJunk(t) && li.children.length === 0) condition.options.push(t);
      });
    });
    condition.options = [...new Set(condition.options)].slice(0, 150);

    // Announcements
    document.querySelectorAll('[class*="announcement"],[class*="Announcement"],[class*="note"],[class*="Note"]').forEach(el => {
      if (el.children.length > 3) return;
      const t = el.textContent?.trim();
      if (!isJunk(t) && t.length > 5) condition.announcements.push(t);
    });
    condition.announcements = [...new Set(condition.announcements)].slice(0, 20);

    const gm = pageText.match(/(?:condition\s*grade|cr\s*grade|overall\s*grade)[:\s]*([0-9.]+)/i);
    if (gm) condition.overall_grade = gm[1];

    return condition;
  }

  function extractAdesaPhotos(vin) {
    // NOTE: carvana/vexgateway were previously in the block list from when
    // Carvana was a competitor. Carvana acquired ADESA in 2022 and now hosts
    // ADESA's vehicle photos at vexgateway.fastly.carvana.io. Don't block them.
    const junkRe = /logo|icon|avatar|sprite|banner|placeholder|flag|badge|chevron|arrow|check|star|\.svg|favicon|tracking|pixel|blank|drivehappy|extension-logo|\.js(\.gz)?(\?|$)|\.css(\.gz)?(\?|$)|\.html?(\?|$)|\.json(\?|$)|\.woff|\.ttf|\.eot|\/analytics?\/|\.analytics\.|\/authorize|\/auth(\?|\/)|\/oauth|sitecontext|\/chat\/|insight-tag|sentry|datadog|segment\.io|googletagmanager/i;
    const photoExtRe = /\.(jpg|jpeg|png|webp|gif|heic|heif)(\?|$)/i;
    // Known vehicle-photo CDN paths.
    const cdnRe = /(?:vehicleimages?|listing[\-_]?image|vehicle[\-_]?photo|gallery|cdn-photo|media\/photo|vexgateway\.fastly\.carvana\.io\/vex-)/i;

    function isPhotoUrl(v) {
      if (typeof v !== 'string' || v.length < 15 || !v.startsWith('http')) return false;
      if (junkRe.test(v)) return false;
      return photoExtRe.test(v) || cdnRe.test(v);
    }

    // Collect photo URLs from a JSON subtree (depth-limited)
    function collectPhotos(obj, out, depth = 0) {
      if (!obj || depth > 15 || typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        for (const item of obj) {
          if (isPhotoUrl(item)) out.add(item);
          else collectPhotos(item, out, depth + 1);
        }
        return;
      }
      for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (isPhotoUrl(v)) out.add(v);
        else if (v && typeof v === 'object') collectPhotos(v, out, depth + 1);
      }
    }

    // Walk JSON tree to find the node whose VIN matches, then collect only from it
    function findVehicleNode(obj, targetVin, depth = 0) {
      if (!obj || depth > 15 || typeof obj !== 'object') return null;
      if (Array.isArray(obj)) {
        for (const item of obj) {
          const r = findVehicleNode(item, targetVin, depth + 1);
          if (r) return r;
        }
        return null;
      }
      const objVin = String(obj.vin || obj.VIN || obj.vehicleVin || obj.vehicleIdentificationNumber || '').toUpperCase();
      if (objVin === targetVin) return obj;
      for (const k of Object.keys(obj)) {
        const r = findVehicleNode(obj[k], targetVin, depth + 1);
        if (r) return r;
      }
      return null;
    }

    const found = new Set();
    const vinUpper = vin.toUpperCase();

    // ── Strategy 1: Parse <script id="__NEXT_DATA__">, find the exact VIN node ──
    const nextDataEl = document.getElementById('__NEXT_DATA__');
    console.log('[BWA] __NEXT_DATA__ element:', nextDataEl ? 'found' : 'MISSING');
    if (nextDataEl) {
      try {
        const json = JSON.parse(nextDataEl.textContent);
        console.log('[BWA] __NEXT_DATA__ parsed OK, top-level keys:', Object.keys(json));
        const node = findVehicleNode(json, vinUpper);
        console.log('[BWA] VIN node found in JSON:', !!node);
        if (node) {
          collectPhotos(node, found);
          console.log('[BWA] S1-JSON photos:', found.size, [...found].slice(0, 2));
          if (found.size > 0) return [...found];
        }
      } catch (e) {
        console.log('[BWA] __NEXT_DATA__ parse error:', e.message);
      }

      // JSON parse failed or VIN node not found — VIN-filtered regex scan
      const text = nextDataEl.textContent || '';
      const hasVin = text.toUpperCase().includes(vinUpper);
      console.log('[BWA] VIN in __NEXT_DATA__ text:', hasVin);
      for (const m of text.matchAll(/"(https?:\/\/[^"\\]{15,})"/g)) {
        const url = m[1].replace(/\\u002F/g, '/').replace(/\\n/g, '').replace(/\\/g, '');
        if (url.toUpperCase().includes(vinUpper) && isPhotoUrl(url)) found.add(url);
      }
      console.log('[BWA] S1-regex VIN-filtered photos:', found.size);
      if (found.size > 0) return [...found];
    }

    // ── Strategy 2: DOM gallery — log all candidates to understand page structure ──
    const galSels = [
      '[data-testid*="photo"],[data-testid*="gallery"],[data-testid*="image-viewer"],[data-testid*="carousel"]',
      '[class*="photo-viewer"],[class*="photoViewer"],[class*="image-viewer"],[class*="imageViewer"]',
      '[class*="vehicle-photos"],[class*="vehiclePhotos"],[class*="listing-photo"],[class*="listingPhoto"]',
      '[class*="carousel"],[class*="gallery"],[class*="swiper"],[class*="slider"]',
    ];
    const candidates = [];
    for (const sel of galSels) {
      document.querySelectorAll(sel).forEach(container => {
        const imgs = [];
        container.querySelectorAll('img').forEach(img => {
          const src = img.src || img.dataset?.src || img.getAttribute('data-original') || img.srcset?.split(' ')?.[0] || '';
          if (!src || /svg|data:image/i.test(src)) return;
          if (img.naturalWidth > 0 && img.naturalWidth < 80) return;
          if (isPhotoUrl(src)) imgs.push(src);
        });
        if (imgs.length > 0) {
          candidates.push({ el: container, count: imgs.length, tag: container.tagName, testid: container.dataset?.testid || '', cls: container.className?.toString().slice(0, 60), imgs });
        }
      });
    }
    console.log('[BWA] S2 gallery candidates:', candidates.length);
    candidates.forEach((c, i) => console.log(`[BWA]   [${i}] count=${c.count} testid="${c.testid}" cls="${c.cls}" first="${c.imgs[0]?.slice(0,80)}"`));

    // Carvana CDN encodes listing id in the URL path: /vex-<N>/.
    // Group a URL list by that id and keep only the biggest cluster — drops the
    // "similar listings" carousel where every photo is a different vehicle.
    // Returns the input unchanged if no IDs are detected.
    function keepLargestCluster(urls, label) {
      const listingIdRe = /\/vex-(\d+)\//i;
      const clusters = {};
      for (const u of urls) {
        const m = u.match(listingIdRe);
        const id = m ? m[1] : '__noid__';
        (clusters[id] ||= []).push(u);
      }
      const keys = Object.keys(clusters);
      if (keys.length <= 1) return urls;
      const winner = keys.sort((a, b) => clusters[b].length - clusters[a].length)[0];
      console.log(`[BWA] ${label} clusters:`, keys.map(k => `${k}:${clusters[k].length}`).join(' '), '→ keeping', winner);
      return clusters[winner];
    }

    // Pick the one highest on the page (smallest offsetTop), breaking ties by count
    if (candidates.length > 0) {
      candidates.sort((a, b) => {
        const aTop = a.el.getBoundingClientRect().top + window.scrollY;
        const bTop = b.el.getBoundingClientRect().top + window.scrollY;
        return aTop !== bTop ? aTop - bTop : b.count - a.count;
      });
      const winnerImgs = keepLargestCluster(candidates[0].imgs, 'S2');
      console.log('[BWA] S2 winner: count=', candidates[0].count, 'top=', Math.round(candidates[0].el.getBoundingClientRect().top + window.scrollY), 'after cluster:', winnerImgs.length);
      // If the chosen container looks like a "similar listings" carousel (lots
      // of items, each a different listing → cluster collapse left very few),
      // skip S2 entirely and let S5 (perf timeline + cluster) try.
      if (winnerImgs.length >= 3) {
        winnerImgs.forEach(u => found.add(u));
        if (found.size > 0) return [...found];
      } else {
        console.log('[BWA] S2 looks like a similar-listings carousel — skipping to S5');
      }
    }

    // ── Strategy 3: background-image CSS (ADESA gallery uses this instead of <img>) ──
    // Walk all elements looking for inline or computed background-image with photo URLs
    const bgCandidates = [];
    document.querySelectorAll('*').forEach(el => {
      // Check inline style first (faster)
      const inline = el.style?.backgroundImage || '';
      const bg = inline || getComputedStyle(el).backgroundImage || '';
      if (!bg || bg === 'none') return;
      const m = bg.match(/url\(["']?(https?:\/\/[^"')]+)["']?\)/i);
      if (!m) return;
      const url = m[1];
      if (isPhotoUrl(url)) bgCandidates.push({ el, url });
    });
    console.log('[BWA] S3-bg-image candidates:', bgCandidates.length, bgCandidates.slice(0, 3).map(c => c.url.slice(0, 80)));
    bgCandidates.forEach(c => found.add(c.url));
    if (found.size > 0) return [...found];

    // ── Strategy 4: VIN in any img src or script tag ──
    document.querySelectorAll('img').forEach(img => {
      const src = img.src || img.dataset?.src || '';
      if (src.toUpperCase().includes(vinUpper) && isPhotoUrl(src)) found.add(src);
    });
    for (const s of document.querySelectorAll('script:not([src])')) {
      const text = s.textContent || '';
      if (!text.toUpperCase().includes(vinUpper)) continue;
      for (const m of text.matchAll(/"(https?:\/\/[^"\\]{15,})"/g)) {
        const url = m[1].replace(/\\u002F/g, '/').replace(/\\n/g, '').replace(/\\/g, '');
        if (url.toUpperCase().includes(vinUpper) && isPhotoUrl(url)) found.add(url);
      }
    }
    console.log('[BWA] S4-VIN-filter photos:', found.size);

    // ── Strategy 5: performance resource timeline — only entries the browser loaded as <img> ──
    // The old version accepted any URL whose host matched cdnRe (adesa.com),
    // which let analytics/auth/JS through and tried to upload them as photos.
    // We now require initiatorType==='img' AND a real image extension OR a
    // path that obviously names a vehicle/listing photo.
    try {
      const perfEntries = performance.getEntriesByType('resource');
      const photoPathRe = /(?:vehicle|listing|photo|image|gallery|media)s?[\-_/]/i;
      const perfPhotos = perfEntries
        .filter(e => e.initiatorType === 'img' || e.initiatorType === 'css')
        .map(e => e.name)
        .filter(u => u && !junkRe.test(u) && (photoExtRe.test(u) || photoPathRe.test(u)));
      console.log('[BWA] S5-perf photos:', perfPhotos.length, perfPhotos.slice(0, 4));

      // Drop "similar listings" mixins by clustering on Carvana vex-<N> id.
      let perfResult = keepLargestCluster(perfPhotos, 'S5');

      // Prefer the highest-resolution variant of each photo (drop width=400 if width=800 of same path exists).
      const byPath = {};
      for (const u of perfResult) {
        const path = u.split('?')[0];
        const widthM = u.match(/[?&]width=(\d+)/i);
        const w = widthM ? parseInt(widthM[1]) : 0;
        if (!byPath[path] || w > byPath[path].w) byPath[path] = { u, w };
      }
      perfResult = Object.values(byPath).map(v => v.u);

      // Prefer VIN-specific; otherwise keep cluster
      const vinPerf = perfResult.filter(u => u.toUpperCase().includes(vinUpper));
      const finalResult = vinPerf.length > 0 ? vinPerf : perfResult;
      finalResult.forEach(u => found.add(u));
      if (found.size > 0) return [...found];
    } catch (e) {}

    // Diagnostic: if nothing was found, dump a sample of what was on the page
    // so we can tell whether photos genuinely aren't there yet vs. our filter missed them.
    if (found.size === 0) {
      try {
        const imgCount = document.querySelectorAll('img').length;
        const sampleImgs = [...document.querySelectorAll('img')]
          .map(img => img.src || img.dataset?.src || '')
          .filter(s => s && !s.startsWith('data:'))
          .slice(0, 5);
        const perfImgs = performance.getEntriesByType('resource')
          .filter(e => e.initiatorType === 'img')
          .map(e => e.name)
          .slice(0, 8);
        console.log('[BWA] PHOTOS EMPTY — diagnostic:');
        console.log('[BWA]   <img> tags on page:', imgCount, 'sample srcs:', sampleImgs);
        console.log('[BWA]   perf <img> loads:', perfImgs);
        console.log('[BWA]   Try scrolling to the photo gallery, then click Scan again.');
      } catch (e) {}
    }

    return [...found];
  }

  // ── Bulk list-page scan (Manheim search results) ──
  function bulkScanManheimList() {
    const results = [];
    const seen = new Set();

    // Strategy 1: __NEXT_DATA__ — walk for arrays of vehicle objects
    function walkForListings(obj, depth) {
      if (!obj || depth > 12 || typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        const vehicleItems = obj.filter(item =>
          item && typeof item === 'object' &&
          String(item.vin || item.VIN || '').length === 17
        );
        if (vehicleItems.length >= 2) {
          for (const item of vehicleItems) {
            const vin = String(item.vin || item.VIN || '').toUpperCase();
            if (!vin || seen.has(vin)) continue;
            seen.add(vin);
            const mi = item.mileage || item.odometer || item.odometerReading || item.currentOdometer;
            const buyNow = item.buyNowPrice || item.buyItNowPrice || item.startingBid || item.price || item.currentBid;
            const photoArr = item.photos || item.images || item.imageUrls || [];
            results.push({
              vin,
              year: String(item.year || item.modelYear || ''),
              make: item.make || item.makeName || '',
              model: item.model || item.modelName || '',
              trim: item.trim || item.trimLevel || '',
              mileage: mi ? parseInt(String(mi).replace(/,/g, '')) : null,
              buy_now: buyNow ? parseInt(String(buyNow).replace(/[$,]/g, '')) : null,
              mmr: item.mmr || item.manheimMarketReport || null,
              exterior_color: item.exteriorColor || item.extColor || item.color || '',
              photos: Array.isArray(photoArr) ? photoArr.slice(0, 3) : [],
              source_url: item.href || item.url || window.location.href,
            });
          }
          return;
        }
        for (const item of obj) walkForListings(item, depth + 1);
        return;
      }
      for (const key of Object.keys(obj)) walkForListings(obj[key], depth + 1);
    }

    for (const s of document.querySelectorAll('script')) {
      const text = s.textContent || '';
      const nd = text.match(/__NEXT_DATA__\s*=\s*({[\s\S]+?});\s*(?:<\/script>|$)/)?.[1] ||
                 text.match(/window\.__(?:PRELOADED_STATE|INITIAL_STATE|STATE)__\s*=\s*({[\s\S]+?});\s*(?:<\/script>|$)/)?.[1];
      if (!nd) continue;
      try { walkForListings(JSON.parse(nd), 0); } catch (e) {}
      if (results.length > 0) break;
    }

    if (results.length > 0) return results;

    // Strategy 2: DOM VIN walk — Manheim loads listings via API after render,
    // so we find every valid VIN visible on the page and scrape its card context.
    const pageText = document.body.innerText || '';
    const VIN_RE = /\b([A-HJ-NPR-Z0-9]{17})\b/g;

    // Collect all valid VINs from page text
    const allVins = new Set();
    for (const m of pageText.matchAll(VIN_RE)) {
      if (vinCheckDigitValid(m[1])) allVins.add(m[1].toUpperCase());
    }

    // Also check data attributes (Manheim often puts vin in data-* or aria-* attrs)
    document.querySelectorAll('[data-vin],[data-vehicle-vin],[data-listing-vin]').forEach(el => {
      const vin = (el.dataset.vin || el.dataset.vehicleVin || el.dataset.listingVin || '').toUpperCase();
      if (vin.length === 17 && vinCheckDigitValid(vin)) allVins.add(vin);
    });

    for (const vin of allVins) {
      if (seen.has(vin)) continue;
      seen.add(vin);

      // Find the element containing this VIN and walk up to the card container
      let cardEl = null;
      for (const el of document.querySelectorAll('*')) {
        if (el.children.length > 0) continue;
        const t = el.textContent?.trim() || '';
        if (t === vin || t.includes(vin)) {
          let parent = el.parentElement;
          for (let i = 0; i < 8; i++) {
            if (!parent) break;
            // Card container heuristic: contains enough text, not too wide
            if (parent.textContent.length > 80 && parent.textContent.length < 8000 &&
                (parent.querySelectorAll('img').length > 0 ||
                 /card|listing|result|vehicle|item/i.test(parent.className + parent.id))) {
              cardEl = parent;
              break;
            }
            parent = parent.parentElement;
          }
          if (cardEl) break;
          // Fallback: just use the closest block parent with decent content
          let p = el.parentElement;
          for (let i = 0; i < 5; i++) {
            if (!p) break;
            if (p.textContent.length > 60) { cardEl = p; break; }
            p = p.parentElement;
          }
          break;
        }
      }

      const ctx = cardEl?.textContent || '';

      // Year
      const yearM = ctx.match(/\b(20[12][0-9])\b/);
      const year = yearM ? yearM[1] : '';

      // Model (R1T / R1S are the only Rivian models)
      const model = /\bR1T\b/.test(ctx) ? 'R1T' : /\bR1S\b/.test(ctx) ? 'R1S' : '';

      // Trim — words after model name before newline/price
      let trim = '';
      const trimM = ctx.match(/R1[TS]\s+([A-Za-z][A-Za-z0-9 \-]{2,30}?)(?:\n|\$|[0-9]{2,3},)/);
      if (trimM) trim = trimM[1].trim();

      // Mileage — comma-formatted number followed by "mi" or standalone large number near "mi"
      const miM = ctx.match(/([0-9]{1,3}(?:,[0-9]{3})+)\s*(?:mi|miles|km)/i) ||
                  ctx.match(/([0-9]{4,6})\s*(?:mi|miles|km)/i);
      const mileage = miM ? parseInt(miM[1].replace(/,/g, '')) : null;

      // Buy now / bid price — look for dollar amounts
      const prices = [...ctx.matchAll(/\$\s*([0-9]{1,3}(?:,[0-9]{3})+)/g)]
        .map(m => parseInt(m[1].replace(/,/g, '')))
        .filter(n => n > 5000 && n < 300000)
        .sort((a, b) => b - a);
      const buy_now = prices[0] || null;

      // MMR — look for "MMR" label near a price
      const mmrM = ctx.match(/MMR[:\s]*\$?\s*([0-9]{1,3}(?:,[0-9]{3})+)/i);
      const mmr = mmrM ? parseInt(mmrM[1].replace(/,/g, '')) : null;

      // Exterior color — common color words
      const colorM = ctx.match(/\b(Black|White|Silver|Gray|Grey|Blue|Red|Green|Yellow|Orange|Brown|Beige|Gold|Purple|Tan|Limestone|El Cap|Forest|Rivian Blue|Rivian Green|Glacier|Compass|Launch)\b/i);
      const exterior_color = colorM ? colorM[1] : '';

      // Photos from card images
      const photos = [];
      if (cardEl) {
        cardEl.querySelectorAll('img').forEach(img => {
          const src = img.src || img.dataset?.src || '';
          if (src && /\.(jpg|jpeg|png|webp)/i.test(src) && !/logo|icon|placeholder/i.test(src))
            photos.push(src.replace(/\?.*$/, ''));
        });
      }

      results.push({ vin, year, make: 'Rivian', model, trim, mileage, buy_now, mmr, exterior_color, photos: photos.slice(0, 3), source_url: window.location.href });
    }

    return results;
  }

  function runExtraction() {
    // If the extension was reloaded while this tab was open, chrome.runtime.id
    // becomes undefined. Disconnect the observer so we stop firing entirely.
    if (!chrome.runtime?.id) {
      try { observer.disconnect(); } catch (e) {}
      return;
    }

    const url = window.location.href;
    const isManheim = url.includes('manheim.com') || url.includes('insightcr');
    const isAdesa   = url.includes('adesa.com') || url.includes('openlane.com');
    if (!isManheim && !isAdesa) return;

    const isInsightCR = url.includes('insightcr.manheim.com') || url.includes('cr-display');
    const isLiveListing = !isInsightCR && (url.includes('search.manheim.com') || url.includes('/results') || url.includes('/listing'));

    // For ADESA/OpenLane, use text-based VIN detection to avoid picking up related-vehicle VINs from JSON
    const vin = isAdesa ? (getAdesaVin() || getVin()) : getVin();

    // On Manheim search/results pages with no single VIN, try bulk list scan
    if (!vin && isManheim) {
      const listings = bulkScanManheimList();
      if (listings.length > 0) {
        try {
          chrome.storage.local.set({ bwa_list_scan: { listings, url, extracted_at: new Date().toISOString() } });
        } catch (e) {}
        console.log('[BWA] Found', listings.length, 'listings on list page');
        try { chrome.runtime.sendMessage({ action: 'listScanReady', count: listings.length }).catch(() => {}); } catch (e) {}
      }
      return;
    }

    if (!vin) return; // Nothing to extract without a VIN

    const vehicle   = isAdesa ? extractAdesaSpecs()     : extractSpecs();
    const condition = isAdesa ? extractAdesaCondition() : extractCondition();
    const auction   = isAdesa ? extractAdesaAuction()   : extractAuction();
    const photos    = isAdesa ? extractAdesaPhotos(vin) : extractPhotos();

    const page_type = isAdesa
      ? (url.includes('openlane.com') ? 'openlane_listing' : 'adesa_listing')
      : (isInsightCR ? 'insight_cr' : isLiveListing ? 'live_listing' : 'condition_report');

    const data = {
      vin,
      vehicle,
      condition,
      auction,
      photos,
      page_type,
      source_url: url,
      source_title: document.title,
      extracted_at: new Date().toISOString(),
    };

    // Cache by VIN so popup can read it
    try {
      chrome.storage.local.set({ [`bwa_scan_${vin}`]: data, bwa_last_scan: data });
    } catch (e) {
      console.warn('[BWA] Storage unavailable (extension reloaded?):', e.message);
      return;
    }
    console.log('[BWA] Extracted data for', vin, data);

    // Notify popup if open
    try { chrome.runtime.sendMessage({ action: 'scanReady', data }).catch(() => {}); } catch (e) {}

    // For ADESA: upload photos from browser context immediately (CDN requires auth cookies)
    if (isAdesa && photos.length > 0) {
      uploadAdesaPhotosInBackground(photos, vin);
    }

    // For ADESA: if photos came back empty, retry every 2s (gallery loads asynchronously)
    if (isAdesa && photos.length === 0) {
      let attempts = 0;
      const photoRetry = setInterval(() => {
        attempts++;
        const retryPhotos = extractAdesaPhotos(vin);
        console.log('[BWA] ADESA photo retry', attempts, '— found:', retryPhotos.length);
        if (retryPhotos.length > 0 || attempts >= 6) {
          clearInterval(photoRetry);
          if (retryPhotos.length > 0) {
            data.photos = retryPhotos;
            try { chrome.storage.local.set({ [`bwa_scan_${vin}`]: data, bwa_last_scan: data }); } catch (e) {}
            try { chrome.runtime.sendMessage({ action: 'scanReady', data }).catch(() => {}); } catch (e) {}
            console.log('[BWA] ADESA photos found on retry', attempts, ':', retryPhotos.length);
            uploadAdesaPhotosInBackground(retryPhotos, vin);
          }
        }
      }, 2000);
    }
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
    if (msg.action === 'bulkScan') {
      const listings = bulkScanManheimList();
      sendResponse({ listings, count: listings.length });
    }
    return true; // keep channel open for async sendResponse
  });

  // Upload ADESA photos from browser context (has auth cookies) to server → Supabase permanent URLs.
  // Runs in background; updates scan data with permanent URLs when done.
  // Tracks in-flight uploads per VIN so a second call doesn't duplicate work.
  const uploadInFlight = new Set();

  async function uploadAdesaPhotosInBackground(photoUrls, vin) {
    if (uploadInFlight.has(vin)) {
      console.log('[BWA] Upload already in flight for', vin, '— skipping duplicate');
      return;
    }
    uploadInFlight.add(vin);
    console.log('[BWA] uploadAdesaPhotosInBackground called:', photoUrls.length, 'URLs, VIN:', vin);

    const key = `bwa_scan_${vin}`;

    // Push a progress snapshot to storage + notify popup. status: 'uploading' | 'done' | 'failed'.
    async function pushProgress(uploaded, total, status, photosForPopup) {
      try {
        const result = await new Promise(resolve => chrome.storage.local.get([key], resolve));
        const data = result[key];
        if (!data) return;
        data.upload_status = status;
        data.upload_progress = { uploaded, total };
        if (photosForPopup) data.photos = photosForPopup;
        chrome.storage.local.set({ [key]: data, bwa_last_scan: data });
        try { chrome.runtime.sendMessage({ action: 'scanReady', data }).catch(() => {}); } catch (e) {}
      } catch (e) { console.warn('[BWA] pushProgress failed:', e.message); }
    }

    try {
      const stored = await new Promise(resolve => chrome.storage.local.get(['serverUrl', 'apiKey'], resolve));
      const serverUrl = (stored.serverUrl || 'https://bigwaveauto.com').replace(/\/+$/, '');
      const apiKey = stored.apiKey;
      if (!apiKey) {
        console.warn('[BWA] No API key in storage — cannot upload photos');
        await pushProgress(0, photoUrls.length, 'failed', photoUrls);
        return;
      }

      const top20 = photoUrls.slice(0, 20);
      console.log('[BWA] Uploading', top20.length, 'ADESA photos in parallel...');
      await pushProgress(0, top20.length, 'uploading', photoUrls);

      // Hard timeout per photo — without this, a stuck request hangs the whole batch
      // and the popup never leaves "Uploading... 0 of N". 15s is plenty for a cached image.
      function withTimeout(promise, ms, label) {
        return Promise.race([
          promise,
          new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms)),
        ]);
      }

      async function uploadOne(url, i) {
        const shortUrl = url.length > 80 ? url.slice(0, 80) + '...' : url;
        try {
          // Use the browser's default credentials handling. credentials:'include'
          // fights ADESA's `Access-Control-Allow-Origin: *` responses, which the
          // CORS spec forbids combining with credentials — every public-image
          // request would fail outright.
          const imgRes = await withTimeout(
            fetch(url),
            15000,
            `photo ${i} fetch`
          );
          if (!imgRes.ok) { console.warn('[BWA] Photo', i, `fetch ${imgRes.status} ${imgRes.statusText}`, shortUrl); return null; }
          const ct = imgRes.headers.get('content-type') || '';
          if (!ct.startsWith('image/')) { console.warn('[BWA] Photo', i, `non-image content-type "${ct}"`, shortUrl); return null; }
          const blob = await imgRes.blob();
          if (blob.size < 2000) { console.warn('[BWA] Photo', i, `too small (${blob.size}B)`, shortUrl); return null; }

          const form = new FormData();
          form.append('photo', blob, `photo_${i}.jpg`);
          form.append('storageKey', vin);

          const uploadRes = await withTimeout(
            fetch(`${serverUrl}/api/ext/photo-upload`, {
              method: 'POST',
              headers: { 'X-API-Key': apiKey },
              body: form,
            }),
            20000,
            `photo ${i} upload`
          );
          if (!uploadRes.ok) {
            const body = await uploadRes.text().catch(() => '');
            console.warn('[BWA] Photo', i, `server ${uploadRes.status}`, body.slice(0, 120));
            return null;
          }
          const { url: permanentUrl } = await uploadRes.json();
          return permanentUrl;
        } catch (e) {
          console.warn('[BWA] Photo', i, 'failed:', e.message, shortUrl);
          return null;
        }
      }

      const permanent = [];
      const BATCH = 5;
      for (let i = 0; i < top20.length; i += BATCH) {
        const batch = top20.slice(i, i + BATCH);
        const results = await Promise.all(batch.map((url, j) => uploadOne(url, i + j)));
        for (const u of results) if (u) permanent.push(u);
        // After each batch, push progress so popup unsticks immediately
        await pushProgress(permanent.length, top20.length, 'uploading',
          permanent.length ? [...permanent, ...photoUrls.slice(permanent.length)] : photoUrls);
      }

      if (permanent.length === 0) {
        console.warn('[BWA] 0 of', top20.length, 'photos uploaded — CDN may require auth. Server will rehost on submit.');
        await pushProgress(0, top20.length, 'failed', photoUrls);
        return;
      }

      console.log('[BWA] Uploaded', permanent.length, 'of', top20.length, 'ADESA photos to Supabase');
      await pushProgress(permanent.length, top20.length, 'done', permanent);
    } catch (e) {
      console.warn('[BWA] Background photo upload failed:', e.message);
      try { await pushProgress(0, photoUrls.length, 'failed', photoUrls); } catch {}
    } finally {
      uploadInFlight.delete(vin);
    }
  }

  // Listen for photo URLs relayed from adesa-interceptor.js (manifest MAIN-world script).
  // Accumulate across multiple API calls (gallery may load in batches).
  window.addEventListener('__bwa_photos__', (e) => {
    const newUrls = (e.detail || []).filter(u => !/logo|icon|placeholder|carvana|vexgate/i.test(u));
    if (!newUrls.length) return;
    console.log('[BWA] Fetch-intercepted photos:', newUrls.length, newUrls[0]?.slice(0, 80));
    const vin = getVin();
    if (!vin) return;
    const key = `bwa_scan_${vin}`;
    chrome.storage.local.get([key], (result) => {
      const data = result[key] || { vin, photos: [], vehicle: {}, condition: {}, auction: {}, page_type: 'adesa_listing', source_url: window.location.href, extracted_at: new Date().toISOString() };
      // Merge — deduplicate by URL
      const merged = [...new Set([...(data.photos || []), ...newUrls])];
      if (merged.length === (data.photos || []).length) return; // nothing new
      data.photos = merged;
      try { chrome.storage.local.set({ [key]: data, bwa_last_scan: data }); } catch (e) {}
      try { chrome.runtime.sendMessage({ action: 'scanReady', data }).catch(() => {}); } catch (e) {}
      console.log('[BWA] Scan now has', merged.length, 'photos for', vin, '— uploading to Supabase...');
      // Upload in background using browser's auth cookies
      uploadAdesaPhotosInBackground(merged, vin);
    });
  });

  // Inject the floating button once DOM is ready
  if (document.body) injectButton();
  else document.addEventListener('DOMContentLoaded', injectButton);

})();
