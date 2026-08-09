// R.O.T.O.M. — Service Worker
// Handles token revocation on install and other background events.

chrome.runtime.onInstalled.addListener(() => {
  console.log('R.O.T.O.M. installed.');
});
