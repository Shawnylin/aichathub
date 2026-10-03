const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const vm = require("node:vm");
const files = [
  "main.js",
  "preload.js",
  "floatball-preload.js",
  ...["main", "renderer", "scripts", "tests"].flatMap((dir) =>
    fs
      .readdirSync(dir)
      .filter((name) => /\.(js|cjs)$/.test(name))
      .map((name) => path.join(dir, name)),
  ),
];
let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    failed = true;
    console.error(file, result.stderr || result.error);
  }
}
for (const file of ["index.html", "newtab.html", "floatball.html"]) {
  const content = fs.readFileSync(file, "utf8");
  let index = 0;
  for (const match of content.matchAll(
    /<script\b[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    if (!match[1].trim()) continue;
    try {
      new vm.Script(match[1], { filename: file + ":inline-" + ++index });
    } catch (e) {
      failed = true;
      console.error(e);
    }
  }
}
if (failed) process.exit(1);
console.log(
  `Syntax OK: ${files.length} JavaScript files and inline scripts in 3 HTML files`,
);
