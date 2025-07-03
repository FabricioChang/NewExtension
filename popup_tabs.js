// popup_tabs.js

let donutChart;

document.addEventListener("DOMContentLoaded", () => {
  console.log("📊 Popup cargado");

  // Pestañas
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.add("hidden"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.tab).classList.remove("hidden");
    });
  });

  // Inicialización del chart vacío
  const ctx = document.getElementById("donutChart").getContext("2d");
  donutChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: [],
      datasets: [{
        data: [],
        backgroundColor: [],
        borderColor: []
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false
    }
  });

  // Fetch + polling cada segundo
  fetchAndRender();
  const interval = setInterval(fetchAndRender, 1000);

  // Limpiar al cerrar popup
  window.addEventListener("unload", () => clearInterval(interval));

  // Exportar CSV
  document.getElementById("exportBtn").addEventListener("click", () => {
    chrome.runtime.sendMessage("export_csv", () => {
      console.log("✔️ Exportación completada");
      // refrescar inmediatamente tras exportar
      fetchAndRender();
    });
  });
});

function fetchAndRender() {
  chrome.runtime.sendMessage("get_activity_data", data => {
    if (!data || !Array.isArray(data.summary)) return;

    const labels    = data.summary.map(x => x.domain);
    const durations = data.summary.map(x => x.duration);

    // Genera un array de colores HSL equiespaciados
    const bgColors = labels.map((_, i) => {
      const hue = Math.round(360 * i / labels.length);
      return `hsl(${hue}, 70%, 50%)`;
    });

    // Asigna datos y colores al chart
    donutChart.data.labels                       = labels;
    donutChart.data.datasets[0].data             = durations;
    donutChart.data.datasets[0].backgroundColor  = bgColors;
    donutChart.data.datasets[0].borderColor      = bgColors.map(c => {
      const m = c.match(/hsl\((\d+),\s*([\d.]+)%,\s*([\d.]+)%\)/);
      if (!m) return c;
      const h = Number(m[1]), s = Number(m[2]), l = Number(m[3]);
      const darkerL = Math.max(0, l - 10);
      return `hsl(${h}, ${s}%, ${darkerL}%)`;
    });

    donutChart.update();

    // Renderiza la lista de tiempos con los mismos colores
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
    d.style.color = colors[i];  // Aplica el color HSL al texto

    const t = document.createElement("span");
    t.textContent = formatDuration(item.duration);

    li.append(d, t);
    ul.appendChild(li);
  });
}

function formatDuration(secTotal) {
  const s = Math.floor(secTotal % 60);
  const m = Math.floor((secTotal / 60) % 60);
  const h = Math.floor(secTotal / 3600);
  const p = n => String(n).padStart(2, "0");
  return `${p(h)}:${p(m)}:${p(s)}`;
}
