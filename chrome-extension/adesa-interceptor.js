// Runs at document_start in MAIN world on ADESA/OpenLane pages.
// Patches window.fetch + XHR before any page JS runs, relays photo URLs to content.js via CustomEvent.
// Also increases the performance resource timing buffer so S5 photo detection doesn't lose entries.
(function () {
  if (window.__BWA_FETCH__) return;
  window.__BWA_FETCH__ = true;

  // Prevent photos from falling off the perf timeline as more JS/CSS loads
  try { performance.setResourceTimingBufferSize(1000); } catch(e) {}

  const JUNK = /logo|icon|placeholder|carvana|vexgate|tracking|pixel|\.js(\?|$)|\.css(\?|$)|\.svg(\?|$)|\.woff|\.ttf|\.eot/i;

  function isImg(u) {
    if (typeof u !== 'string' || u.length < 20 || !u.startsWith('http')) return false;
    if (JUNK.test(u)) return false;
    // Image extension (covers most CDN signed URLs)
    if (/\.(jpg|jpeg|png|webp)(\?|$)/i.test(u)) return true;
    // Known vehicle image CDN domains/paths without extension
    if (/(?:adesa|openlane|coxauto)\.com\/(?:images?|photos?|media|vehicle|listing)/i.test(u)) return true;
    if (/cloudfront\.net\/[^?#]*(?:vehicle|photo|image|listing)/i.test(u)) return true;
    if (/s3(?:[-.][\w-]+)?\.amazonaws\.com\/[^?#]*(?:vehicle|photo|image)/i.test(u)) return true;
    if (/vehicle[\-_]?images?\.|auction[\-_]?images?\.|listing[\-_]?images?\./i.test(u)) return true;
    return false;
  }

  function scanForPhotos(obj, results, depth) {
    if (!obj || depth > 15 || typeof obj !== 'object') return;
    const items = Array.isArray(obj) ? obj : Object.values(obj);
    for (const v of items) {
      if (isImg(v)) results.push(v);
      else if (v && typeof v === 'object') scanForPhotos(v, results, depth + 1);
    }
  }

  function emit(urls) {
    if (urls.length > 0)
      window.dispatchEvent(new CustomEvent('__bwa_photos__', { detail: urls }));
  }

  // ── Intercept fetch ──
  const origFetch = window.fetch.bind(window);
  window.fetch = function (...args) {
    return origFetch(...args).then(function (response) {
      const ct = response.headers.get('content-type') || '';
      if (ct.includes('json')) {
        response.clone().json().then(function (json) {
          const urls = [];
          scanForPhotos(json, urls, 0);
          emit(urls);
        }).catch(function () {});
      }
      return response;
    });
  };

  // ── Intercept XHR ── (ADESA/OpenLane may use XHR instead of fetch for image data)
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__bwa_url__ = url;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener('load', function () {
      try {
        const ct = this.getResponseHeader('content-type') || '';
        if (ct.includes('json') && this.responseText) {
          const json = JSON.parse(this.responseText);
          const urls = [];
          scanForPhotos(json, urls, 0);
          emit(urls);
        }
      } catch (e) {}
    });
    return origSend.apply(this, arguments);
  };
})();
