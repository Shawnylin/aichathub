const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const rcedit = path.join(__dirname, '..', 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe');
const unpackedExe = path.join(__dirname, '..', 'dist', 'win-unpacked', 'AI Chat Hub.exe');
const iconFile = path.join(__dirname, '..', 'assets', 'icon.ico');

console.log('[1/3] Building app...');
execSync('npx electron-builder --dir', { stdio: 'inherit', cwd: path.join(__dirname, '..') });

console.log('[2/3] Embedding icon...');
if (fs.existsSync(rcedit) && fs.existsSync(unpackedExe) && fs.existsSync(iconFile)) {
  execSync(`"${rcedit}" "${unpackedExe}" --set-icon "${iconFile}"`, { stdio: 'inherit' });
  console.log('Icon embedded successfully.');
} else {
  console.error('rcedit or exe or icon not found, skipping icon embedding.');
}

console.log('[3/3] Building NSIS installer...');
execSync('npx electron-builder --win --prepackaged dist/win-unpacked', { stdio: 'inherit', cwd: path.join(__dirname, '..') });

console.log('Build complete: dist/AI Chat Hub Setup 1.2.0.exe');
