# Changelog

All notable changes to ValencyStudio - Spoofer are documented here. Versions
follow [Semantic Versioning](https://semver.org/); release tags are derived
from `package.json` by CI.

## [3.0.3] - 2026-10-14

### Added

- **About tab** with app identity, feature highlights, live build details
  (version, platform, architecture, runtime) and community links. Values the
  backend cannot report render as a dash instead of failing.
- **Trakteer support button.** The floating widget is injected as a document
  script, since a script rendered from JSX never executes. Both Tauri configs
  allow the Trakteer CDN for the loader and its icon. Loading is failure
  tolerant: no button, no crash.
- **GitHub funding metadata** pointing at Trakteer, so the Sponsor button shows
  on the repository.

### Changed

- **ISM branding renamed to ValencyStudio** across assets, the log helper
  (`logIsm` to `logValencyStudio`), the audio playback event, the debug console
  source labels and the Studio plugin's log filter.
- **About tab now carries a Support / Donate link** to Trakteer in place of the
  GitHub row, and the redundant open-source section was dropped.

### Fixed

- **`tauri:dev` no longer fails to start.** Specta refused to export the new
  `creatorUserId` field as a BigInt; it is exported as a float, matching how
  asset ids were already handled.
- Three call sites mangled by the rename (`logValencyStudioencyStudio`) and a
  copy-logs test expectation that did not account for the uppercased label.

## [3.0.2] - 2026-10-14

### Fixed

- **Studio bridge back on the 14285–14289 default.** The 14320 fallback
  range is removed on both ends: the backend binds the default range only
  and fails loudly when it is occupied, and the plugin probes the default
  range only.
- **Stale Studio plugin detection.** The app exposes its version on
  `/health` and logs when a polling plugin reports a different major
  version; the plugin checks at discovery, warns loudly, and tells the user
  to restart Roblox Studio.
- **PlaybackSpeed hint kept on upload history rows.** A track baked at 2.3x
  is source/speed seconds long by design (2:55 becomes 1:16); every history
  row now shows which `Sound.PlaybackSpeed` restores the original tempo.

## [3.0.1] - 2026-10-13

### Fixed

- **Music render matches the Bebeq reference recipe.** Speed is rendered
  through `asetrate`, so pitch rises with tempo instead of being held flat by
  `atempo`. The default preset (2.3x, −4 dB) now renders
  `asetrate=44100*2.3, volume=-4dB` and plays back correctly at
  `Sound.PlaybackSpeed` 0.435. The pitch slider offsets from the
  speed-shifted base. Output durations and split plans are unchanged.
- **Track preview matches the render.** The preview player no longer locks
  pitch while shifting speed, so what you hear is what gets uploaded.
- **Upload Use-permission grant repaired.** The grant call used an
  undocumented body shape that Roblox answers 400, leaving every asset
  approved with an id but unusable in any experience. It now sends the
  documented `BatchGrantPermissionsRequest`
  (`subjectType`/`subjectId`/`action`/`requests`), checks per-asset errors on
  200 responses, records the creator on each history row so resumed uploads
  can grant too, retries the grant when approval lands, and writes grant
  failures on the row instead of swallowing them. The API key needs the
  `asset-permissions:write` scope.
- **Operation polling reads results like the Spoofer uploader.** Asset ids
  arrive as strings as often as numbers, status comes as a boolean `done`
  with an `error` object, and small uploads can finish synchronously with an
  id and no operation to poll. Successful uploads no longer fall through to
  `rejected` ("never reported an asset id"), and ids surface in the history
  while validation is still running.

### Added

- **Music uploads in the Activity tab.** The tab previously listed spoof jobs
  only. Music upload history now appears there too, reusing the shared
  history row with live status updates and per-row deletion.

## [3.0.0] - 2026-10-13

### Fixed

- **Studio bridge port range extended to 14285–14320.** The plugin only
  probed 14285–14289, so it could never find the app when the backend bound
  a fallback port. Messages telling users to adjust a nonexistent setting
  were replaced; the plugin scans the full range automatically.
- **Scan completion fields aligned with the server** (`recordsTruncated`,
  `keyframeWarningCount`, `totals`); keyframe warnings are now reported
  instead of silently dropped.
- **Manual replacement hardened.** Concurrent runs are guarded, property
  matching uses the longest mapped id on word boundaries, script rewrites
  skip short digit runs (no more `wait(5)` corruption), mesh creation uses
  `Content.fromUri` with fallback, and manual scans cover `Teams`.
- **Patcher matches quoted and parenthesised asset ids** in script sources.
- **Frontend production safety.** The DevTools shortcut is dev-only (the
  backend command was already release-gated), the debug logger can no longer
  recurse through its own patched `console.error`, pause/resume keeps toggle
  state in sync with the backend, the splash update prompt auto-skips after
  two minutes, and `fetch_audio_quota` sends the `context` argument the
  backend declares.
- **Build no longer dirties `version.luau`** when the version is unchanged.

### Added

- **Fresh updater signing key.** The shipped `pubkey` was the documentation
  placeholder, so no update could ever verify. Set the `TAURI_PRIVATE_KEY`
  secret from the generated keypair for signed releases.
- **Tightened `connect-src` CSP.** The wildcard is gone; explicit localhost,
  IPC, and `https:` entries remain. No code path fetches remote plain-HTTP
  or remote WebSockets.

[3.0.3]: https://github.com/valency-studio/valencystudio-spoofer/releases/tag/v3.0.3
[3.0.2]: https://github.com/valency-studio/valencystudio-spoofer/releases/tag/v3.0.2
[3.0.1]: https://github.com/valency-studio/valencystudio-spoofer/releases/tag/v3.0.1
[3.0.0]: https://github.com/valency-studio/valencystudio-spoofer/releases/tag/v3.0.0
