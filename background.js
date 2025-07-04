// background.js

// --- Estado persistido ---
let segments        = [];    // Array de { domain, horaInicio, horaFin }
let currentDomain   = null;  // dominio en curso
let startTime       = null;  // Date de inicio del segmento actual
let exported        = false; // bandera de exportación

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

// --- switchDomain / captura de tab activo ---
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
    if (dom === "newtab" || dom === "unknown") return;
    if (dom !== currentDomain) switchDomain(dom);
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

// Convierte un ISO string en un timestamp local en formato YYYY-MM-DDTHH:mm:ss
function formatLocalISOString(isoStr) {
  const d = new Date(isoStr);
  const pad = n => String(n).padStart(2, '0');
  const YYYY = d.getFullYear();
  const MM   = pad(d.getMonth() + 1);
  const DD   = pad(d.getDate());
  const hh   = pad(d.getHours());
  const mm   = pad(d.getMinutes());
  const ss   = pad(d.getSeconds());
  return `${YYYY}-${MM}-${DD}T${hh}:${mm}:${ss}`;
}

function generateCSV(log) {
  const hdr = "USUARIO,ID_AREA,TAREA,CODIGO SIGD,FECH_INI,FECH_FIN,OBSERVACIONES,ID_CAT,CATEGORIA,SUBCATEGORIA\r\n";
  const rows = log.map(e => {
    // formateamos en local tz en vez de e.horaInicio (ISO UTC)
    const ini = formatLocalISOString(e.horaInicio);
    const fin = formatLocalISOString(e.horaFin);
    return [
      "usuario@bancoguayaquil.com",
      "ArqDatos",
      e.domain,
      "N/A",
      ini,
      fin,
      "Sin observaciones",
      "TOTE",
      "Tareas_Operativas",
      "Tareas Eventuales"
    ].join(",");
  });
  return hdr + rows.join("\r\n") + "\r\n";
}

function downloadBlob(blob, filename, saveAs) {
  const r = new FileReader();
  r.onload = () => chrome.downloads.download({ url: r.result, filename, saveAs });
  r.readAsDataURL(blob);
}

// --- onMessage: get_activity_data y export_csv ---
function onMessage(msg, _, sendResponse) {
  if (msg === "get_activity_data") {
    // 1) incluimos el segmento vivo
    const all = segments.slice();
    if (currentDomain && startTime) {
      all.push({
        domain:     currentDomain,
        horaInicio: startTime.toISOString(),
        horaFin:    new Date().toISOString()
      });
    }
    // 2) limpiamos
    const cleaned = cleanLog(all);
    // 3) resumimos
    const map = Object.create(null);
    cleaned.forEach(e => {
      map[e.domain] = map[e.domain] || { domain: e.domain, sessions: 0, duration: 0 };
      map[e.domain].sessions++;
      map[e.domain].duration += (new Date(e.horaFin) - new Date(e.horaInicio)) / 1000;
    });
    sendResponse({ summary: Object.values(map), detail: cleaned });
    return true;
  }

  if (msg === "export_csv") {
    // cerramos el vivo
    if (currentDomain && startTime) {
      segments.push({
        domain:     currentDomain,
        horaInicio: startTime.toISOString(),
        horaFin:    new Date().toISOString()
      });
    }
    const cleaned = cleanLog(segments);
    const csv     = generateCSV(cleaned);
    downloadBlob(new Blob([csv], { type: "text/csv" }), "reporte_web_bg.csv", true);

    // test post
    fetch("https://httpbin.org/post", {
      method:  "POST",
      headers: { "Content-Type": "text/csv" },
      body:     csv
    }).catch(console.error);

    // reinicio YA y vuelvo a arrancar el contador
    segments      = [];
    currentDomain = null;
    startTime     = null;
    exported      = false;
    persistState();
    captureActiveTab();

    sendResponse("done");
  }
}

// --- onSuspend: export / post sin “saveAs” ---
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
    const csv     = generateCSV(cleaned);
    downloadBlob(new Blob([csv], { type: "text/csv" }), "reporte_web_bg.csv", false);
    fetch("https://httpbin.org/post", {
      method:  "POST",
      headers: { "Content-Type": "text/csv" },
      body:     csv
    }).catch(()=>{});
  }
}

// --- Registra **inmediatamente** los listeners (antes de storage.get) ---
chrome.runtime.onMessage.addListener(onMessage);
chrome.runtime.onSuspend.addListener(onSuspend);
chrome.tabs.onActivated.addListener(captureActiveTab);
chrome.tabs.onUpdated.addListener((_,info,tab) => {
  if (info.url && tab.active) captureActiveTab();
});

// --- Por último: restaurar estado y arrancar tracking ---
chrome.storage.local.get(
  ["segments","currentDomain","startTime","exported"],
  data => {
    segments      = Array.isArray(data.segments)    ? data.segments    : [];
    currentDomain = data.currentDomain || null;
    startTime     = data.startTime
                     ? new Date(data.startTime)
                     : null;
    exported      = data.exported || false;

    // arrancamos el primer segmento
    captureActiveTab();
  }
);
