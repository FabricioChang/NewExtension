// background.js

// --- Estado persistido ---
let segments        = [];            // Array de { domain, horaInicio, horaFin }
let currentDomain   = null;          // dominio en curso
let startTime       = null;          // Date de inicio del segmento actual
let exported        = false;         // bandera de exportación

// --- Persistencia en chrome.storage ---
function persistState() {
  chrome.storage.local.set({
    segments,
    currentDomain,
    startTime: startTime?.toISOString() || null,
    exported
  });
}

// --- Helpers de dominio ---
function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

// --- Cambio de dominio / cierre de segmento anterior ---
function switchDomain(newDomain) {
  const now = new Date();
  // cerramos segmento anterior
  if (currentDomain && startTime) {
    segments.push({
      domain:    currentDomain,
      horaInicio: startTime.toISOString(),
      horaFin:    now.toISOString()
    });
  }
  // arrancamos uno nuevo
  currentDomain = newDomain;
  startTime     = now;
  persistState();
}

// --- Captura el tab activo, ignorando “newtab” ---
function captureActiveTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    const url = tabs[0]?.url;
    if (!url) return;
    const dom = getDomain(url);
    // newtab o unknown se absorbe en siguiente dominio válido
    if (dom === "newtab" || dom === "unknown") return;
    // si cambió de dominio, switcheamos
    if (dom !== currentDomain) {
      switchDomain(dom);
    }
  });
}

// --- Limpieza de segmentos: fusiona y absorbe interrupciones <10s ---
function cleanLog(log) {
  // 1) fusiona consecutivos idénticos
  const merged = [];
  for (const e of log) {
    const last = merged.at(-1);
    if (last?.domain === e.domain) {
      last.horaFin = e.horaFin;
    } else {
      merged.push({ ...e });
    }
  }
  // 2) absorbe interrupciones cortas (<10s) entre dos iguales
  const filtered = [];
  for (let i = 0; i < merged.length; i++) {
    const curr = merged[i];
    const prev = filtered.at(-1);
    const next = merged[i+1];
    const dur  = (new Date(curr.horaFin) - new Date(curr.horaInicio)) / 1000;
    if (
      dur < 10 &&
      prev && next &&
      prev.domain === next.domain &&
      curr.domain !== prev.domain
    ) {
      prev.horaFin = curr.horaFin;
      continue;
    }
    filtered.push(curr);
  }
  // 3) vuelve a fusionar posibles adyacentes iguales
  const final = [];
  for (const e of filtered) {
    const last = final.at(-1);
    if (last?.domain === e.domain) {
      last.horaFin = e.horaFin;
    } else {
      final.push({ ...e });
    }
  }
  return final;
}

// --- Generación de CSV según segmentos limpios ---
function generateCSV(log) {
  const header =
    "USUARIO,ID_AREA,TAREA,CODIGO SIGD,FECH_INI,FECH_FIN,OBSERVACIONES,ID_CAT,CATEGORIA,SUBCATEGORIA\r\n";
  const rows = log.map(e => [
    "usuario@bancoguayaquil.com",
    "ArqDatos",
    e.domain,
    "",
    e.horaInicio,
    e.horaFin,
    "sin observaciones",
    "TOTE",
    "Tareas_Operativas",
    "Tareas Eventuales"
  ].join(","));
  return header + rows.join("\r\n") + "\r\n";
}

// --- Descarga de Blob como CSV ---
function downloadBlob(blob, filename, saveAs) {
  const reader = new FileReader();
  reader.onload = () => {
    chrome.downloads.download({ url: reader.result, filename, saveAs });
  };
  reader.readAsDataURL(blob);
}

// --- Handler de mensajes del popup ---
function onMessage(msg, _, sendResponse) {
  if (msg === "get_activity_data") {
    // 1) construimos un array temporal que incluya el segmento vivo
    const all = segments.slice();
    if (currentDomain && startTime) {
      all.push({
        domain:    currentDomain,
        horaInicio: startTime.toISOString(),
        horaFin:    new Date().toISOString()
      });
    }
    // 2) limpiamos
    const cleaned = cleanLog(all);
    // 3) resumimos por dominio
    const map = {};
    cleaned.forEach(e => {
      map[e.domain] = map[e.domain] || { domain: e.domain, sessions: 0, duration: 0 };
      map[e.domain].sessions++;
      map[e.domain].duration += (new Date(e.horaFin) - new Date(e.horaInicio)) / 1000;
    });
    sendResponse({ summary: Object.values(map), detail: cleaned });
    return true;
  }

  if (msg === "export_csv") {
    // cerramos el tramo vivo
    if (currentDomain && startTime) {
      segments.push({
        domain:    currentDomain,
        horaInicio: startTime.toISOString(),
        horaFin:    new Date().toISOString()
      });
    }
    // limpiamos + CSV
    const cleaned = cleanLog(segments);
    const csv     = generateCSV(cleaned);
    downloadBlob(new Blob([csv], { type: "text/csv" }), "reporte_web_bg.csv", true);

    // posteo a httpbin para test
    fetch("https://httpbin.org/post", {
      method:  "POST",
      headers: { "Content-Type": "text/csv" },
      body:     csv
    })
    .then(r => r.json())
    .then(x => console.log("httpbin echo:", x.data))
    .catch(e => console.error(e));

    // reinicio total
    segments      = [];
    currentDomain = null;
    startTime     = null;
    exported      = true;
    persistState();

    sendResponse("done");
  }
}

// --- onSuspend: exporta automáticamente (sin saveAs) ---
function onSuspend() {
  if (!exported) {
    if (currentDomain && startTime) {
      segments.push({
        domain:    currentDomain,
        horaInicio: startTime.toISOString(),
        horaFin:    new Date().toISOString()
      });
    }
    const cleaned = cleanLog(segments);
    const csv     = generateCSV(cleaned);
    downloadBlob(new Blob([csv], { type: "text/csv" }), "reporte_web_bg.csv", false);

    // opcional: también lo posteamos
    fetch("https://httpbin.org/post", {
      method:  "POST",
      headers: { "Content-Type": "text/csv" },
      body:     csv
    }).catch(() => {});
  }
}

// --- Inicialización tras recuperar estado ---
chrome.storage.local.get(
  ["segments","currentDomain","startTime","exported"],
  data => {
    segments      = Array.isArray(data.segments)      ? data.segments    : [];
    currentDomain = data.currentDomain || null;
    startTime     = data.startTime ? new Date(data.startTime) : null;
    exported      = data.exported      || false;

    // registramos listeners
    chrome.tabs.onActivated.addListener(captureActiveTab);
    chrome.tabs.onUpdated.addListener((_,info,tab) => {
      if (info.url && tab.active) captureActiveTab();
    });
    chrome.runtime.onMessage.addListener(onMessage);
    chrome.runtime.onSuspend.addListener(onSuspend);

    // primera captura
    captureActiveTab();
  }
);
