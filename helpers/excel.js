const ExcelJS = require('exceljs');

/** Colores de la fila de grupos (uno por grupo, en orden; se repiten si hay más). */
const GROUP_COLORS = ['FFDBEAFE', 'FFDCFCE7', 'FFFEF3C7', 'FFFCE7F3', 'FFE0E7FF', 'FFCCFBF1', 'FFFFEDD5', 'FFF3E8FF'];

/**
 * Exportaciones a Excel (.xlsx). `sheets` = [{ name, columns: [{ header, width?, type? }], rows: [[...]] }].
 * Encabezado en negrita con fondo, fila fija y filtro automático. Las celdas `Date` quedan como
 * fecha de Excel; los números, como número.
 * `groups` (opcional): [{ label, span }] alineados con las columnas — una fila ARRIBA del
 * encabezado con celdas combinadas y un color por grupo (ej. a qué ficha pertenece cada campo).
 * Un `label` vacío deja esas columnas sin grupo.
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
    let headerRow = 1;
    if (sheet.groups?.length) {
      // Fila de grupos arriba del encabezado.
      ws.spliceRows(1, 0, []);
      headerRow = 2;
      let col = 1;
      let colorIndex = 0;
      for (const g of sheet.groups) {
        const span = Math.max(1, g.span || 1);
        if (g.label) {
          const argb = GROUP_COLORS[colorIndex % GROUP_COLORS.length];
          colorIndex += 1;
          if (span > 1) ws.mergeCells(1, col, 1, col + span - 1);
          const cell = ws.getCell(1, col);
          cell.value = g.label;
          cell.font = { bold: true, color: { argb: 'FF1F2937' } };
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          for (let c = col; c < col + span; c++) {
            ws.getCell(1, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
            // El encabezado de esas columnas lleva una franja del mismo color abajo.
            ws.getCell(2, c).border = { bottom: { style: 'thick', color: { argb } } };
          }
        }
        col += span;
      }
    }
    ws.views = [{ state: 'frozen', ySplit: headerRow, xSplit: sheet.freezeColumns || 0 }];
    if (sheet.columns.length) ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: sheet.columns.length } };
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

/** Lee la primera hoja de un .xlsx: `{ headers: [texto], rows: [{ rowNumber, values: [celda] }] }`.
 * `isHeaderRow(textos)` (opcional): si la fila 1 no es el encabezado y la 2 sí (ej. la fila 1 es
 * la de grupos de `buildWorkbook`), el encabezado es la fila 2 y los datos empiezan en la 3. */
async function readFirstSheet(buffer, { isHeaderRow = null } = {}) {
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
  const rowTexts = (n) => {
    const out = [];
    ws.getRow(n).eachCell({ includeEmpty: true }, (cell, col) => {
      out[col - 1] = String(cellValue(cell.value) ?? '').trim();
    });
    return out;
  };
  let headerRow = 1;
  if (isHeaderRow && !isHeaderRow(rowTexts(1)) && isHeaderRow(rowTexts(2))) headerRow = 2;
  const headers = rowTexts(headerRow);
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= headerRow) return;
    const values = headers.map((_, i) => cellValue(row.getCell(i + 1).value));
    if (values.every((v) => v === null || String(v).trim() === '')) return;
    rows.push({ rowNumber, values });
  });
  return { headers, rows };
}

module.exports = { buildWorkbook, sendWorkbook, readFirstSheet };
