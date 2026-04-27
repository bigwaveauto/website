// Content script — runs on Manheim pages
// Adds a floating "Grab Photos" button for quick access

(function() {
  // Don't inject twice
  if (document.getElementById('bwa-grab-btn')) return;

  const btn = document.createElement('button');
  btn.id = 'bwa-grab-btn';
  btn.innerHTML = '📷 BWA';
  btn.title = 'Big Wave Auto — Grab Photos';
  Object.assign(btn.style, {
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    zIndex: '999999',
    padding: '10px 16px',
    background: '#1e293b',
    color: 'white',
    border: 'none',
    borderRadius: '10px',
    fontSize: '13px',
    fontWeight: '800',
    fontFamily: '-apple-system, sans-serif',
    cursor: 'pointer',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    transition: 'transform 0.15s, background 0.15s',
  });

  btn.addEventListener('mouseenter', () => { btn.style.transform = 'scale(1.05)'; btn.style.background = '#334155'; });
  btn.addEventListener('mouseleave', () => { btn.style.transform = 'scale(1)'; btn.style.background = '#1e293b'; });

  btn.addEventListener('click', () => {
    // Open the extension popup (can't programmatically open popup, so just notify)
    chrome.runtime.sendMessage({ action: 'openPopup' });
    btn.textContent = 'Open extension popup ↗';
    setTimeout(() => { btn.innerHTML = '📷 BWA'; }, 3000);
  });

  document.body.appendChild(btn);
})();

// Listen for messages from popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'ping') {
    sendResponse({ ready: true });
  }
});
