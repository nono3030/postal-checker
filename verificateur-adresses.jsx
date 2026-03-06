import { useState, useRef, useCallback } from "react";

const SAMPLE_CSV = `adresse;code_postal;ville
55 rue du Faubourg Saint-Honoré;75008;Paris
12 rue de la Paix;75002;Paris
1 place de la Concorde;75008;Paris
158 boulevard Haussmann;75008;Paris
27 rue fauborg saint honore;75008;Paris
99999 rue inexistante;00000;Villebidon
45 avenue des champs elysee;75008;Paris
1 rue de rivoli;75001;Paris`;

const STATUS_COLORS = {
  verified: { bg: "#0d542b", text: "#6ee7a0", dot: "#34d399", label: "Vérifié" },
  partial: { bg: "#5c3d08", text: "#fbbf24", dot: "#f59e0b", label: "Partiel" },
  failed: { bg: "#5c1313", text: "#fca5a5", dot: "#ef4444", label: "Non trouvé" },
  pending: { bg: "#1e293b", text: "#94a3b8", dot: "#64748b", label: "En attente" },
};

function parseCSV(text) {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return { headers: [], rows: [] };
  const sep = lines[0].includes(";") ? ";" : lines[0].includes("\t") ? "\t" : ",";
  const headers = lines[0].split(sep).map((h) => h.trim().replace(/^["']|["']$/g, ""));
  const rows = lines.slice(1).filter(l => l.trim()).map((line, i) => {
    const vals = line.split(sep).map((v) => v.trim().replace(/^["']|["']$/g, ""));
    const obj = {};
    headers.forEach((h, j) => (obj[h] = vals[j] || ""));
    obj.__index = i;
    return obj;
  });
  return { headers, rows };
}

function parseExcel(buffer) {
  // Minimal XLSX parsing via SheetJS
  return import("https://cdn.sheetjs.com/xlsx-0.20.0/package/xlsx.mjs").then((XLSX) => {
    const wb = XLSX.read(buffer, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(ws, { defval: "" });
    if (!data.length) return { headers: [], rows: [] };
    const headers = Object.keys(data[0]);
    const rows = data.map((r, i) => ({ ...r, __index: i }));
    return { headers, rows };
  });
}

async function geocodeAddress(query) {
  const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}&limit=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data.features || data.features.length === 0) return null;
  const f = data.features[0];
  return {
    label: f.properties.label || "",
    score: f.properties.score || 0,
    housenumber: f.properties.housenumber || "",
    street: f.properties.street || f.properties.name || "",
    postcode: f.properties.postcode || "",
    city: f.properties.city || "",
    context: f.properties.context || "",
    type: f.properties.type || "",
    lat: f.geometry?.coordinates?.[1] || null,
    lon: f.geometry?.coordinates?.[0] || null,
  };
}

function getStatus(score) {
  if (score >= 0.7) return "verified";
  if (score >= 0.4) return "partial";
  return "failed";
}

function StatusBadge({ status }) {
  const s = STATUS_COLORS[status];
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "3px 10px", borderRadius: 999,
        background: s.bg, color: s.text,
        fontSize: 12, fontWeight: 600, letterSpacing: 0.3,
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: s.dot }} />
      {s.label}
    </span>
  );
}

function ScoreBar({ score }) {
  const pct = Math.round(score * 100);
  const color = score >= 0.7 ? "#34d399" : score >= 0.4 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: "#1e293b", borderRadius: 3, overflow: "hidden", minWidth: 60 }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 3, transition: "width 0.5s ease" }} />
      </div>
      <span style={{ fontSize: 12, color: "#94a3b8", fontVariantNumeric: "tabular-nums", minWidth: 36, textAlign: "right" }}>
        {pct}%
      </span>
    </div>
  );
}

function ColumnMapper({ headers, mapping, onMap }) {
  const fields = [
    { key: "adresse", label: "Adresse / Rue", desc: "Numéro et nom de rue" },
    { key: "code_postal", label: "Code postal", desc: "Optionnel" },
    { key: "ville", label: "Ville", desc: "Optionnel" },
  ];
  return (
    <div style={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 12, padding: 20, marginBottom: 20 }}>
      <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 14, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>
        Mapping des colonnes
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        {fields.map((f) => (
          <div key={f.key}>
            <label style={{ fontSize: 12, color: "#cbd5e1", marginBottom: 4, display: "block" }}>
              {f.label} <span style={{ color: "#475569" }}>— {f.desc}</span>
            </label>
            <select
              value={mapping[f.key] || ""}
              onChange={(e) => onMap(f.key, e.target.value)}
              style={{
                width: "100%", padding: "8px 10px", borderRadius: 8,
                background: "#0f172a", border: "1px solid #334155", color: "#e2e8f0",
                fontSize: 13, cursor: "pointer", outline: "none",
              }}
            >
              <option value="">— Ignorer —</option>
              {headers.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}

function ExportButton({ results, rows, mapping }) {
  const handleExport = () => {
    const sep = ";";
    const exportHeaders = [
      "adresse_originale",
      "adresse_normalisee",
      "score",
      "statut",
      "numero",
      "rue",
      "code_postal",
      "ville",
      "departement",
      "type",
      "latitude",
      "longitude",
    ];
    const csvLines = [exportHeaders.join(sep)];
    rows.forEach((row) => {
      const r = results[row.__index];
      const original = buildQuery(row, mapping);
      if (r && r.result) {
        csvLines.push([
          `"${original}"`,
          `"${r.result.label}"`,
          r.result.score.toFixed(3),
          getStatus(r.result.score) === "verified" ? "OK" : getStatus(r.result.score) === "partial" ? "PARTIEL" : "KO",
          `"${r.result.housenumber}"`,
          `"${r.result.street}"`,
          `"${r.result.postcode}"`,
          `"${r.result.city}"`,
          `"${r.result.context}"`,
          `"${r.result.type}"`,
          r.result.lat || "",
          r.result.lon || "",
        ].join(sep));
      } else {
        csvLines.push([`"${original}"`, "", "0", "KO", "", "", "", "", "", "", "", ""].join(sep));
      }
    });
    const blob = new Blob(["\uFEFF" + csvLines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `adresses_verifiees_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <button onClick={handleExport} style={{
      padding: "10px 20px", borderRadius: 10, border: "none", cursor: "pointer",
      background: "linear-gradient(135deg, #059669, #047857)", color: "#fff",
      fontSize: 13, fontWeight: 700, letterSpacing: 0.3, display: "flex", alignItems: "center", gap: 8,
      boxShadow: "0 2px 12px rgba(5,150,105,0.3)", transition: "transform 0.15s",
    }}
      onMouseOver={(e) => e.currentTarget.style.transform = "scale(1.03)"}
      onMouseOut={(e) => e.currentTarget.style.transform = "scale(1)"}
    >
      <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M8 2v9m0 0l-3-3m3 3l3-3M2 12v1a1 1 0 001 1h10a1 1 0 001-1v-1" />
      </svg>
      Exporter CSV
    </button>
  );
}

function buildQuery(row, mapping) {
  const parts = [];
  if (mapping.adresse && row[mapping.adresse]) parts.push(row[mapping.adresse]);
  if (mapping.code_postal && row[mapping.code_postal]) parts.push(row[mapping.code_postal]);
  if (mapping.ville && row[mapping.ville]) parts.push(row[mapping.ville]);
  return parts.join(" ").trim();
}

export default function App() {
  const [step, setStep] = useState("upload");
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [results, setResults] = useState({});
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [fileName, setFileName] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);
  const abortRef = useRef(false);

  const autoMap = useCallback((hdrs) => {
    const m = {};
    const adresseKeys = ["adresse", "address", "rue", "street", "voie", "adresse_complete", "full_address", "adresse_postale"];
    const cpKeys = ["code_postal", "cp", "zip", "zipcode", "postal_code", "postcode", "codepostal"];
    const villeKeys = ["ville", "city", "commune", "town", "localite"];
    for (const h of hdrs) {
      const lower = h.toLowerCase().replace(/[\s_-]/g, "");
      if (!m.adresse && adresseKeys.some((k) => lower.includes(k.replace(/[\s_-]/g, "")))) m.adresse = h;
      if (!m.code_postal && cpKeys.some((k) => lower.includes(k.replace(/[\s_-]/g, "")))) m.code_postal = h;
      if (!m.ville && villeKeys.some((k) => lower.includes(k.replace(/[\s_-]/g, "")))) m.ville = h;
    }
    return m;
  }, []);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    setFileName(file.name);
    let parsed;
    if (file.name.match(/\.xlsx?$/i) || file.name.match(/\.xlsm$/i)) {
      const buf = await file.arrayBuffer();
      parsed = await parseExcel(buf);
    } else {
      const text = await file.text();
      parsed = parseCSV(text);
    }
    if (parsed.headers.length === 0) return;
    setHeaders(parsed.headers);
    setRows(parsed.rows);
    setMapping(autoMap(parsed.headers));
    setResults({});
    setStep("map");
  }, [autoMap]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const loadSample = () => {
    const parsed = parseCSV(SAMPLE_CSV);
    setFileName("exemple.csv");
    setHeaders(parsed.headers);
    setRows(parsed.rows);
    setMapping(autoMap(parsed.headers));
    setResults({});
    setStep("map");
  };

  const startVerification = async () => {
    if (!mapping.adresse) return;
    setStep("results");
    setProcessing(true);
    setProgress(0);
    abortRef.current = false;
    const total = rows.length;
    const newResults = {};

    for (let i = 0; i < total; i++) {
      if (abortRef.current) break;
      const query = buildQuery(rows[i], mapping);
      if (!query) {
        newResults[rows[i].__index] = { result: null, error: "Adresse vide" };
      } else {
        try {
          const result = await geocodeAddress(query);
          newResults[rows[i].__index] = { result, error: result ? null : "Aucun résultat" };
        } catch (err) {
          newResults[rows[i].__index] = { result: null, error: err.message };
        }
      }
      setResults({ ...newResults });
      setProgress(((i + 1) / total) * 100);
      // Rate limiting: ~40 req/s max
      if (i < total - 1) await new Promise((r) => setTimeout(r, 30));
    }
    setProcessing(false);
  };

  const stopVerification = () => {
    abortRef.current = true;
    setProcessing(false);
  };

  const stats = {
    total: rows.length,
    verified: Object.values(results).filter((r) => r.result && getStatus(r.result.score) === "verified").length,
    partial: Object.values(results).filter((r) => r.result && getStatus(r.result.score) === "partial").length,
    failed: Object.values(results).filter((r) => !r.result || getStatus(r.result.score) === "failed").length,
    processed: Object.keys(results).length,
  };

  return (
    <div style={{
      minHeight: "100vh", background: "#0a0e1a",
      fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
      color: "#e2e8f0",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Inter:wght@400;500;600;700;800;900&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: #0f172a; }
        ::-webkit-scrollbar-thumb { background: #334155; border-radius: 3px; }
        ::selection { background: #1d4ed8; color: #fff; }
      `}</style>

      {/* Header */}
      <div style={{
        borderBottom: "1px solid #1e293b",
        background: "linear-gradient(180deg, #0f1629 0%, #0a0e1a 100%)",
        padding: "20px 32px",
      }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{
              width: 38, height: 38, borderRadius: 10,
              background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 18, fontWeight: 800,
              boxShadow: "0 0 20px rgba(59,130,246,0.3)",
            }}>
              ✉
            </div>
            <div>
              <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 800, fontSize: 17, letterSpacing: -0.5, color: "#f1f5f9" }}>
                Vérificateur d'Adresses
              </div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 1 }}>
                API Base Adresse Nationale — Validation en masse
              </div>
            </div>
          </div>
          {step !== "upload" && (
            <button
              onClick={() => { setStep("upload"); setRows([]); setHeaders([]); setResults({}); setProgress(0); setFileName(""); }}
              style={{
                padding: "7px 14px", borderRadius: 8, border: "1px solid #334155",
                background: "transparent", color: "#94a3b8", fontSize: 12,
                cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s",
              }}
              onMouseOver={(e) => { e.currentTarget.style.borderColor = "#64748b"; e.currentTarget.style.color = "#e2e8f0"; }}
              onMouseOut={(e) => { e.currentTarget.style.borderColor = "#334155"; e.currentTarget.style.color = "#94a3b8"; }}
            >
              ← Nouveau fichier
            </button>
          )}
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "28px 32px" }}>
        {/* UPLOAD */}
        {step === "upload" && (
          <div style={{ maxWidth: 640, margin: "60px auto" }}>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              style={{
                border: `2px dashed ${dragOver ? "#3b82f6" : "#334155"}`,
                borderRadius: 16, padding: "60px 40px", textAlign: "center",
                cursor: "pointer", transition: "all 0.2s",
                background: dragOver ? "rgba(59,130,246,0.05)" : "transparent",
              }}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.tsv,.xlsx,.xls,.xlsm"
                onChange={(e) => handleFile(e.target.files?.[0])}
                style={{ display: "none" }}
              />
              <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.6 }}>📄</div>
              <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: 18, marginBottom: 8 }}>
                Glissez votre fichier ici
              </div>
              <div style={{ color: "#64748b", fontSize: 13, lineHeight: 1.6 }}>
                CSV, TSV, Excel (.xlsx, .xls) — Séparateur auto-détecté
              </div>
              <div style={{
                marginTop: 20, display: "inline-flex", padding: "10px 24px",
                borderRadius: 10, background: "#1e293b", color: "#94a3b8",
                fontSize: 13, fontWeight: 600, border: "1px solid #334155",
              }}>
                Parcourir…
              </div>
            </div>
            <div style={{ textAlign: "center", marginTop: 24 }}>
              <button
                onClick={loadSample}
                style={{
                  background: "none", border: "none", color: "#3b82f6",
                  fontSize: 13, cursor: "pointer", fontFamily: "inherit",
                  textDecoration: "underline", textUnderlineOffset: 3,
                }}
              >
                Charger un fichier d'exemple (8 adresses)
              </button>
            </div>
            <div style={{
              marginTop: 40, background: "#111827", border: "1px solid #1e293b",
              borderRadius: 12, padding: 20,
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#cbd5e1", marginBottom: 10 }}>
                Comment ça marche ?
              </div>
              <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.8 }}>
                <span style={{ color: "#3b82f6" }}>1.</span> Importez un CSV ou Excel contenant vos adresses<br />
                <span style={{ color: "#3b82f6" }}>2.</span> Mappez les colonnes (adresse, code postal, ville)<br />
                <span style={{ color: "#3b82f6" }}>3.</span> Lancement de la vérification via l'API BAN (gratuit, sans clé)<br />
                <span style={{ color: "#3b82f6" }}>4.</span> Exportez les résultats avec adresses normalisées + scores + GPS
              </div>
            </div>
          </div>
        )}

        {/* MAPPING */}
        {step === "map" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <div>
                <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: 16 }}>
                  {fileName}
                </div>
                <div style={{ fontSize: 12, color: "#64748b", marginTop: 3 }}>
                  {rows.length} ligne{rows.length > 1 ? "s" : ""} détectée{rows.length > 1 ? "s" : ""} — {headers.length} colonne{headers.length > 1 ? "s" : ""}
                </div>
              </div>
              <button
                onClick={startVerification}
                disabled={!mapping.adresse}
                style={{
                  padding: "11px 28px", borderRadius: 10, border: "none", cursor: mapping.adresse ? "pointer" : "not-allowed",
                  background: mapping.adresse ? "linear-gradient(135deg, #3b82f6, #6366f1)" : "#1e293b",
                  color: mapping.adresse ? "#fff" : "#475569",
                  fontSize: 14, fontWeight: 700, fontFamily: "'Inter', sans-serif",
                  boxShadow: mapping.adresse ? "0 2px 16px rgba(59,130,246,0.35)" : "none",
                  transition: "all 0.15s",
                }}
              >
                Lancer la vérification →
              </button>
            </div>

            <ColumnMapper headers={headers} mapping={mapping} onMap={(k, v) => setMapping((p) => ({ ...p, [k]: v }))} />

            {/* Preview */}
            <div style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>
              Aperçu (5 premières lignes)
            </div>
            <div style={{ overflowX: "auto", borderRadius: 10, border: "1px solid #1e293b" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#111827" }}>
                    <th style={{ padding: "10px 14px", textAlign: "left", color: "#64748b", fontWeight: 600, borderBottom: "1px solid #1e293b" }}>#</th>
                    {headers.map((h) => (
                      <th key={h} style={{
                        padding: "10px 14px", textAlign: "left", borderBottom: "1px solid #1e293b",
                        color: Object.values(mapping).includes(h) ? "#3b82f6" : "#64748b",
                        fontWeight: 600,
                      }}>{h}</th>
                    ))}
                    <th style={{ padding: "10px 14px", textAlign: "left", color: "#64748b", fontWeight: 600, borderBottom: "1px solid #1e293b" }}>
                      Requête construite
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 5).map((row, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #1e293b" }}>
                      <td style={{ padding: "8px 14px", color: "#475569" }}>{i + 1}</td>
                      {headers.map((h) => (
                        <td key={h} style={{ padding: "8px 14px", color: "#cbd5e1" }}>{row[h]}</td>
                      ))}
                      <td style={{ padding: "8px 14px", color: "#8b5cf6", fontStyle: "italic" }}>
                        {buildQuery(row, mapping) || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* RESULTS */}
        {step === "results" && (
          <div>
            {/* Stats bar */}
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: 12, marginBottom: 20,
            }}>
              {[
                { label: "Total", val: stats.total, color: "#3b82f6" },
                { label: "Vérifié", val: stats.verified, color: "#34d399" },
                { label: "Partiel", val: stats.partial, color: "#f59e0b" },
                { label: "Échoué", val: stats.failed, color: "#ef4444" },
              ].map((s) => (
                <div key={s.label} style={{
                  background: "#111827", border: "1px solid #1e293b", borderRadius: 10, padding: "14px 18px",
                }}>
                  <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 }}>{s.label}</div>
                  <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 26, fontWeight: 800, color: s.color }}>{s.val}</div>
                </div>
              ))}
            </div>

            {/* Progress */}
            {(processing || progress > 0) && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: "#94a3b8" }}>
                    {processing ? `Vérification en cours… ${stats.processed}/${stats.total}` : "Terminé"}
                  </span>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    {processing && (
                      <button onClick={stopVerification} style={{
                        padding: "5px 12px", borderRadius: 6, border: "1px solid #dc2626",
                        background: "transparent", color: "#fca5a5", fontSize: 11,
                        cursor: "pointer", fontFamily: "inherit",
                      }}>
                        Stop
                      </button>
                    )}
                    {!processing && stats.processed > 0 && (
                      <ExportButton results={results} rows={rows} mapping={mapping} />
                    )}
                  </div>
                </div>
                <div style={{ height: 4, background: "#1e293b", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{
                    height: "100%", borderRadius: 2, transition: "width 0.3s ease",
                    width: `${progress}%`,
                    background: processing ? "linear-gradient(90deg, #3b82f6, #8b5cf6)" : "#34d399",
                  }} />
                </div>
              </div>
            )}

            {/* Results table */}
            <div style={{ overflowX: "auto", borderRadius: 10, border: "1px solid #1e293b" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#111827" }}>
                    {["#", "Adresse originale", "Statut", "Score", "Adresse normalisée", "Code postal", "Ville", "Coord. GPS"].map((h) => (
                      <th key={h} style={{
                        padding: "10px 12px", textAlign: "left", color: "#64748b",
                        fontWeight: 600, borderBottom: "1px solid #1e293b", whiteSpace: "nowrap",
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => {
                    const r = results[row.__index];
                    const query = buildQuery(row, mapping);
                    const status = r ? (r.result ? getStatus(r.result.score) : "failed") : "pending";
                    return (
                      <tr key={i} style={{
                        borderBottom: "1px solid #1e293b",
                        background: i % 2 === 0 ? "transparent" : "rgba(15,23,42,0.5)",
                        opacity: status === "pending" ? 0.5 : 1,
                        transition: "opacity 0.3s",
                      }}>
                        <td style={{ padding: "10px 12px", color: "#475569" }}>{i + 1}</td>
                        <td style={{ padding: "10px 12px", color: "#cbd5e1", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {query || "—"}
                        </td>
                        <td style={{ padding: "10px 12px" }}><StatusBadge status={status} /></td>
                        <td style={{ padding: "10px 12px", minWidth: 130 }}>
                          {r?.result ? <ScoreBar score={r.result.score} /> : <span style={{ color: "#475569" }}>—</span>}
                        </td>
                        <td style={{ padding: "10px 12px", color: r?.result ? "#f1f5f9" : "#475569", fontWeight: r?.result ? 500 : 400 }}>
                          {r?.result?.label || r?.error || "—"}
                        </td>
                        <td style={{ padding: "10px 12px", color: "#94a3b8" }}>
                          {r?.result?.postcode || "—"}
                        </td>
                        <td style={{ padding: "10px 12px", color: "#94a3b8" }}>
                          {r?.result?.city || "—"}
                        </td>
                        <td style={{ padding: "10px 12px", color: "#64748b", fontSize: 11, whiteSpace: "nowrap" }}>
                          {r?.result?.lat ? `${r.result.lat.toFixed(5)}, ${r.result.lon.toFixed(5)}` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
