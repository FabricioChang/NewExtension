// popup_tabs.js

let donutChart, // guardamos la instancia para actualizarla
    pollInterval;

document.addEventListener("DOMContentLoaded", () => {
  console.log("📊 Popup cargado");

  // pestañas
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.add("hidden"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.tab).classList.remove("hidden");
    });
  });

  // arrancamos el polling cada segundo
  fetchAndRender();
  pollInterval = setInterval(fetchAndRender, 1000);

  // al cerrar el popup, limpiamos el interval
  window.addEventListener("unload", () => clearInterval(pollInterval) );

  // exportar CSV
  const exportBtn = document.getElementById("exportBtn");
  if (exportBtn) {
    exportBtn.addEventListener("click", () => {
      console.log("📥 Exportar CSV pedido");
      chrome.runtime.sendMessage("export_csv", () => {
        console.log("✔️ Exportación completada");
      });
    });
  }
});

function fetchAndRender() {
  chrome.runtime.sendMessage("get_activity_data", data => {
    if (!data || !Array.isArray(data.summary)) return;
    console.log("🔄 Datos refrescados:", data.summary);

    const labels   = data.summary.map(x => x.domain);
    const sessions = data.summary.map(x => x.sessions);
    const durations= data.summary.map(x => x.duration);

    // donut
    if (!donutChart) {
      // primera vez, creamos el chart
      donutChart = new Chart(document.getElementById("donutChart"), {
        type: "doughnut",
        data:      { labels, datasets: [{ data: durations }] },
        options:   { responsive: true, maintainAspectRatio: false }
      });
    } else {
      // simplemente actualizamos sus datos
      donutChart.data.labels    = labels;
      donutChart.data.datasets[0].data = durations;
      donutChart.update();
    }

    // lista de tiempos
    renderTimeList(data.summary);
  });
}

function renderTimeList(summary) {
  const ul = document.getElementById("timeList");
  ul.innerHTML = "";
  summary.forEach(item => {
    const li = document.createElement("li");
    li.className = "time-item";

    const domainSpan = document.createElement("span");
    domainSpan.textContent = item.domain;

    const timeSpan = document.createElement("span");
    timeSpan.textContent = formatDuration(item.duration);

    li.appendChild(domainSpan);
    li.appendChild(timeSpan);
    ul.appendChild(li);
  });
}

// Convierte segundos en HH:MM:SS
function formatDuration(totalSeconds) {
  const sec = Math.floor(totalSeconds % 60);
  const min = Math.floor((totalSeconds / 60) % 60);
  const hr  = Math.floor(totalSeconds / 3600);
  const pad = n => String(n).padStart(2, "0");
  return `${pad(hr)}:${pad(min)}:${pad(sec)}`;
}
