const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const svgPath = path.join(__dirname, '..', 'assets', 'logo.svg');
const outDir = path.join(__dirname, '..', 'assets');

async function makeIcon() {
  const svg = fs.readFileSync(svgPath);

  // 256x256 PNG for electron-builder (it will generate .ico from this)
  await sharp(svg).resize(256, 256).png().toFile(path.join(outDir, 'icon.png'));

  // 512x512 for higher quality
  await sharp(svg).resize(512, 512).png().toFile(path.join(outDir, 'icon-512.png'));

  console.log('Icons generated: icon.png (256x256), icon-512.png (512x512)');
}

makeIcon().catch(console.error);
