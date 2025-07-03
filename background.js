// background.js

// ---- Estado persistido ----
let usage = {};             // { dominio: totalSegundosAcumulados }
let currentDomain = null;   // dominio activo
let startTime = null;       // Date ISO string o timestamp

// --- Persiste en chrome.storage.local ---
function persistState() {
  chrome.storage.local.set({
    usage,
    currentDomain,
    startTime: startTime ? startTime.toISOString() : null
  });
}

// --- Helpers ---
function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

// Cuando cambia el dominio, acumula el tramo anterior y arranca uno nuevo
function switchDomain(newDomain) {
  const now = new Date();
  if (currentDomain && startTime) {
    const elapsed = (now - new Date(startTime)) / 1000;
    usage[currentDomain] = (usage[currentDomain] || 0) + elapsed;
  }
  currentDomain = newDomain;
  startTime = new Date();
  persistState();
}

// Captura el dominio de la pestaña activa
function captureActiveTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (tabs[0]?.url) {
      const dom = getDomain(tabs[0].url);
      if (dom !== currentDomain) switchDomain(dom);
    }
  });
}

// Devuelve un map con el uso final, sumando el tramo en curso
function getFinalUsage() {
  const now = new Date();
  const result = { ...usage };
  if (currentDomain && startTime) {
    const elapsed = (now - new Date(startTime)) / 1000;
    result[currentDomain] = (result[currentDomain]||0) + elapsed;
  }
  return result;
}

// --- Generación de CSV ---
function generateCSVFromUsage(map) {
  const header =
    "USUARIO,ID_AREA,TAREA,CODIGO SIGD,FECH_INI,FECH_FIN,OBSERVACIONES,ID_CAT,CATEGORIA,SUBCATEGORIA\r\n";
  const rows = [];
  const now = new Date();
  // Para cada dominio, necesitamos reconstruir start/end aproximados:
  // asumimos que todo el tiempo pudo repartirse uniformemente:
  // FECH_INI = ahora - total; FECH_FIN = ahora
  for (const [dom, secs] of Object.entries(map)) {
    const end = now.toISOString();
    const start = new Date(now - secs*1000).toISOString();
    rows.push([
      "usuario@bancoguayaquil.com",
      "ArqDatos",
      dom,
      "",
      start,
      end,
      "sin observaciones",
      "TOTE",
      "Tareas_Operativas",
      "Tareas Eventuales"
    ].join(","));
  }
  return header + rows.join("\r\n") + "\r\n";
}

// --- Descarga Blob helper ---
function downloadBlob(blob, filename, saveAs) {
  const reader = new FileReader();
  reader.onload = () => chrome.downloads.download({
    url: reader.result,
    filename,
    saveAs
  });
  reader.readAsDataURL(blob);
}

// --- Mensajes desde el popup ---
chrome.runtime.onMessage.addListener((msg, _, sendResponse) => {
  if (msg === "get_activity_data") {
    // prepara resumen para gráfico
    const finalUsage = getFinalUsage();
    const summary = Object.entries(finalUsage).map(([dom, secs]) => ({
      domain: dom,
      sessions: 1,         // seguimos contando tramos como “1 sesión” cada uno
      duration: secs
    }));
    sendResponse({ summary, detail: [] });
    return true;
  }

  if (msg === "export_csv") {
    // acumula el tramo en curso
    switchDomain(currentDomain);

    // genera CSV y descarga
    const finalUsage = getFinalUsage();
    const csv = generateCSVFromUsage(finalUsage);
    downloadBlob(new Blob([csv], { type: "text/csv" }), "reporte_web_bg.csv", true);

    // envía al endpoint de prueba
    fetch("https://httpbin.org/post", {
      method: "POST",
      headers: { "Content-Type": "text/csv" },
      body: csv
    })
    .then(r => r.json())
    .then(d => console.log("Echo httpbin:", d.data))
    .catch(e => console.error(e));

    // reinicia estado
    usage = {};
    currentDomain = null;
    startTime = null;
    exported = true;
    persistState();

    sendResponse("done");
  }
});

// --- onSuspend (ej. cierre navegador) ---
chrome.runtime.onSuspend.addListener(() => {
  // igual que exportar pero sin saveAs y sin reiniciar
  switchDomain(currentDomain);
  const finalUsage = getFinalUsage();
  const csv = generateCSVFromUsage(finalUsage);
  downloadBlob(new Blob([csv], { type: "text/csv" }), "reporte_web_bg.csv", false);
  fetch("https://httpbin.org/post", { method:"POST", headers:{"Content-Type":"text/csv"}, body:csv })
    .catch(()=>{});
});

// --- Inicialización: recupera estado y arranca listeners ---
chrome.storage.local.get(
  ["usage","currentDomain","startTime","exported"],
  data => {
    usage         = data.usage         || {};
    currentDomain = data.currentDomain || null;
    startTime     = data.startTime     ? new Date(data.startTime) : null;
    exported      = data.exported      || false;

    chrome.tabs.onActivated.addListener(captureActiveTab);
    chrome.tabs.onUpdated.addListener((_,info,tab) => {
      if (info.url && tab.active) captureActiveTab();
    });

    // primera captura
    captureActiveTab();
  }
);
