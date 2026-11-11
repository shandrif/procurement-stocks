// Parses the text the Microsoft 365 connector returns for an .xlsx file
// ("## Sheet: Name — R rows × C columns" followed by tab-separated rows),
// plus plain CSV/TSV, into [{ name, rows: string[][] }].

const SHEET_RE = /^## Sheet:\s*(.+?)\s+—\s+\d+\s+rows?/;
const EMPTY_RE = /^\[(\d+) empty rows?\]$/;

export function parseWorkbookText(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const sheets = [];
  let current = null;
  let inFormulas = false;

  for (const line of lines) {
    const header = line.match(SHEET_RE);
    if (header) {
      current = { name: header[1].trim(), rows: [] };
      sheets.push(current);
      inFormulas = false;
      continue;
    }
    if (!current) continue;
    if (line.trim() === 'Formulas:') { inFormulas = true; continue; }
    if (inFormulas) continue;
    const empty = line.trim().match(EMPTY_RE);
    if (empty) {
      for (let i = 0; i < Number(empty[1]); i++) current.rows.push([]);
      continue;
    }
    // Connector footers such as "[Sheets 3–20 were not read; …]"
    if (/^\[.*\]$/.test(line.trim()) && !line.includes('\t')) continue;
    current.rows.push(line.split('\t'));
  }

  if (sheets.length) return sheets;
  return [{ name: 'Sheet1', rows: parseDelimited(text) }];
}

function parseDelimited(text) {
  const firstLine = text.split('\n', 1)[0];
  const delim = firstLine.includes('\t') ? '\t' : ',';
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// "1,217" → 1217, " -   " → 0, "" → null, "(12)" → -12
export function toNumber(value) {
  if (value == null) return null;
  let s = String(value).trim();
  if (s === '') return null;
  if (/^-+$/.test(s)) return 0;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  s = s.replace(/[,\s]/g, '').replace(/^SAR|SAR$|^SR|SR$/i, '');
  if (!/^-?\d*\.?\d+(e-?\d+)?%?$/i.test(s)) return null;
  const n = parseFloat(s);
  return negative ? -n : n;
}
