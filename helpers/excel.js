const ExcelJS = require('exceljs');

/**
 * Exportaciones a Excel (.xlsx). `sheets` = [{ name, columns: [{ header, width?, type? }], rows: [[...]] }].
 * Encabezado en negrita con fondo, fila fija y filtro automático. Las celdas `Date` quedan como
 * fecha de Excel; los números, como número.
 */
async function buildWorkbook(sheets) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Admin Club';
  wb.created = new Date();
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(String(sheet.name || 'Hoja').slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));
    ws.columns = sheet.columns.map((c) => ({ header: c.header, width: c.width || Math.min(Math.max(String(c.header).length + 4, 12), 40), style: c.type === 'date' ? { numFmt: 'dd-mm-yyyy' } : c.type === 'money' ? { numFmt: '"$"#,##0' } : {} }));
    for (const row of sheet.rows) ws.addRow(row);
    const header = ws.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
    header.alignment = { vertical: 'middle' };
    ws.views = [{ state: 'frozen', ySplit: 1, xSplit: sheet.freezeColumns || 0 }];
    if (sheet.columns.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };
    for (const note of sheet.notes || []) {
      ws.addRow([]);
      ws.addRow([note]).font = { italic: true, color: { argb: 'FF6B7280' } };
    }
  }
  return wb;
}

async function sendWorkbook(res, filename, sheets) {
  const wb = await buildWorkbook(sheets);
  const safe = filename.replace(/[^\w.\-áéíóúñÁÉÍÓÚÑ ]+/g, '').trim() || 'export.xlsx';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safe)}"; filename*=UTF-8''${encodeURIComponent(safe)}`);
  await wb.xlsx.write(res);
  res.end();
}

/** Lee la primera hoja de un .xlsx: `{ headers: [texto], rows: [{ rowNumber, values: [celda] }] }`. */
async function readFirstSheet(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return { headers: [], rows: [] };
  const cellValue = (v) => {
    if (v === null || v === undefined) return null;
    if (v instanceof Date) return v;
    if (typeof v === 'object') {
      if (v.text !== undefined) return v.text; // hipervínculo
      if (v.result !== undefined) return v.result; // fórmula
      if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    }
    return v;
  };
  const headers = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col - 1] = String(cellValue(cell.value) ?? '').trim();
  });
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = headers.map((_, i) => cellValue(row.getCell(i + 1).value));
    if (values.every((v) => v === null || String(v).trim() === '')) return;
    rows.push({ rowNumber, values });
  });
  return { headers, rows };
}

module.exports = { buildWorkbook, sendWorkbook, readFirstSheet };
