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

    // Strategy 4: Tight regex fallbacks
    const pageText = document.body.innerText || '';
    if (!vehicle.mileage) {
      const m = pageText.match(/(?:odometer(?:\s*reading)?|mileage)[^\d]*([0-9,]+)\s*(?:mi|miles)?/i)
             || pageText.match(/([0-9]{3,3}[0-9,]+)\s*(?:miles|mi)\b/i);
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
    // Extension-required pattern for generic URLs
    const photoExtRe = /https?:\/\/.+\.(jpg|jpeg|png|webp)/i;
    // CDN domain pattern — no extension required (ADESA/Cox CDN serves extension-free URLs)
    const adesaCdnRe = /https?:\/\/[^"'\s]*(?:adesa\.com|openlane\.com|coxautoinc\.com|cloudfront\.net|auctionaccess\.com|kbb\.com)[^"'\s<>]*/i;
    const junkRe = /logo|icon|avatar|sprite|banner|placeholder|flag|badge|chevron|arrow|check|star|thumb(?!nail)|\.svg/i;

    function isPhotoUrl(v) {
      if (typeof v !== 'string' || !v.startsWith('http')) return false;
      if (junkRe.test(v)) return false;
      return photoExtRe.test(v) || adesaCdnRe.test(v);
    }

    // Walk the entire subtree and collect all string values that look like photo URLs
    function collectPhotos(obj, out, depth = 0) {
      if (!obj || depth > 10 || typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        for (const item of obj) {
          if (isPhotoUrl(item)) out.add(item.replace(/\?.*$/, ''));
          else collectPhotos(item, out, depth + 1);
        }
        return;
      }
      for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (isPhotoUrl(v)) out.add(v.replace(/\?.*$/, ''));
        else if (v && typeof v === 'object') collectPhotos(v, out, depth + 1);
      }
    }

    // Walk JSON tree; when we find the vehicle object matching this VIN (with year/make
    // alongside it), collect only from that node — not from the whole tree.
    function findVehiclePhotos(obj, targetVin, out, depth = 0) {
      if (!obj || depth > 10 || typeof obj !== 'object') return false;
      const objVin = String(obj.vin || obj.VIN || obj.vehicleVin || '').toUpperCase();
      if (objVin === targetVin && (obj.year || obj.modelYear || obj.make || obj.model)) {
        collectPhotos(obj, out, 0);
        return true;
      }
      for (const k of Object.keys(obj)) {
        if (findVehiclePhotos(obj[k], targetVin, out, depth + 1)) return true;
      }
      return false;
    }

    // Strategy 1: find the vehicle object in __NEXT_DATA__ by VIN and collect its photos
    const found = new Set();
    for (const s of document.querySelectorAll('script')) {
      const text = s.textContent || '';
      const nd = text.match(/__NEXT_DATA__\s*=\s*({[\s\S]+?});\s*(?:<\/script>|$)/)?.[1] ||
                 text.match(/window\.__(?:PRELOADED_STATE|INITIAL_STATE|STATE)__\s*=\s*({[\s\S]+?});\s*(?:<\/script>|$)/)?.[1];
      if (!nd) continue;
      try {
        if (findVehiclePhotos(JSON.parse(nd), vin.toUpperCase(), found)) break;
      } catch (e) {}
    }
    if (found.size > 0) return [...found];

    // Strategy 2: DOM — look for the tightest gallery container and grab images from it.
    const galSels = [
      '[data-testid*="photo"],[data-testid*="gallery"],[data-testid*="image-viewer"]',
      '[class*="photo-viewer"],[class*="photoViewer"],[class*="image-viewer"],[class*="imageViewer"]',
      '[class*="vehicle-photos"],[class*="vehiclePhotos"],[class*="listing-photo"],[class*="listingPhoto"]',
    ];
    for (const sel of galSels) {
      const container = document.querySelector(sel);
      if (!container) continue;
      container.querySelectorAll('img').forEach(img => {
        const src = img.src || img.dataset?.src || img.getAttribute('data-original') || '';
        if (!src || /svg|data:image/i.test(src)) return;
        if (img.naturalWidth > 0 && img.naturalWidth < 80) return;
        if (isPhotoUrl(src)) found.add(src.replace(/\?.*$/, ''));
      });
      if (found.size > 1) return [...found];
    }

    // Strategy 3: VIN-in-URL filter — any image/URL that contains the VIN is this vehicle.
    if (found.size === 0) {
      const vinUpper = vin.toUpperCase();
      document.querySelectorAll('img').forEach(img => {
        const src = img.src || '';
        if (src.toUpperCase().includes(vinUpper) && isPhotoUrl(src))
          found.add(src.replace(/\?.*$/, ''));
      });
      for (const s of document.querySelectorAll('script')) {
        const text = s.textContent || '';
        if (!text.toUpperCase().includes(vinUpper)) continue;
        // Match quoted URLs from CDN domains or with photo extensions
        for (const m of text.matchAll(/"(https?:\/\/[^"]{10,})"/g)) {
          if (m[1].toUpperCase().includes(vinUpper) && isPhotoUrl(m[1]))
            found.add(m[1].replace(/\?.*$/, ''));
        }
      }
    }

    return [...found];
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

    const vin = getVin();
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
