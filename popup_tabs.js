// popup_tabs.js

document.addEventListener("DOMContentLoaded", () => {
  console.log("📊 Popup cargado");

  // Manejo de pestañas
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.add("hidden"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.tab).classList.remove("hidden");
    });
  });

  // Petición de datos al background
  chrome.runtime.sendMessage("get_activity_data", data => {
    console.log("🔥 Datos recibidos en popup:", data);
    if (!data || !Array.isArray(data.summary)) return;

    const labels = data.summary.map(x => x.domain);
    const durations = data.summary.map(x => x.duration);
    const sessions = data.summary.map(x => x.sessions);

    renderDonut(labels, durations);
    renderBar(labels, sessions, durations);
  });

  // Botón Exportar
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

function renderDonut(labels, data) {
  new Chart(document.getElementById("donutChart"), {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: ["#00f9ff", "#ff00e6", "#fbff00", "#8c00ff", "#00ff8c"],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: "#e6e6e6" } } }
    }
  });
}

function renderBar(labels, sessions, durations) {
  new Chart(document.getElementById("barChart"), {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Sesiones", data: sessions, backgroundColor: "#00f9ff" },
        { label: "Tiempo (s)", data: durations, backgroundColor: "#ff00e6" }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { color: "#e6e6e6" }, grid: { color: "#ffffff22" } },
        y: { beginAtZero: true, ticks: { color: "#e6e6e6" }, grid: { color: "#ffffff22" } }
      },
      plugins: { legend: { labels: { color: "#e6e6e6" } } }
    }
  });
}
