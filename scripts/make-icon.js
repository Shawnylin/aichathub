const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const svgPath = path.join(__dirname, '..', 'assets', 'logo.svg');
const outDir = path.join(__dirname, '..', 'assets');

async function makeIcon() {
  const svg = fs.readFileSync(svgPath);

  // 256x256 PNG for electron-builder
  await sharp(svg).resize(256, 256).png().toFile(path.join(outDir, 'icon.png'));

  // 512x512 for higher quality
  await sharp(svg).resize(512, 512).png().toFile(path.join(outDir, 'icon-512.png'));

  // Multi-resolution .ico for app exe icon
  const { default: pngToIco } = await import('png-to-ico');
  const sizes = [16, 32, 48, 256];
  const pngs = await Promise.all(sizes.map(s =>
    sharp(svg).resize(s, s).png().toBuffer()
  ));
  const ico = await pngToIco(pngs);
  fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);

  // 32x32 tray icon
  await sharp(svg).resize(32, 32).png().toFile(path.join(outDir, 'tray-icon.png'));

  console.log('Icons generated: icon.png (256x256), icon-512.png (512x512), icon.ico (16/32/48/256), tray-icon.png (32x32)');
}

makeIcon().catch(console.error);
