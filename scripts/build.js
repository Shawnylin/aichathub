const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// 强制子进程使用 UTF-8 编码输出，避免中文乱码
const utf8Env = { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', PYTHONIOENCODING: 'utf-8' };

function run(cmd, opts = {}) {
  const fullCmd = process.platform === 'win32'
    ? `chcp 65001 >nul && ${cmd}`
    : cmd;
  return execSync(fullCmd, { stdio: 'inherit', env: utf8Env, ...opts });
}

const rcedit = path.join(__dirname, '..', 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe');
const unpackedExe = path.join(__dirname, '..', 'dist', 'win-unpacked', 'AI Chat Hub.exe');
const iconFile = path.join(__dirname, '..', 'assets', 'icon.ico');

console.log('[0/4] Generating icons...');
run('node scripts/make-icon.js', { cwd: path.join(__dirname, '..') });

console.log('[1/4] Building app...');
run('npx electron-builder --dir', { cwd: path.join(__dirname, '..') });

console.log('[2/4] Embedding icon...');
if (fs.existsSync(rcedit) && fs.existsSync(unpackedExe) && fs.existsSync(iconFile)) {
  execSync(`"${rcedit}" "${unpackedExe}" --set-icon "${iconFile}"`, { stdio: 'inherit' });
  console.log('Icon embedded successfully.');
} else {
  console.error('rcedit or exe or icon not found, skipping icon embedding.');
}

console.log('[3/4] Building NSIS installer...');
run('npx electron-builder --win --prepackaged dist/win-unpacked', { cwd: path.join(__dirname, '..') });

console.log('Build complete: dist/AI Chat Hub Setup 1.2.5.exe');
