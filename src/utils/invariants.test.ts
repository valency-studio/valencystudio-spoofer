/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// Invariants that are duplicated, not shared (AGENTS.md). Nothing at compile time ties
// these copies together, so editing one side silently breaks the app: the plugin just
// never finds the bridge, or the release tag drifts from the shipped binary.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const RUST_BRIDGE = 'src-tauri/src/studio_bridge/mod.rs';
const RUST_SERVER = 'src-tauri/src/studio_bridge/server.rs';
const PLUGIN_RUNTIME = 'plugin/src/config/runtime.luau';
const PLUGIN_POLLING = 'plugin/src/bridge/polling.luau';
const PLUGIN_DISCOVERY = 'plugin/src/bridge/discovery.luau';
const PLUGIN_VERSION_FILE = 'plugin/src/version/version.luau';
const TS_PLUGIN_BRIDGE = 'src/utils/pluginBridge.ts';

/** Anchored to the real declaration line: a renamed or deleted constant throws here. */
function capture(file: string, pattern: RegExp): string {
  const match = pattern.exec(readFileSync(join(ROOT, file), 'utf8'));
  if (!match) {
    throw new Error(
      `No declaration matching ${String(pattern)} in ${file} — it was renamed or deleted`,
    );
  }
  return match[1];
}

/** Fails with both sides named, so the report says which copy drifted. */
function expectAgree(labelA: string, valueA: string, labelB: string, valueB: string): void {
  if (valueA !== valueB) {
    throw new Error(`${labelA}=${valueA} but ${labelB}=${valueB} — duplicated constant drifted`);
  }
}

function readPorts() {
  return {
    rustStart: capture(RUST_BRIDGE, /^const PLUGIN_PORT_START: u16 = (\d+);$/m),
    rustEnd: capture(RUST_BRIDGE, /^const PLUGIN_PORT_END: u16 = (\d+);$/m),
    luauStart: capture(PLUGIN_RUNTIME, /^local PORT_START = (\d+)$/m),
    luauEnd: capture(PLUGIN_RUNTIME, /^local PORT_END = (\d+)$/m),
    tsDefault: capture(TS_PLUGIN_BRIDGE, /^export const DEFAULT_PLUGIN_PORT = '(\d+)';$/m),
  };
}

describe('Studio bridge port range', () => {
  it('is identical in Rust, in the Luau plugin and in the frontend default', () => {
    const { rustStart, rustEnd, luauStart, luauEnd, tsDefault } = readPorts();

    expectAgree(
      `${PLUGIN_RUNTIME} PORT_START`,
      luauStart,
      `${RUST_BRIDGE} PLUGIN_PORT_START`,
      rustStart,
    );
    expectAgree(`${PLUGIN_RUNTIME} PORT_END`, luauEnd, `${RUST_BRIDGE} PLUGIN_PORT_END`, rustEnd);
    expectAgree(
      `${TS_PLUGIN_BRIDGE} DEFAULT_PLUGIN_PORT`,
      tsDefault,
      `${RUST_BRIDGE} PLUGIN_PORT_START`,
      rustStart,
    );
  });

  it('starts at or below where it ends', () => {
    const { rustStart, rustEnd, luauStart, luauEnd } = readPorts();

    expect(Number(rustStart)).toBeLessThanOrEqual(Number(rustEnd));
    expect(Number(luauStart)).toBeLessThanOrEqual(Number(luauEnd));
  });
});

describe('app version', () => {
  it('agrees in package.json, Cargo.toml and both Tauri configs', () => {
    const pkg = capture('package.json', /^ {2}"version": "([^"]+)",?$/m);
    const cargo = capture('src-tauri/Cargo.toml', /^version\s+= "([^"]+)"$/m);
    const tauri = capture('src-tauri/tauri.conf.json', /^ {2}"version": "([^"]+)",?$/m);
    const tauriDev = capture('src-tauri/tauri.dev.conf.json', /^ {2}"version": "([^"]+)",?$/m);

    expectAgree('src-tauri/Cargo.toml version', cargo, 'package.json version', pkg);
    expectAgree('src-tauri/tauri.conf.json version', tauri, 'package.json version', pkg);
    expectAgree('src-tauri/tauri.dev.conf.json version', tauriDev, 'package.json version', pkg);
  });

  it('is the version build:plugin wrote into the plugin', () => {
    const pkg = capture('package.json', /^ {2}"version": "([^"]+)",?$/m);
    const pluginVersion = capture(
      PLUGIN_VERSION_FILE,
      /^local PLUGIN_VERSION: string = "([^"]+)"$/m,
    );

    expectAgree(
      `${PLUGIN_VERSION_FILE} PLUGIN_VERSION`,
      pluginVersion,
      'package.json version',
      pkg,
    );
  });

  it('is a plain x.y.z that CI can turn into a release tag', () => {
    const pkg = capture('package.json', /^ {2}"version": "([^"]+)",?$/m);

    expect(pkg).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('studio bridge protocol', () => {
  it('keeps the plugin poll query parameter in step with the Rust reader', () => {
    const sent = capture(PLUGIN_POLLING, /"\/poll\?[^"]*?(plugin_version)=/);
    const read = capture(RUST_SERVER, /^ {4}pub (plugin_version): Option<String>,$/m);

    expectAgree(`${PLUGIN_POLLING} poll query param`, sent, `${RUST_SERVER} PollQuery field`, read);
  });

  it('spells the protocolVersion JSON key the same in every Rust response', () => {
    const inMod = capture(RUST_BRIDGE, /"(protocolVersion)": STUDIO_PROTOCOL_VERSION/);
    const inServer = capture(RUST_SERVER, /"(protocolVersion)": STUDIO_PROTOCOL_VERSION/);

    expectAgree(`${RUST_SERVER} JSON key`, inServer, `${RUST_BRIDGE} JSON key`, inMod);
    expect(
      Number(capture(RUST_BRIDGE, /^const STUDIO_PROTOCOL_VERSION: u8 = (\d+);$/m)),
    ).toBeGreaterThan(0);
  });

  it('keeps the stale-plugin check reading the health key Rust actually emits', () => {
    const read = capture(PLUGIN_DISCOVERY, /type\(best\.health\.(version)\) == "string"/);
    const emitted = capture(RUST_BRIDGE, /"(version)": env!\("CARGO_PKG_VERSION"\)/);

    expectAgree(`${PLUGIN_DISCOVERY} health field`, read, `${RUST_BRIDGE} /health key`, emitted);
  });
});
