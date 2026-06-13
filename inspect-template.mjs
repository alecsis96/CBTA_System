import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';

const buf = await readFile('roc 2026.xlsx');
const zip = await JSZip.loadAsync(buf);
const sheet1 = await zip.file('xl/worksheets/sheet1.xml').async('string');

const targets = ['N4','N36','J7','J39','C10','C42','K11','K43','C46','L46','N46','O46','E49','F49','N55','D52','E52','F52','J52','N52','D20','E20','F20','J20','N20','N23','E17','F17','C14','L14','N14','O14'];

for (const t of targets) {
  const re = new RegExp('r="' + t + '"');
  const match = sheet1.match(re);
  if (match) {
    const start = Math.max(0, match.index - 120);
    const end = Math.min(sheet1.length, match.index + 200);
    console.log('=== ' + t + ' ===');
    console.log(sheet1.substring(start, end));
    console.log();
  } else {
    console.log(t + ': NOT FOUND');
  }
}
