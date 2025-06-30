document.getElementById("toggleBtn").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "TOGGLE_TRACKING" }, (response) => {
    document.getElementById("toggleBtn").textContent = response.tracking ? "Stop" : "Start";
  });
});

window.onload = () => {
  chrome.runtime.sendMessage({ type: "GET_TRACKING_STATUS" }, (response) => {
    document.getElementById("toggleBtn").textContent = response.tracking ? "Stop" : "Start";
  });
};