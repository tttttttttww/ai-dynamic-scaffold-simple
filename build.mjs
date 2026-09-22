import { rm, mkdir, copyFile, access } from 'node:fs/promises';

const files = ['index.html', 'admin.html', 'app.js', 'admin.js', 'styles.css'];

await rm('public', { recursive: true, force: true });
await mkdir('public/vendor', { recursive: true });

for (const file of files) {
  await access(file);
  await copyFile(file, `public/${file}`);
}

await access('node_modules/xlsx/dist/xlsx.full.min.js');
await copyFile('node_modules/xlsx/dist/xlsx.full.min.js', 'public/vendor/xlsx.full.min.js');

await access('public/index.html');
console.log(`Build complete: ${files.length} static files + XLSX browser helper copied to public/`);
console.log('Entry verified: public/index.html');
