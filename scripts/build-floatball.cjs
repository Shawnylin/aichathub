const path = require('node:path');
require('esbuild').buildSync({
  entryPoints: [path.join(__dirname, '../renderer/bloub-src/index.ts')],
  outfile: path.join(__dirname, '../renderer/bloub.js'),
  bundle: true, format: 'iife', globalName: 'Bloub', target: 'chrome120',
  legalComments: 'inline',
  banner: { js: '/* bloub © 2026 Jérémy Perret, MIT. See bloub-src/LICENSE and PROVENANCE.md. */' }
});
console.log('Built offline bloub engine');
