import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { readText as readClipboardText } from '@tauri-apps/plugin-clipboard-manager';
import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import {
  type AudioQuotaDisplay,
  parseAudioQuota,
} from '../components/views/spoofing/ProfileDropdowns';
import { useConfig } from '../contexts/ConfigContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useStudioConnectionState } from '../contexts/StudioConnectionContext';
import { useConfigStore } from '../stores/configStore';
import { applyReplacements, useSpooferStore } from '../stores/spooferStore';
import { getStudioPlaceIdFallback } from '../utils/apiClient';
import { addDebugLog } from '../utils/debugLogger';
import { getAssetId } from '../utils/explorerTree';
import { type PendingSpoofRetry, takeSpoofRetry } from '../utils/jobTypes';
import { type PluginAsset } from '../utils/pluginBridge';
import type { RbxInstance } from '../utils/robloxPlaceParser/types';
import {
  loadCachedGroups,
  loadCachedUsers,
  logValencyStudio,
  normalizeId,
  type RobloxGroup,
  type RobloxUserInfo,
  saveCachedGroups,
  validateCookieProfile,
} from '../utils/robloxProfiles';
import { appendSpoofingLog } from '../utils/spoofingLogs';
import type { ScanOptions } from '../utils/studioScan';
import { triggerStudioScan } from '../utils/studioScan';
import { isTauriRuntime } from '../utils/tauriRuntime';

export type SpooferRunContext = {
  selectedUserId?: string;
  selectedGroupId?: string;
  cookie?: string;
  apiKey?: string;
  spoofSounds?: boolean;
  uploadTypes?: string[];
  account?: { id: string; name: string; avatarUrl: string };
  group?: { id: string; name: string; iconUrl: string } | null;
  placeName?: string;
  assetTypes?: Record<string, string>;
};

type ApiKeyOwnerDetectResult = {
  ok: boolean;
  ownerUserId?: string | null;
  message?: string;
};

type PendingQuotaRun = {
  assetIds: string[];
  audioCount: number;
  remaining: number;
  runContext?: SpooferRunContext;
};

/**
 * Headless spoofer controller.
 *
 * Owns every side effect that used to live in the always-mounted but hidden
 * `SpoofingView`: the `ValencyStudio-*` document events dispatched by
 * AssetExplorer, clipboard auto-queue, retry-on-boot, patch-result reporting and
 * the job launch path. Must stay mounted for the whole app session, otherwise
 * the AssetExplorer "Run" button has nothing listening to it.
 */
export function useSpooferController() {
  const { t } = useLanguage();
  const { studioPlaceId } = useStudioConnectionState();
  const { config, updateConfig, updateCategory } = useConfig();

  const {
    rootInstances,
    loadedFileName,
    selectedAssetIds,
    setSelectedAssetIds,
    setSelectedAssetKeys,
    setSpoofingLogs: setLogs,
    spoofCompletionVersion,
    lastReplacements,
    lastAssetResults,
    setIsSpoofing,
    setSpoofProgress,
    failedReplacements,
    setFailedReplacements,
    isScanningStudio: _isScanningStudio,
    setIsScanningStudio,
  } = useSpooferStore(
    useShallow((s) => ({
      rootInstances: s.rootInstances,
      loadedFileName: s.loadedFileName,
      selectedAssetIds: s.selectedAssetIds,
      setSelectedAssetIds: s.setSelectedAssetIds,
      setSelectedAssetKeys: s.setSelectedAssetKeys,
      setSpoofingLogs: s.setSpoofingLogs,
      spoofCompletionVersion: s.spoofCompletionVersion,
      lastReplacements: s.lastReplacements,
      lastAssetResults: s.lastAssetResults,
      setIsSpoofing: s.setIsSpoofing,
      setSpoofProgress: s.setSpoofProgress,
      failedReplacements: s.failedReplacements,
      setFailedReplacements: s.setFailedReplacements,
      isScanningStudio: s.isScanningStudio,
      setIsScanningStudio: s.setIsScanningStudio,
    })),
  );

  const [users, setUsers] = useState<RobloxUserInfo[]>(loadCachedUsers);
  const [groups, setGroups] = useState<RobloxGroup[]>(() =>
    loadCachedGroups(config.spoofing.selectedUser),
  );
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [resultsModalOpen, setResultsModalOpen] = useState(false);
  const [pasteIdsOpen, setPasteIdsOpen] = useState(false);
  const [scanOptionsOpen, setScanOptionsOpen] = useState(false);
  const [audioQuota, setAudioQuota] = useState<AudioQuotaDisplay>({ status: 'idle' });
  const [pendingQuotaRun, setPendingQuotaRun] = useState<PendingQuotaRun | null>(null);

  const handleRunSpooferRef = useRef<
    (
      overrideAssetIds?: string[],
      skipQuotaWarning?: boolean,
      runContext?: SpooferRunContext,
    ) => Promise<void>
  >(async () => {});

  const failedAssetResults = lastAssetResults.filter((result) => result.success === false);
  const failedAssetIds = Array.from(
    new Set(
      failedAssetResults
        .map((result) => String(result.id || '').replace(/\D/g, ''))
        .filter((id) => id.length > 0),
    ),
  );

  useEffect(() => {
    const cookie = config.spoofing.cookie.trim();
    if (!cookie || config.spoofing.selectedUser === 'none') {
      setAudioQuota({ status: 'idle' });
      return;
    }

    let cancelled = false;
    setAudioQuota({ status: 'loading' });
    invoke<unknown>('fetch_audio_quota', { cookie, autoDetect: false, context: null })
      .then((payload) => {
        if (cancelled) return;
        setAudioQuota(parseAudioQuota(payload) || { status: 'unavailable' });
      })
      .catch(() => {
        if (!cancelled) setAudioQuota({ status: 'unavailable' });
      });
    return () => {
      cancelled = true;
    };
  }, [spoofCompletionVersion, config.spoofing.cookie, config.spoofing.selectedUser]);

  useEffect(() => {
    const refreshUsers = () => setUsers(loadCachedUsers());
    window.addEventListener('storage', refreshUsers);
    window.addEventListener('focus', refreshUsers);
    return () => {
      window.removeEventListener('storage', refreshUsers);
      window.removeEventListener('focus', refreshUsers);
    };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime() || !config.advanced.clipboardMonitoring) return;

    let lastClipboardText = '';

    const pollClipboard = async () => {
      try {
        const text = await readClipboardText();
        if (text && text !== lastClipboardText) {
          lastClipboardText = text;

          const robloxUrlRegex =
            /(?:roblox\.com\/(?:library|catalog)\/|create\.roblox\.com\/store\/asset\/)(\d+)/i;
          const match = text.match(robloxUrlRegex);

          if (match && match[1]) {
            const assetId = match[1];

            const currentTargets = config.spoofing.extraAssetIds
              .split(/[\s,\n]+/)
              .map((t) => t.trim())
              .filter(Boolean);
            if (!currentTargets.includes(assetId)) {
              currentTargets.push(assetId);
              updateConfig('spoofing', 'extraAssetIds', currentTargets.join('\n'));

              import('@tauri-apps/plugin-notification')
                .then(({ sendNotification }) => {
                  sendNotification({
                    title: 'ValencyStudio - Spoofer',
                    body: `Auto-queued copied asset ID: ${assetId}`,
                  });
                })
                .catch((e) => {
                  console.warn('Failed to send notification for clipboard asset', e);
                });

              (window as any).clipboardSpoofAssetId = assetId;
              window.setTimeout(() => {
                document.dispatchEvent(
                  new CustomEvent('trigger-clipboard-spoof', {
                    detail: { assetId },
                  }),
                );
              }, 0);
            }
          }
        }
      } catch (e) {
        addDebugLog('error', ['Clipboard monitoring iteration failed', e]);
      }
    };

    const intervalId = setInterval(() => void pollClipboard(), 1500);
    return () => clearInterval(intervalId);
  }, [config.advanced.clipboardMonitoring, config.spoofing.extraAssetIds, updateConfig]);

  useEffect(() => {
    const userId = config.spoofing.selectedUser;
    const cachedGroups = loadCachedGroups(userId);
    setGroups(cachedGroups);

    if (!config.spoofing.cookie || !userId || userId === 'none') {
      setLoadingGroups(false);
      return;
    }

    let cancelled = false;
    const run = async () => {
      try {
        setLoadingGroups(true);
        const rawGroups = await invoke<RobloxGroup[]>('get_manageable_groups', {
          cookie: config.spoofing.cookie,
        });
        const groupIds = rawGroups.map((g) => String(g.id));
        const iconMap = await invoke<Record<string, string>>('get_group_icons_batch', {
          groupIds,
        }).catch(() => ({}) as Record<string, string>);

        const withIcons = rawGroups.map((group) => ({
          ...group,
          iconUrl: iconMap[String(group.id)] || undefined,
        }));
        if (!cancelled) {
          setGroups(withIcons);
          saveCachedGroups(userId, withIcons);
          const selectedGroupExists = withIcons.some(
            (group) => normalizeId(group.id) === normalizeId(config.spoofing.selectedGroup),
          );
          if (config.spoofing.selectedGroup !== 'none' && !selectedGroupExists) {
            updateConfig('spoofing', 'selectedGroup', 'none');
          }
        }
      } catch (e) {
        addDebugLog('warn', ['Failed to load manageable groups', e]);
        if (!cancelled) setGroups(cachedGroups);
      } finally {
        if (!cancelled) setLoadingGroups(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [config.spoofing.cookie, config.spoofing.selectedUser, updateConfig]);

  const handleSelectedUserChange = async (userId: string) => {
    if (!userId || userId === 'none') {
      updateCategory('spoofing', {
        selectedUser: 'none',
        selectedGroup: 'none',
        cookie: '',
      });
      setGroups([]);
      return;
    }

    let profileCookie = '';
    try {
      const secrets = await invoke<Record<string, Record<string, unknown>>>('load_profile_secrets');
      const storedProfileCookie = secrets?.profileCookies?.[userId];
      const candidate =
        typeof storedProfileCookie === 'string' && storedProfileCookie
          ? storedProfileCookie
          : secrets?.cookie;
      if (typeof candidate === 'string' && candidate) {
        const result = await validateCookieProfile(candidate);
        if (normalizeId(result.user.id) === normalizeId(userId)) {
          profileCookie = result.cookie;
        }
      }
    } catch (e) {
      addDebugLog('error', ['Failed to load profile secrets', e]);
      logValencyStudio(
        'warn',
        'The saved cookie for this Roblox profile could not be restored.',
        true,
      );
    }

    updateCategory('spoofing', {
      selectedUser: userId,
      selectedGroup: 'none',
      cookie: profileCookie,
    });
    setGroups(loadCachedGroups(userId));
  };

  const buildRetryRunContext = async (retry: PendingSpoofRetry): Promise<SpooferRunContext> => {
    const selectedUserId = retry.selectedUserId || config.spoofing.selectedUser;
    const selectedGroupId = retry.selectedGroupId ?? config.spoofing.selectedGroup;
    let cookie = config.spoofing.cookie.trim();
    const isGroupUpload = Boolean(selectedGroupId && selectedGroupId !== 'none');
    let apiKey =
      (isGroupUpload
        ? config.spoofing.groupApiKey?.trim() || config.spoofing.apiKey?.trim()
        : config.spoofing.apiKey?.trim() || config.spoofing.groupApiKey?.trim()) || '';

    try {
      const secrets =
        await invoke<Record<string, Record<string, unknown> | unknown>>('load_profile_secrets');
      if (isGroupUpload && typeof secrets?.groupApiKey === 'string' && secrets.groupApiKey.trim()) {
        apiKey = secrets.groupApiKey.trim();
      } else if (typeof secrets?.apiKey === 'string' && secrets.apiKey.trim()) {
        apiKey = secrets.apiKey.trim();
      }

      const profileCookies = secrets?.profileCookies;
      const storedProfileCookie =
        profileCookies &&
        typeof profileCookies === 'object' &&
        !Array.isArray(profileCookies) &&
        selectedUserId
          ? (profileCookies as Record<string, unknown>)[selectedUserId]
          : undefined;
      const candidate =
        typeof storedProfileCookie === 'string' && storedProfileCookie
          ? storedProfileCookie
          : typeof secrets?.cookie === 'string'
            ? secrets.cookie
            : cookie;

      if (candidate) {
        const result = await validateCookieProfile(candidate);
        if (
          !selectedUserId ||
          selectedUserId === 'none' ||
          normalizeId(result.user.id) === normalizeId(selectedUserId)
        ) {
          cookie = result.cookie;
        }
      }
    } catch (e) {
      addDebugLog('error', ['Failed to validate cookie profile during retry load', e]);
      logValencyStudio('warn', 'The saved cookie for this retry could not be restored.', true);
    }

    return {
      selectedUserId,
      selectedGroupId,
      cookie,
      apiKey,
      spoofSounds: retry.spoofSounds ?? config.spoofing.audio,
      uploadTypes: retry.uploadTypes ?? config.spoofing.uploadTypes,
      account: retry.account,
      group: retry.group,
      assetTypes: retry.assetTypes,
    };
  };

  const handleScanStudio = async (options?: ScanOptions) => {
    setIsScanningStudio(true);
    try {
      setLogs((prev) => appendSpoofingLog(prev, '[INFO] Scanning Roblox Studio for assets...\n'));
      await triggerStudioScan(options);
      const { invoke } = await import('@tauri-apps/api/core');
      const snapshots = await invoke<{
        anims: { assets: PluginAsset[] };
        sounds: { assets: PluginAsset[] };
        images: { assets: PluginAsset[] };
        meshes: { assets: PluginAsset[] };
        scriptRefs: { assets: PluginAsset[] };
      }>('get_studio_asset_snapshots');

      let totalAssets = 0;
      if (snapshots) {
        totalAssets += snapshots.anims?.assets?.length || 0;
        totalAssets += snapshots.sounds?.assets?.length || 0;
        totalAssets += snapshots.images?.assets?.length || 0;
        totalAssets += snapshots.meshes?.assets?.length || 0;
        totalAssets += snapshots.scriptRefs?.assets?.length || 0;
      }

      if (totalAssets === 0) {
        setLogs((prev) =>
          appendSpoofingLog(
            prev,
            '[INFO] Studio scan finished. No spoofable assets found in this place.\n',
          ),
        );
        logValencyStudio('info', 'Studio scan finished. No assets found.', true);
      } else {
        setLogs((prev) =>
          appendSpoofingLog(prev, `[SUCCESS] Studio Scan Complete! Found ${totalAssets} assets.\n`),
        );
        logValencyStudio('info', `Studio scan completed. Found ${totalAssets} assets.`, true);
      }
    } catch (error) {
      logValencyStudio('error', `Studio scan failed: ${String(error)}`, true);
      setLogs((prev) => appendSpoofingLog(prev, `[ERROR] Studio scan failed: ${String(error)}\n`));
    } finally {
      setTimeout(() => setIsScanningStudio(false), 600);
    }
  };

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let unlisten: (() => void) | undefined;
    const setupListener = async () => {
      unlisten = await listen<{ failedPatches: string[] }>('patch-results', (event) => {
        if (event.payload?.failedPatches?.length > 0) {
          setFailedReplacements(new Set(event.payload.failedPatches));
          setLogs((prev) =>
            appendSpoofingLog(
              prev,
              `[WARN] ${event.payload.failedPatches.length} studio replacement(s) failed to apply.\n`,
            ),
          );
        } else {
          setFailedReplacements(new Set());
        }
      });
    };

    void setupListener();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const handleRetryReplacement = async () => {
    if (Object.keys(lastReplacements).length === 0) return;
    await applyReplacements(lastReplacements);
  };

  const validateApiKeyForRun = async (apiKey: string, selectedUser: string): Promise<boolean> => {
    if (apiKey.length < 20) {
      logValencyStudio(
        'warn',
        'Add an Open Cloud API key with Assets read/write access before spoofing.',
        true,
      );
      setLogs((prev) =>
        appendSpoofingLog(
          prev,
          '[WARN] Open Cloud API key missing. Create a key with Assets read/write permissions for the selected user or group.\n',
        ),
      );
      return false;
    }

    try {
      const result = await invoke<ApiKeyOwnerDetectResult>('detect_opencloud_api_key_owner', {
        key: apiKey,
      });
      const message = result.message || 'No validation details returned.';
      if (!result.ok && /invalid|unauthorized/i.test(message)) {
        logValencyStudio('warn', message, true);
        setLogs((prev) => appendSpoofingLog(prev, `[WARN] ${message}\n`));
        return false;
      }

      if (result.ok) {
        if (
          result.ownerUserId &&
          selectedUser !== 'none' &&
          normalizeId(result.ownerUserId) !== normalizeId(selectedUser)
        ) {
          setLogs((prev) =>
            appendSpoofingLog(
              prev,
              `[WARN] Open Cloud API key appears to belong to user ${result.ownerUserId}, while the selected profile is ${selectedUser}. Group uploads can still work if the key has creator access.\n`,
            ),
          );
        }
      } else {
        setLogs((prev) =>
          appendSpoofingLog(
            prev,
            `[WARN] Could not fully verify the Open Cloud API key (${message}). Continuing; Roblox will reject uploads if the key lacks Assets read/write permissions.\n`,
          ),
        );
      }
      return true;
    } catch (error) {
      setLogs((prev) =>
        appendSpoofingLog(
          prev,
          `[WARN] Open Cloud API key preflight failed (${String(error)}). Continuing; Roblox will reject uploads if the key is invalid.\n`,
        ),
      );
      return true;
    }
  };

  const handleRunSpoofer = async (
    overrideAssetIds?: string[],
    skipQuotaWarning = false,
    runContext?: SpooferRunContext,
  ) => {
    if (useSpooferStore.getState().isSpoofing) {
      logValencyStudio(
        'warn',
        'A spoofing job is already running. Wait for it to finish or use Force Reset.',
        true,
      );
      return;
    }

    const selectedUser = runContext?.selectedUserId ?? config.spoofing.selectedUser;
    const selectedGroup = runContext?.selectedGroupId ?? config.spoofing.selectedGroup;

    const isGroupUpload = selectedGroup !== 'none';
    const effectiveApiKey = isGroupUpload
      ? config.spoofing.groupApiKey?.trim() || config.spoofing.apiKey?.trim() || ''
      : config.spoofing.apiKey?.trim() || config.spoofing.groupApiKey?.trim() || '';

    const cookie = (runContext?.cookie ?? config.spoofing.cookie).trim();
    const apiKey = (runContext?.apiKey ?? effectiveApiKey).trim();

    const spoofSounds = runContext?.spoofSounds ?? config.spoofing.audio;
    const uploadTypes = runContext?.uploadTypes ?? config.spoofing.uploadTypes;

    if (cookie.length < 50) {
      const msg =
        'Cannot start spoofer: no valid Roblox cookie. Open Accounts and paste a fresh .ROBLOSECURITY value, then try again.';
      logValencyStudio('warn', msg, true);
      setLogs((prev) => appendSpoofingLog(prev, `[WARN] ${msg}\n`));
      return;
    }

    try {
      await validateCookieProfile(cookie);
    } catch (e) {
      addDebugLog('warn', ['Pre-spoofing cookie validation failed', e]);
      const msg =
        'Cannot start spoofer: the current Roblox cookie is invalid or expired. Refresh the cookie in Accounts.';
      logValencyStudio('warn', msg, true);
      setLogs((prev) => appendSpoofingLog(prev, `[WARN] ${msg}\n`));
      return;
    }

    const extraIdsParsed = config.spoofing.extraAssetIds
      .split(/[\s,]+/)
      .map((id) => id.replace(/\D/g, ''))
      .filter((id) => id.length > 0);

    const extraIdsSet = new Set(extraIdsParsed);
    const assetInfoMap = new Map<string, { type: string; name: string; rawValue?: string }>();

    const gatherAllInfo = (nodes: RbxInstance[]) => {
      for (const node of nodes) {
        for (const asset of node.assets) {
          const id = getAssetId(asset);
          if (id && asset.type) {
            assetInfoMap.set(id, {
              type: asset.type,
              name: asset.instanceName || asset.path || node.name || `Asset ${id}`,
              rawValue: asset.rawValue,
            });
          }
        }
        if (node.children) gatherAllInfo(node.children);
      }
    };
    gatherAllInfo(rootInstances);

    useSpooferStore.getState().setAssetMetadataMap(Object.fromEntries(assetInfoMap));

    const shouldIncludeId = (id: string) => {
      const isMockKFS = id.startsWith('RAW_KFS_');
      if (!isMockKFS) {
        const numId = parseInt(id, 10);
        if (isNaN(numId) || numId < 10000) return false;
      }
      const type = assetInfoMap.get(id)?.type;
      if (type === 'plugin') return false;
      return true;
    };

    const finalAssetIds = new Set<string>();
    if (overrideAssetIds) {
      overrideAssetIds.forEach((id) => {
        if (shouldIncludeId(id)) finalAssetIds.add(id);
      });
    } else {
      extraIdsSet.forEach((id) => {
        if (shouldIncludeId(id)) finalAssetIds.add(id);
      });
      selectedAssetIds.forEach((id) => {
        if (shouldIncludeId(id)) finalAssetIds.add(id);
      });
    }

    if (finalAssetIds.size === 0) {
      const msg =
        'Cannot start spoofer: no valid asset IDs found. Paste some IDs into "Additional IDs to Spoof", load a place file, or scan Studio first.';
      logValencyStudio('warn', msg, true);
      setLogs((prev) => appendSpoofingLog(prev, `[WARN] ${msg}\n`));
      return;
    }

    const audioAssetIds = new Set<string>();
    const gatherAudioIds = (nodes: RbxInstance[]) => {
      for (const node of nodes) {
        for (const asset of node.assets) {
          if (asset.type === 'audio') {
            const id = getAssetId(asset);
            if (id) audioAssetIds.add(id);
          }
        }
        if (node.children) gatherAudioIds(node.children);
      }
    };
    gatherAudioIds(rootInstances);
    const selectedAudioCount = Array.from(finalAssetIds).filter((id) =>
      audioAssetIds.has(id),
    ).length;
    if (
      !skipQuotaWarning &&
      audioQuota.status === 'ready' &&
      selectedAudioCount > audioQuota.remaining
    ) {
      setPendingQuotaRun({
        assetIds: Array.from(finalAssetIds),
        audioCount: selectedAudioCount,
        remaining: audioQuota.remaining,
        runContext,
      });
      return;
    }

    const store = useConfigStore.getState();
    const downloaderName =
      store.config.accounts.find((a) => {
        const secrets = store.accountSecrets[a.id];
        return secrets?.cookie === cookie;
      })?.name || t('accounts.anonymousDownloader');

    const uploaderName =
      store.config.accounts.find((a) => {
        const secrets = store.accountSecrets[a.id];
        return secrets?.apiKey === apiKey;
      })?.name || t('accounts.anonymousUploader');

    setLogs([
      `[INFO] Job initialized. Downloader: ${downloaderName} | Uploader: ${uploaderName}\n`,
    ]);
    const apiKeyReady = await validateApiKeyForRun(apiKey, selectedUser);
    if (!apiKeyReady) return;

    const finalAssetsPayload = Array.from(finalAssetIds).map((id) => {
      const info = assetInfoMap.get(id);
      const overrideType = runContext?.assetTypes?.[id];
      const normalizedOverrideType =
        overrideType &&
        ['animation', 'audio', 'mesh', 'image', 'script_ref', 'raw_keyframe_sequence'].includes(
          overrideType,
        )
          ? overrideType
          : undefined;
      const type = normalizedOverrideType
        ? normalizedOverrideType
        : info?.type === 'plugin'
          ? 'animation'
          : info?.type || 'animation';
      const name = info?.name || `Asset ${id}`;
      return { id, type, name, rawValue: info?.rawValue };
    });

    setSpoofProgress(0);
    setIsSpoofing(true);

    try {
      const currentUser = users.find((user) => String(user.id) === String(selectedUser));
      const currentGroup = groups.find((group) => String(group.id) === String(selectedGroup));
      const accountPayload = runContext?.account || {
        id: String(currentUser?.id || selectedUser),
        name: currentUser?.displayName || currentUser?.name || 'Unknown',
        avatarUrl: currentUser?.avatarUrl || '',
      };
      const groupPayload =
        selectedGroup !== 'none'
          ? runContext?.group ||
            (currentGroup
              ? {
                  id: String(currentGroup.id),
                  name: currentGroup.name,
                  iconUrl: currentGroup.iconUrl || '',
                }
              : {
                  id: String(selectedGroup),
                  name: 'Group upload',
                  iconUrl: '',
                })
          : null;
      const studioPlaceIdFallback = studioPlaceId || (await getStudioPlaceIdFallback());

      const allAccounts = config.accounts || [];
      const accountSecrets = useConfigStore.getState().accountSecrets;
      const fallbackCookies = allAccounts
        .filter((a) => a.isDownloader && a.id !== selectedUser)
        .map((a) => accountSecrets[a.id]?.cookie)
        .filter(Boolean) as string[];

      const assetForcePlaceIds = useSpooferStore.getState().assetForcePlaceIds || {};
      const allForcedPlaceIds = Array.from(
        new Set(
          finalAssetsPayload
            .map((a) => assetForcePlaceIds[a.id]?.trim() || studioPlaceIdFallback?.trim())
            .filter((p): p is string => Boolean(p && p.length > 0)),
        ),
      ).join(',');

      const baseData = {
        cookie,
        fallbackCookies: fallbackCookies.length > 0 ? fallbackCookies : null,
        apiKey,
        groupId: selectedGroup !== 'none' ? selectedGroup : null,
        spoofSounds,
        uploadTypes: config.spoofing.downloadOnly ? ['download'] : uploadTypes,
        downloadPath: config.spoofing.downloadPath,
        placeName: runContext?.placeName || loadedFileName,
        concurrent: config.advanced.concurrentSpoofing,
        concurrentDownloading: config.advanced.concurrentDownloading,
        maxConcurrency: config.advanced.maxConcurrency,
        maxDownloadConcurrency: config.advanced.maxDownloadConcurrency,
        skipOwned: config.advanced.skipOwned,
        excludedUserIds: config.advanced.excludedUserIds,
        excludedGroupIds: config.advanced.excludedGroupIds,
        skipExistingReplacements: !overrideAssetIds && !skipQuotaWarning && !runContext,
        existingReplacements: lastReplacements,
        account: accountPayload,
        group: groupPayload,
        preserveMetadata: config.spoofing.preserveMetadata,
        enableArchiveRecovery: config.advanced.enableArchiveRecovery,
        proxyUrl: config.advanced.proxyUrl,
        operationPollIntervalMs: config.advanced.operationPollIntervalMs || 250,
      };

      useSpooferStore.getState().setSpoofTotalCount(finalAssetsPayload.length);
      useSpooferStore.getState().setSpoofCurrentCount(0);

      const storeState = useSpooferStore.getState();
      for (const item of finalAssetsPayload) {
        storeState.setAssetStatus(item.id, {
          stage: 'downloading',
          message: 'Queued for spoofing...',
        });
      }

      await invoke('run_spoofer_action', {
        data: {
          ...baseData,
          assets: JSON.stringify(finalAssetsPayload),
          forcePlaceIds: allForcedPlaceIds || null,
          assetForcePlaceIds:
            Object.keys(assetForcePlaceIds).length > 0 ? assetForcePlaceIds : null,
        },
      });
    } catch (err) {
      logValencyStudio(
        'error',
        `Could not launch the spoofer: ${err instanceof Error ? err.message : String(err)}`,
        true,
      );
      setIsSpoofing(false);
    }
  };

  handleRunSpooferRef.current = handleRunSpoofer;

  useEffect(() => {
    const onOpenScan = () => setScanOptionsOpen(true);
    const onRun = (e?: Event) => {
      const detail = (e as CustomEvent)?.detail;
      if (detail?.targetPaths) {
        useSpooferStore.getState().setTargetPathsMap(detail.targetPaths);
      }
      void handleRunSpooferRef.current(detail?.assetIds);
    };
    const onOpenPaste = () => setPasteIdsOpen(true);
    const onStartScan = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      void handleScanStudio(detail);
    };
    const onDiscoverPlaceIds = async (e?: Event) => {
      const store = useSpooferStore.getState();
      const cookie = config.spoofing.cookie;
      const detail = (e as CustomEvent)?.detail;
      const timeoutSecs = detail?.timeoutSecs ?? store.discoveryTimeoutSecs ?? 60;

      if (!cookie || cookie.length < 50) {
        logValencyStudio(
          'warn',
          'Please select an active account with a valid cookie to discover place IDs.',
          false,
        );
        return;
      }

      const selectedSet = store.selectedAssetIds;
      const targetAssetIds: string[] = [];
      if (selectedSet.size > 0) {
        targetAssetIds.push(...Array.from(selectedSet));
      } else {
        const collectIds = (nodes: typeof store.rootInstances) => {
          for (const node of nodes) {
            for (const asset of node.assets) {
              const id = asset.assetId || (asset as any).id;
              if (id) targetAssetIds.push(id);
            }
            collectIds(node.children);
          }
        };
        collectIds(store.rootInstances);
      }

      if (targetAssetIds.length === 0) {
        logValencyStudio(
          'warn',
          'No assets were found in the explorer to discover place IDs for. Please scan a place or select assets first.',
          false,
        );
        return;
      }

      store.setIsDiscoveringPlaceIds(true);
      logValencyStudio(
        'info',
        `Discovering place IDs in parallel for ${targetAssetIds.length} asset(s) (${timeoutSecs}s limit/asset)...`,
        false,
      );

      let discoveredCount = 0;
      const CONCURRENCY_LIMIT = config.advanced.discoveryConcurrency ?? 30;

      const discoverSingleAsset = async (assetId: string) => {
        store.setAssetStatus(assetId, {
          stage: 'discovering_graph',
          message: 'Discovering Place ID...',
        });

        try {
          const existingPinned = store.assetForcePlaceIds[assetId] || null;
          const discoveryPromise = invoke<string | null>('discover_asset_place_id', {
            assetId,
            cookie,
            forcedPlaceId: existingPinned,
          });

          const timeoutPromise = new Promise<null>((resolve) =>
            setTimeout(() => resolve(null), timeoutSecs * 1000),
          );

          const discoveredPid = await Promise.race([discoveryPromise, timeoutPromise]);

          if (discoveredPid) {
            discoveredCount++;
            store.setAssetForcePlaceIds((prev) => ({
              ...prev,
              [assetId]: discoveredPid,
            }));
            store.setAssetStatus(assetId, {
              stage: 'done',
              message: `Discovered Place ID: ${discoveredPid}`,
            });
          } else {
            store.setAssetStatus(assetId, {
              stage: 'error',
              message: 'Discovery failed — no working Place ID found',
            });
          }
        } catch {
          store.setAssetStatus(assetId, {
            stage: 'error',
            message: 'Discovery failed — place lookup error',
          });
        }
      };

      try {
        const batchStartTime = Date.now();
        const queue = [...targetAssetIds];
        const workers = Array.from(
          { length: Math.min(CONCURRENCY_LIMIT, queue.length) },
          async () => {
            while (queue.length > 0) {
              const nextAssetId = queue.shift();
              if (nextAssetId) {
                await discoverSingleAsset(nextAssetId);
              }
            }
          },
        );
        await Promise.all(workers);

        const durationMs = Date.now() - batchStartTime;
        const avgMsPerAsset = Math.round(durationMs / Math.max(1, targetAssetIds.length));
        const durationSec = (durationMs / 1000).toFixed(2);

        if (discoveredCount > 0) {
          logValencyStudio(
            'success',
            `Discovery complete for ${targetAssetIds.length} asset(s) in ${durationSec}s (${avgMsPerAsset}ms/asset, ${discoveredCount} resolved).`,
            false,
          );
        } else {
          logValencyStudio(
            'warn',
            `Discovery completed in ${durationSec}s, but no working place IDs were found.`,
            false,
          );
        }
      } catch (err) {
        logValencyStudio('error', `Place ID discovery failed: ${String(err)}`, false);
      } finally {
        store.setIsDiscoveringPlaceIds(false);
      }
    };
    document.addEventListener('ValencyStudio-open-scan-options', onOpenScan);
    document.addEventListener('ValencyStudio-run-spoofer', onRun);
    document.addEventListener('ValencyStudio-open-paste-ids', onOpenPaste);
    document.addEventListener('ValencyStudio-start-scan', onStartScan);
    document.addEventListener('ValencyStudio-discover-place-ids', onDiscoverPlaceIds);
    return () => {
      document.removeEventListener('ValencyStudio-open-scan-options', onOpenScan);
      document.removeEventListener('ValencyStudio-run-spoofer', onRun);
      document.removeEventListener('ValencyStudio-open-paste-ids', onOpenPaste);
      document.removeEventListener('ValencyStudio-start-scan', onStartScan);
      document.removeEventListener('ValencyStudio-discover-place-ids', onDiscoverPlaceIds);
    };
  }, []);

  const handleRetryFailedAssets = async () => {
    if (failedAssetIds.length === 0 && failedReplacements.size === 0) return;

    if (failedReplacements.size > 0) {
      void handleRetryReplacement();
    }

    if (failedAssetIds.length > 0) {
      const assetTypes = failedAssetResults.reduce<Record<string, string>>((acc, result) => {
        const id = String(result.id || '').replace(/\D/g, '');
        const type = String(result.type || result.assetType || '');
        if (id && type) acc[id] = type;
        return acc;
      }, {});

      setSelectedAssetIds(new Set(failedAssetIds));
      setSelectedAssetKeys(new Set(failedAssetIds));
      setLogs((prev) =>
        appendSpoofingLog(prev, `[INFO] Retrying ${failedAssetIds.length} failed asset(s)...\n`),
      );
      await handleRunSpooferRef.current(failedAssetIds, false, { assetTypes });
    }
  };

  useEffect(() => {
    const handleClipboardSpoof = (event: Event) => {
      const assetId =
        event instanceof CustomEvent && typeof event.detail?.assetId === 'string'
          ? event.detail.assetId
          : null;
      if (!assetId) return;
      void handleRunSpooferRef.current([assetId], true);
    };
    document.addEventListener('trigger-clipboard-spoof', handleClipboardSpoof);
    return () => document.removeEventListener('trigger-clipboard-spoof', handleClipboardSpoof);
  }, []);

  useEffect(() => {
    const retry = takeSpoofRetry();
    if (!retry) return;

    let cancelled = false;
    let timeout: number | undefined;
    const run = async () => {
      const retryContext = await buildRetryRunContext(retry);
      if (cancelled) return;

      const spoofingUpdates: Partial<typeof config.spoofing> = {
        selectedUser: retryContext.selectedUserId || 'none',
        selectedGroup: retryContext.selectedGroupId || 'none',
        audio: retryContext.spoofSounds ?? config.spoofing.audio,
        cookie: retryContext.cookie || config.spoofing.cookie,
      };
      if (retryContext.uploadTypes) {
        spoofingUpdates.uploadTypes = retryContext.uploadTypes;
      }
      updateCategory('spoofing', spoofingUpdates);
      setSelectedAssetIds(new Set(retry.assetIds));
      setSelectedAssetKeys(new Set(retry.assetIds));
      setLogs([`Retrying ${retry.assetIds.length} failed asset(s)...`]);

      timeout = window.setTimeout(() => {
        void handleRunSpooferRef.current(retry.assetIds, false, retryContext);
      }, 0);
    };

    void run();
    return () => {
      cancelled = true;
      if (timeout) window.clearTimeout(timeout);
    };
  }, []);

  return {
    // Overlay visibility, driven by the ValencyStudio-* document events.
    resultsModalOpen,
    closeResultsModal: () => setResultsModalOpen(false),
    openResultsModal: () => setResultsModalOpen(true),
    pasteIdsOpen,
    setPasteIdsOpen,
    scanOptionsOpen,
    setScanOptionsOpen,
    pendingQuotaRun,
    continuePendingQuotaRun: () => {
      const assetIds = pendingQuotaRun?.assetIds;
      const runContext = pendingQuotaRun?.runContext;
      setPendingQuotaRun(null);
      if (assetIds) void handleRunSpooferRef.current(assetIds, true, runContext);
    },
    cancelPendingQuotaRun: () => setPendingQuotaRun(null),
    scanStudio: handleScanStudio,
    retryFailedAssets: handleRetryFailedAssets,
    runSpoofer: handleRunSpoofer,
    // Kept for the workspace UI rebuilt in a later phase.
    selectedUser: config.spoofing.selectedUser,
    selectedGroup: config.spoofing.selectedGroup,
    changeSelectedUser: handleSelectedUserChange,
    groups,
    users,
    loadingGroups,
    audioQuota,
    failedAssetIds,
    failedReplacements,
    isScanningStudio: _isScanningStudio,
  };
}

export type SpooferController = ReturnType<typeof useSpooferController>;
