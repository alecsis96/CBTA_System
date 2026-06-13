import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';

const buf = await readFile('roc 2026.xlsx');
const zip = await JSZip.loadAsync(buf);
const sheet1 = await zip.file('xl/worksheets/sheet1.xml').async('string');

// Check ALL bottom cells at offset 33 (current code)
const offset33 = {
  header: ['N37','J40','C43','K44','C47','L47','N47','O47'],
  amount: ['E50','F50'],
  details: ['D53','E53','F53','J53','N53','D54','E54','F54','J54','N54','D55','E55','F55','J55','N55'],
  total: ['N56'],
};
// Check ALL bottom cells at offset 32
const offset32 = {
  header: ['N36','J39','C42','K43','C46','L46','N46','O46'],
  amount: ['E49','F49'],
  details: ['D52','E52','F52','J52','N52','D53','E53','F53','J53','N53','D54','E54','F54','J54','N54'],
  total: ['N55'],
};

console.log('=== Checking offset 33 (CURRENT code) ===');
for (const [section, cells] of Object.entries(offset33)) {
  for (const cell of cells) {
    const re = new RegExp('r="' + cell + '"');
    const found = re.test(sheet1);
    if (!found) {
      // Try r="cell" with trailing space
      const re2 = new RegExp('r="' + cell + '[">]');
      const found2 = re2.test(sheet1);
      console.log(`  ${cell}: ${found2 ? 'PARTIAL' : 'NOT FOUND'} [${section}]`);
    }
  }
}

console.log('\n=== Checking offset 32 (template actual) ===');
for (const [section, cells] of Object.entries(offset32)) {
  for (const cell of cells) {
    const re = new RegExp('r="' + cell + '[">]');
    const found = re.test(sheet1);
    console.log(`  ${cell}: ${found ? 'FOUND' : 'NOT FOUND'} [${section}]`);
  }
}

// Get the actual row positions for amount-related data in bottom section
console.log('\n=== Looking for actual bottom amount row ===');
// Find rows around 48-52
for (let r = 47; r <= 52; r++) {
  const rowRe = new RegExp('<row r="' + r + '"');
  if (rowRe.test(sheet1)) {
    // Get the row content
    const start = sheet1.search(rowRe);
    const end = sheet1.indexOf('</row>', start) + 6;
    const rowContent = sheet1.substring(start, end);
    const hasC = rowContent.includes('<c r="C');
    const hasE = rowContent.includes('<c r="E');
    const hasF = rowContent.includes('<c r="F');
    console.log(`Row ${r}: C=${hasC} E=${hasE} F=${hasF} | ${rowContent.substring(0, 200)}`);
  }
}
