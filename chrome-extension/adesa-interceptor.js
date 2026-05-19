// Runs at document_start in MAIN world on ADESA/OpenLane pages.
// Patches window.fetch before any page JS runs, relays photo URLs to content.js via CustomEvent.
(function () {
  if (window.__BWA_FETCH__) return;
  window.__BWA_FETCH__ = true;

  function isImg(u) {
    return typeof u === 'string' && u.length > 20 && u.startsWith('http') &&
      /\.(jpg|jpeg|png|webp)(\?|$)/i.test(u) &&
      !/logo|icon|placeholder|carvana|vexgate|tracking|pixel/i.test(u);
  }

  function scanForPhotos(obj, results, depth) {
    if (!obj || depth > 15 || typeof obj !== 'object') return;
    const items = Array.isArray(obj) ? obj : Object.values(obj);
    for (const v of items) {
      if (isImg(v)) results.push(v);
      else if (v && typeof v === 'object') scanForPhotos(v, results, depth + 1);
    }
  }

  const origFetch = window.fetch.bind(window);
  window.fetch = function (...args) {
    return origFetch(...args).then(function (response) {
      const ct = response.headers.get('content-type') || '';
      if (ct.includes('json')) {
        response.clone().json().then(function (json) {
          const urls = [];
          scanForPhotos(json, urls, 0);
          if (urls.length > 0) {
            window.dispatchEvent(new CustomEvent('__bwa_photos__', { detail: urls }));
          }
        }).catch(function () {});
      }
      return response;
    });
  };
})();
