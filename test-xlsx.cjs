const xlsx = require('xlsx');

// Create a dummy workbook with a date
const wb = xlsx.utils.book_new();
const ws = xlsx.utils.aoa_to_sheet([
  ['Date', 'Time'],
  [new Date(2026, 7, 27, 14, 0, 50), new Date(2026, 7, 27, 0, 0, 0)]
]);
xlsx.utils.book_append_sheet(wb, ws, 'Sheet1');
const buf = xlsx.write(wb, { type: 'buffer', cellDates: true });

// Read it back
const wbRead = xlsx.read(buf, { cellDates: true });
const rows = xlsx.utils.sheet_to_json(wbRead.Sheets['Sheet1']);

console.log("Parsed rows:", rows);
console.log("Row 0 Date object:", rows[0]['Date'].toISOString());
console.log("Row 0 Date getUTCHours:", rows[0]['Date'].getUTCHours());
console.log("Row 0 Date getHours:", rows[0]['Date'].getHours());
