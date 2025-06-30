let isTracking = false;
let currentTabId = null;
let currentDomain = null;
let currentURL = null;
let startTime = null;
let usageData = {};

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  if (!isTracking) return;
  const tab = await chrome.tabs.get(activeInfo.tabId);
  handleTabChange(tab);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!isTracking || tabId !== currentTabId || !changeInfo.url) return;
  handleTabChange(tab);
});

function handleTabChange(tab) {
  const now = Date.now();
  if (currentTabId !== null && startTime !== null) {
    const duration = now - startTime;
    const domain = new URL(currentURL).hostname;
    usageData[domain] = usageData[domain] || { total: 0, urls: {} };
    usageData[domain].total += duration;
    usageData[domain].urls[currentURL] = (usageData[domain].urls[currentURL] || 0) + duration;
  }
  currentTabId = tab.id;
  currentURL = tab.url;
  currentDomain = new URL(tab.url).hostname;
  startTime = now;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "TOGGLE_TRACKING") {
    isTracking = !isTracking;
    if (isTracking) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length > 0) handleTabChange(tabs[0]);
      });
    } else {
      handleTabChange({ id: currentTabId, url: currentURL });

      // En lugar de enviar a una API, mostrar en consola:
      console.log("⏱ Reporte de actividad:", usageData);

      usageData = {};
    }
    sendResponse({ tracking: isTracking });
  } else if (message.type === "GET_TRACKING_STATUS") {
    sendResponse({ tracking: isTracking });
  }
});
