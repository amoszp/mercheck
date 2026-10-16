// Apply the saved theme before first paint so the app never flashes the
// default palette. Keep in sync with src/lib/settings.js.
try {
  var saved = JSON.parse(localStorage.getItem('mercheck-settings') || localStorage.getItem('mercheck-hub-settings'));
  if (saved && saved.theme === 'rose') {
    document.documentElement.dataset.theme = 'rose';
    document.querySelector('meta[name="theme-color"]').setAttribute('content', '#f5eee3');
  }
} catch (e) {}
