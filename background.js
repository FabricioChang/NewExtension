// background.js

// --- Estado persistido ---
let segments      = [];    // Array de { domain, horaInicio, horaFin }
let currentDomain = null;  // dominio en curso
let startTime     = null;  // Date de inicio del segmento actual
let exported      = false; // bandera de exportación
let userPrefix    = null;  // solo el prefijo, sin "@bancoguayaquil.com"

// --- URL de prueba para el POST JSON; reemplázala por tu API final ---
const API_JSON_URL = "https://webhook.site/bd020620-74fc-4959-957d-305553005b7e";

// --- Guardar estado en chrome.storage ---
function persistState() {
  chrome.storage.local.set({
    segments,
    currentDomain,
    startTime: startTime?.toISOString() || null,
    exported,
    userPrefix
  });
}

// --- Helpers de dominio y tracking ---
function getDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return "unknown"; }
}

function switchDomain(newDomain) {
  const now = new Date();
  if (currentDomain && startTime) {
    segments.push({
      domain:     currentDomain,
      horaInicio: startTime.toISOString(),
      horaFin:    now.toISOString()
    });
  }
  currentDomain = newDomain;
  startTime     = now;
  persistState();
}

function captureActiveTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    const url = tabs[0]?.url;
    if (!url) return;
    const dom = getDomain(url);
    if (dom !== "newtab" && dom !== "unknown" && dom !== currentDomain) {
      switchDomain(dom);
    }
  });
}

// --- Limpieza de segmentos (fusiones + interrupciones <10s) ---
function cleanLog(log) {
  const merged = [];
  for (const e of log) {
    const last = merged.at(-1);
    if (last?.domain === e.domain) last.horaFin = e.horaFin;
    else merged.push({ ...e });
  }
  const filtered = [];
  for (let i = 0; i < merged.length; i++) {
    const curr = merged[i], prev = filtered.at(-1), next = merged[i+1];
    const dur = (new Date(curr.horaFin) - new Date(curr.horaInicio)) / 1000;
    if (dur < 10 && prev && next && prev.domain === next.domain && curr.domain !== prev.domain) {
      prev.horaFin = curr.horaFin;
      continue;
    }
    filtered.push(curr);
  }
  const final = [];
  for (const e of filtered) {
    const last = final.at(-1);
    if (last?.domain === e.domain) last.horaFin = e.horaFin;
    else final.push({ ...e });
  }
  return final;
}

// --- Formateo de ISO a local YYYY-MM-DDTHH:mm:ss ---
function formatLocalISOString(iso) {
  const d = new Date(iso), p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}` +
         `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// --- Generar CSV con usuario dinámico ---
function generateCSV(log, prefix) {
  const user = `${prefix || "usuario"}@bancoguayaquil.com`;
  const hdr  = "USUARIO,ID_AREA,TAREA,CODIGO SIGD,FECH_INI,FECH_FIN,OBSERVACIONES,ID_CAT,CATEGORIA,SUBCATEGORIA\r\n";
  const rows = log.map(e => {
    const ini = formatLocalISOString(e.horaInicio);
    const fin = formatLocalISOString(e.horaFin);
    return [
      user,
      "ArqDatos",
      e.domain,
      "",
      ini,
      fin,
      "sin observaciones",
      "TOTE",
      "Tareas_Operativas",
      "Tareas Eventuales"
    ].join(",");
  });
  return hdr + rows.join("\r\n") + "\r\n";
}

// --- Descargar Blob (CSV) ---
function downloadBlob(blob, filename, saveAs) {
  const reader = new FileReader();
  reader.onload = () => chrome.downloads.download({ url: reader.result, filename, saveAs });
  reader.readAsDataURL(blob);
}

// --- Manejo de mensajes del popup ---
function onMessage(msg, _, sendResponse) {
  if (msg === "get_activity_data") {
    // Incluye segmento vivo
    const all = segments.slice();
    if (currentDomain && startTime) {
      all.push({ 
        domain:     currentDomain, 
        horaInicio: startTime.toISOString(), 
        horaFin:    new Date().toISOString() 
      });
    }
    // Limpia y resume
    const cleaned = cleanLog(all);
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
    // Cierra segmento vivo
    if (currentDomain && startTime) {
      segments.push({
        domain:     currentDomain,
        horaInicio: startTime.toISOString(),
        horaFin:    new Date().toISOString()
      });
    }
    const cleaned = cleanLog(segments);

    // Recupera el prefijo y luego genera CSV + JSON
    chrome.storage.local.get("userPrefix", data => {
      userPrefix = data.userPrefix;

      // 1) Descargar CSV
      const csv = generateCSV(cleaned, userPrefix);
      downloadBlob(new Blob([csv], { type: "text/csv" }), "reporte_web_bg.csv", true);

      // 2) Generar y enviar JSON
      const items = cleaned.map((e, i) => ({
        id:            i + 1,
        USUARIO:       `${userPrefix || "usuario"}@bancoguayaquil.com`,
        ID_AREA:       "ArqDatos",
        TAREA:         e.domain,
        "CODIGO SIGD": "",
        FECH_INI:      e.horaInicio,
        FECH_FIN:      e.horaFin,
        OBSERVACIONES: "sin observaciones",
        ID_CAT:        "TOTE",
        CATEGORIA:     "Tareas_Operativas",
        SUBCATEGORIA:  "Tareas Eventuales"
      }));
      const payload = {
        status: "OK",
        code:   200,
        total:  items.length,
        data:   items
      };
      fetch(API_JSON_URL, {
        method:  "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body:     JSON.stringify(payload)
      })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(json => console.log("API JSON response:", json))
      .catch(err => console.error("API JSON error:", err));

      // 3) Reiniciar tracking
      segments      = [];
      currentDomain = null;
      startTime     = null;
      exported      = false;
      persistState();
      captureActiveTab();

      sendResponse("done");
    });
    return true; // Responder async
  }
}

// --- Export automático al suspender ---
function onSuspend() {
  if (!exported) {
    if (currentDomain && startTime) {
      segments.push({
        domain:     currentDomain,
        horaInicio: startTime.toISOString(),
        horaFin:    new Date().toISOString()
      });
    }
    const cleaned = cleanLog(segments);
    chrome.storage.local.get("userPrefix", data => {
      const csv = generateCSV(cleaned, data.userPrefix);
      downloadBlob(new Blob([csv], { type: "text/csv" }), "reporte_web_bg.csv", false);
      // Se podría enviar JSON aquí también si se desea
    });
  }
}

// --- Listeners & arranque inicial ---
chrome.runtime.onMessage.addListener(onMessage);
chrome.runtime.onSuspend.addListener(onSuspend);
chrome.tabs.onActivated.addListener(captureActiveTab);
chrome.tabs.onUpdated.addListener((_, info, tab) => {
  if (info.url && tab.active) captureActiveTab();
});

chrome.storage.local.get(
  ["segments", "currentDomain", "startTime", "exported", "userPrefix"],
  data => {
    segments      = Array.isArray(data.segments)    ? data.segments    : [];
    currentDomain = data.currentDomain || null;
    startTime     = data.startTime
                     ? new Date(data.startTime)
                     : null;
    exported      = data.exported || false;
    userPrefix    = data.userPrefix || null;
    captureActiveTab();
  }
);