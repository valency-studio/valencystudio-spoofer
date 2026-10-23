// ponytail: expands --#include (same text as build-plugin.mjs uses) and runs the
// Luau suite. The interpreter comes from the official luau-lang release zip,
// downloaded once into node_modules/.cache so local runs and CI behave the same.
// Upgrade path: swap to cargo-installed luau-cli once it ships a Windows binary.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LUAU_VERSION = '0.743';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginRoot = join(root, 'plugin');

function expand(source, fromFile, stack = []) {
  return source.replace(/^--#include\s+"([^"]+)"\s*$/gm, (_match, includePath) => {
    const resolvedInclude = resolve(dirname(fromFile), includePath);
    if (stack.includes(resolvedInclude)) {
      throw new Error(`Circular plugin include detected: ${includePath}`);
    }
    const body = expand(readFileSync(resolvedInclude, 'utf8'), resolvedInclude, [
      ...stack,
      resolvedInclude,
    ]);
    return [
      `-- BEGIN include: ${includePath}`,
      body.trimEnd(),
      `-- END include: ${includePath}`,
    ].join('\n');
  });
}

function resolveLuauBin() {
  if (process.env.LUAU_BIN) return process.env.LUAU_BIN;

  const exe = process.platform === 'win32' ? 'luau.exe' : 'luau';
  const cacheDir = join(root, 'node_modules', '.cache', 'luau', LUAU_VERSION);
  const binPath = join(cacheDir, exe);
  if (existsSync(binPath)) return binPath;

  const asset =
    process.platform === 'win32'
      ? 'luau-windows.zip'
      : process.platform === 'darwin'
        ? 'luau-macos.zip'
        : 'luau-ubuntu.zip';
  const url = `https://github.com/luau-lang/luau/releases/download/${LUAU_VERSION}/${asset}`;

  console.log(`    Downloading ${url}`);
  mkdirSync(cacheDir, { recursive: true });
  const zipPath = join(cacheDir, asset);
  execFileSync('curl', ['-fsSL', '-o', zipPath, url], { stdio: 'inherit' });
  // bsdtar ships with Windows 10+, Linux and macOS and reads zip, so one call works everywhere.
  execFileSync('tar', ['-xf', zipPath, '-C', cacheDir], { stdio: 'inherit' });
  if (!existsSync(binPath)) {
    throw new Error(`Expected ${exe} inside ${asset}`);
  }
  return binPath;
}

const luauBin = resolveLuauBin();

const entry = join(pluginRoot, 'tests', 'run_tests.luau');
const outDir = join(pluginRoot, '.generated');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, 'run_tests.expanded.luau');
writeFileSync(outPath, expand(readFileSync(entry, 'utf8'), entry), 'utf8');

try {
  console.log(execFileSync(luauBin, [outPath], { encoding: 'utf8' }));
} catch (err) {
  console.log(err.stdout ?? '');
  console.error(err.stderr ?? '');
  process.exit(1);
}
