// popup_tabs.js

let donutChart;

document.addEventListener("DOMContentLoaded", () => {
  console.log("📊 Popup cargado");

  // --- Pestañas ---
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.add("hidden"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.tab).classList.remove("hidden");
    });
  });

  // --- Chart vacío ---
  const ctx = document.getElementById("donutChart").getContext("2d");
  donutChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: [],
      datasets: [{ data: [], backgroundColor: [], borderColor: [] }]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });

  // --- Polling de datos ---
  fetchAndRender();
  const interval = setInterval(fetchAndRender, 1000);
  window.addEventListener("unload", () => clearInterval(interval));

  // --- Exportar CSV (solo llama al background) ---
  document.getElementById("exportBtn").addEventListener("click", () => {
    chrome.runtime.sendMessage("export_csv", () => {
      console.log("✔️ Exportación completada");
      fetchAndRender();
    });
  });

  // --- Cambiar usuario en caliente ---
  document.getElementById("changeUserBtn").addEventListener("click", () => {
    chrome.storage.local.get("userPrefix", data => {
      const current = data.userPrefix || "";
      const prefix  = prompt("Ingresa tu ID (sin @bancoguayaquil.com):", current);
      if (prefix !== null) {
        chrome.storage.local.set({ userPrefix: prefix.trim() });
        alert(`Ahora usaré: ${prefix.trim()}@bancoguayaquil.com`);
      }
    });
  });
});

function fetchAndRender() {
  chrome.runtime.sendMessage("get_activity_data", data => {
    if (!data || !Array.isArray(data.summary)) return;

    const labels    = data.summary.map(x => x.domain);
    const durations = data.summary.map(x => x.duration);

    // Colores HSL equiespaciados
    const bgColors = labels.map((_, i) => {
      const hue = Math.round(360 * i / labels.length);
      return `hsl(${hue}, 70%, 50%)`;
    });

    donutChart.data.labels                      = labels;
    donutChart.data.datasets[0].data            = durations;
    donutChart.data.datasets[0].backgroundColor = bgColors;
    donutChart.data.datasets[0].borderColor     = bgColors.map(c => {
      const [ , h, s, l ] = c.match(/hsl\((\d+),\s*([\d.]+)%,\s*([\d.]+)%\)/).map(Number);
      return `hsl(${h}, ${s}%, ${Math.max(0, l - 10)}%)`;
    });
    donutChart.update();

    renderTimeList(data.summary, bgColors);
  });
}

function renderTimeList(summary, colors) {
  const ul = document.getElementById("timeList");
  ul.innerHTML = "";
  summary.forEach((item, i) => {
    const li = document.createElement("li");
    li.className = "time-item";

    const d = document.createElement("span");
    d.textContent = item.domain;
    d.style.color = colors[i];

    const t = document.createElement("span");
    t.textContent = formatDuration(item.duration);

    li.append(d, t);
    ul.appendChild(li);
  });
}

function formatDuration(secTotal) {
  const s = Math.floor(secTotal % 60),
        m = Math.floor((secTotal / 60) % 60),
        h = Math.floor(secTotal / 3600),
        p = n => String(n).padStart(2, "0");
  return `${p(h)}:${p(m)}:${p(s)}`;
}