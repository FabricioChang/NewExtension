// background.js

let activityLog = [];
let currentActivity = null;
let exported = false;

// --- Helpers de dominio y tarea ---
function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

function extractTaskName(domain) {
  const m = domain.match(/(?:^|\.)?([^.]+)\.com(?:\..*)?$/);
  return m ? m[1] : domain;
}

// Ahora acepta duraciones de 0 segundos
function isValidActivity(a) {
  return a.domain !== "unknown" &&
         a.domain !== "newtab" &&
         a.horaFin >= a.horaInicio;
}

// --- Lógica de tracking ---
function startActivity(domain) {
  const now = new Date();

  if (!currentActivity) {
    currentActivity = { domain, horaInicio: now, horaFin: now };
    return;
  }
  if (domain === currentActivity.domain) {
    currentActivity.horaFin = now;
    return;
  }
  if (isValidActivity(currentActivity)) {
    activityLog.push({ ...currentActivity });
  }
  currentActivity = { domain, horaInicio: now, horaFin: now };
}

function captureActiveTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (tabs[0] && tabs[0].url) {
      startActivity(getDomain(tabs[0].url));
    }
  });
}

function finishCurrentActivity() {
  if (currentActivity && isValidActivity(currentActivity)) {
    currentActivity.horaFin = new Date();
    activityLog.push({ ...currentActivity });
  }
  currentActivity = null;
}

// --- Limpieza y generación de CSV ---
function cleanLog(log) {
  // 1) Fusiona consecutivos idénticos
  const merged = [];
  for (const e of log) {
    const last = merged[merged.length - 1];
    if (last && last.domain === e.domain) {
      last.horaFin = e.horaFin;
    } else {
      merged.push({ ...e });
    }
  }
  // 2) Elimina interrupciones <10s entre el mismo dominio
  const filtered = [];
  for (let i = 0; i < merged.length; i++) {
    const curr = merged[i];
    const prev = filtered[filtered.length - 1];
    const next = merged[i + 1];
    const dur = (new Date(curr.horaFin) - new Date(curr.horaInicio)) / 1000;
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
  // 3) Fusiona otra vez tras filtrar
  const final = [];
  for (const e of filtered) {
    const last = final[final.length - 1];
    if (last && last.domain === e.domain) {
      last.horaFin = e.horaFin;
    } else {
      final.push({ ...e });
    }
  }
  return final;
}

function generateCSV(log) {
  const header =
    "USUARIO,ID_AREA,TAREA,CODIGO SIGD,FECH_INI,FECH_FIN,OBSERVACIONES,ID_CAT,CATEGORIA,SUBCATEGORIA\r\n";
  const rows = log.map(e => [
    "usuario@bancoguayaquil.com",
    "ArqDatos",
    extractTaskName(e.domain),
    "",
    e.horaInicio.toISOString(),
    e.horaFin.toISOString(),
    "sin observaciones",
    "TOTE",
    "Tareas_Operativas",
    "Tareas Eventuales"
  ].join(","));
  return header + rows.join("\r\n") + "\r\n";
}

function downloadBlob(blob, filename, saveAs) {
  const reader = new FileReader();
  reader.onload = () => {
    chrome.downloads.download({ url: reader.result, filename, saveAs });
  };
  reader.readAsDataURL(blob);
}

// --- Listeners ---
chrome.tabs.onActivated.addListener(captureActiveTab);
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.url && tab.active) captureActiveTab();
});

chrome.runtime.onMessage.addListener((msg, _, sendResponse) => {
  if (msg === "export_csv") {
    finishCurrentActivity();
    const cleaned = cleanLog(activityLog);
    const csv = generateCSV(cleaned);
    downloadBlob(new Blob([csv], { type: "text/csv" }), "reporte_web_bg.csv", true);
    exported = true;
    activityLog = [];
    currentActivity = null;
    sendResponse("done");
  }
  else if (msg === "get_activity_data") {
    // Incluye siempre la actividad en curso actualizada
    const tempLog = activityLog.slice();
    if (currentActivity) {
      currentActivity.horaFin = new Date();
      tempLog.push({ ...currentActivity });
    }
    const cleaned = cleanLog(tempLog);

    const map = Object.create(null);
    cleaned.forEach(e => {
      const key = extractTaskName(e.domain);
      if (!map[key]) map[key] = { domain: key, sessions: 0, duration: 0 };
      map[key].sessions++;
      map[key].duration += (new Date(e.horaFin) - new Date(e.horaInicio)) / 1000;
    });

    sendResponse({ summary: Object.values(map), detail: cleaned });
    return true;
  }
});

chrome.runtime.onSuspend.addListener(() => {
  if (!exported) {
    finishCurrentActivity();
    const cleaned = cleanLog(activityLog);
    const csv = generateCSV(cleaned);
    downloadBlob(new Blob([csv], { type: "text/csv" }), "reporte_web_bg.csv", false);
    exported = true;
    activityLog = [];
    currentActivity = null;
  }
});

// Primera captura en cuanto arranca el background
captureActiveTab();
