import { invoke } from '@tauri-apps/api/core';
import { open as openFilePicker } from '@tauri-apps/plugin-dialog';
import {
  Check,
  ChevronDown,
  CircleAlert,
  ClipboardPaste,
  Copy,
  Download,
  FolderOpen,
  Loader2,
  Lock,
  MapPin,
  Play,
  RotateCcw,
  ScanSearch,
  Settings2,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';

import { useConfig } from '../../contexts/ConfigContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { useStudioConnectionState } from '../../contexts/StudioConnectionContext';
import { useStudioAssetPoll } from '../../hooks/useStudioAssetPoll';
import { cn } from '../../lib/utils';
import { useSpooferStore } from '../../stores/spooferStore';
import { buildDataModelTree, getAssetId } from '../../utils/explorerTree';
import type { PluginAsset, PluginAssetStore } from '../../utils/pluginBridge';
import { stopRobloxAudio } from '../../utils/robloxAudio';
import type { ParsedAssetRef, RbxInstance } from '../../utils/robloxPlaceParser/types';
import { logValencyStudio } from '../../utils/robloxProfiles';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { AssetTypePicker, SCAN_ASSET_TYPES } from '../shared/AssetTypePicker';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import AssetInspectorPanel from './asset-explorer/AssetInspectorPanel';
import { ExplorerTreeNode, getAssetKey } from './asset-explorer/ExplorerTree';

interface AssetExplorerProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  onScanReceived?: () => void;
  mode?: 'drawer' | 'main';
}

export default function AssetExplorer({
  isOpen: _isOpen,
  setIsOpen: _setIsOpen,
  onScanReceived,
  mode: _mode = 'drawer',
}: AssetExplorerProps) {
  const { t } = useLanguage();
  const searchQuery = useSpooferStore((s) => s.searchQuery);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const activeAssetFilters = useSpooferStore((s) => s.activeAssetFilters);
  const ghostAssetIds = useSpooferStore((s) => s.ghostAssetIds);
  const showToast = useSpooferStore((s) => s.showToast);

  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [lockOpen, setLockOpen] = useState(false);
  const [placeIdInput, setPlaceIdInput] = useState('');
  const [confirmClearPins, setConfirmClearPins] = useState(false);
  const [spoofModeOpen, setSpoofModeOpen] = useState(false);
  const [scanTypes, setScanTypes] = useState<Set<string>>(new Set(SCAN_ASSET_TYPES));
  const [showScanOptions, setShowScanOptions] = useState(false);

  const toggleScanType = (key: string) => {
    setScanTypes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const [targetedPath, setTargetedPath] = useState('');
  const [targetedScanOpen, setTargetedScanOpen] = useState(false);

  const isInspectorOpen = useSpooferStore((s) => s.isInspectorOpen);
  const isPropertiesOpen = useSpooferStore((s) => s.isPropertiesOpen);
  const isRightPanelOpen = isInspectorOpen || isPropertiesOpen;

  const activeInspectAsset = useSpooferStore((s) => s.activeInspectAsset);
  const setActiveInspectAsset = useSpooferStore((s) => s.setActiveInspectAsset);

  const handleRunTargetedScan = (pathOverride?: string) => {
    const p = pathOverride || targetedPath;
    if (!p.trim()) return;
    const types = SCAN_ASSET_TYPES.filter((k) => scanTypes.has(k));
    document.dispatchEvent(
      new CustomEvent('ValencyStudio-start-scan', {
        detail: { scanTypes: types, scanPath: p.trim() },
      }),
    );
    setTargetedScanOpen(false);
  };

  const discoveryTimeoutSecs = useSpooferStore((s) => s.discoveryTimeoutSecs);
  const setDiscoveryTimeoutSecs = useSpooferStore((s) => s.setDiscoveryTimeoutSecs);
  const assetForcePlaceIds = useSpooferStore((s) => s.assetForcePlaceIds) ?? {};
  const setAssetForcePlaceIds = useSpooferStore((s) => s.setAssetForcePlaceIds);
  const clearAssetForcePlaceIds = useSpooferStore((s) => s.clearAssetForcePlaceIds);

  const { config, updateConfig } = useConfig();
  const rootInstances = useSpooferStore((s) => s.rootInstances);
  const setRootInstances = useSpooferStore((s) => s.setRootInstances);
  const setLoadedFileName = useSpooferStore((s) => s.setLoadedFileName);
  const setLoadedFilePath = useSpooferStore((s) => s.setLoadedFilePath);
  const selectedAssetIds = useSpooferStore((s) => s.selectedAssetIds);
  const setSelectedAssetIds = useSpooferStore((s) => s.setSelectedAssetIds);
  const selectedAssetKeys = useSpooferStore((s) => s.selectedAssetKeys);
  const setSelectedAssetKeys = useSpooferStore((s) => s.setSelectedAssetKeys);
  const isScanningStudio = useSpooferStore((s) => s.isScanningStudio);
  const lastScanTime = useSpooferStore((s) => s.lastScanTime);
  const isSpoofing = useSpooferStore((s) => s.isSpoofing);
  const isReplacing = useSpooferStore((s) => s.isReplacing);
  const isGrantingPermissions = useSpooferStore((s) => s.isGrantingPermissions);
  const lastReplacements = useSpooferStore((s) => s.lastReplacements) ?? {};
  const storedReplacementsCount = Object.keys(lastReplacements).length;
  const isDiscoveringPlaceIds = useSpooferStore((s) => s.isDiscoveringPlaceIds);
  const spoofProgress = useSpooferStore((s) => s.spoofProgress);
  const spoofStatusText = useSpooferStore((s) => s.spoofStatusText);
  const spoofCurrentCount = useSpooferStore((s) => s.spoofCurrentCount);
  const spoofTotalCount = useSpooferStore((s) => s.spoofTotalCount);
  const spoofStartTime = useSpooferStore((s) => s.spoofStartTime);
  const replaceCurrentCount = useSpooferStore((s) => s.replaceCurrentCount);
  const replaceTotalCount = useSpooferStore((s) => s.replaceTotalCount);
  const replaceStartTime = useSpooferStore((s) => s.replaceStartTime);
  const permissionsCurrentCount = useSpooferStore((s) => s.permissionsCurrentCount);
  const permissionsTotalCount = useSpooferStore((s) => s.permissionsTotalCount);
  const permissionsStartTime = useSpooferStore((s) => s.permissionsStartTime);
  const busy = isScanningStudio || isSpoofing || isReplacing || isGrantingPermissions;

  const [activeEta, setActiveEta] = useState<string | null>(null);

  useEffect(() => {
    if (!isSpoofing && !isReplacing && !isGrantingPermissions) {
      setActiveEta(null);
      return;
    }
    const computeEta = (
      startTime: number | null,
      current: number,
      total: number,
    ): string | null => {
      if (!startTime || total <= 0 || current <= 0) return null;
      const elapsedMs = Date.now() - startTime;
      if (elapsedMs < 1000) return null;
      const rate = current / (elapsedMs / 1000);
      if (rate <= 0) return null;
      const remaining = Math.max(0, total - current);
      if (remaining === 0) return null;
      const remainingSec = Math.ceil(remaining / rate);
      if (remainingSec < 60) return `ETA: ${remainingSec}s`;
      if (remainingSec < 3600) {
        const mins = Math.floor(remainingSec / 60);
        const secs = remainingSec % 60;
        return `ETA: ${mins}m ${secs.toString().padStart(2, '0')}s`;
      }
      const hrs = Math.floor(remainingSec / 3600);
      const mins = Math.floor((remainingSec % 3600) / 60);
      return `ETA: ${hrs}h ${mins}m`;
    };

    const updateCurrentEta = () => {
      if (isSpoofing) {
        setActiveEta(computeEta(spoofStartTime, spoofCurrentCount, spoofTotalCount));
      } else if (isReplacing) {
        setActiveEta(computeEta(replaceStartTime, replaceCurrentCount, replaceTotalCount));
      } else if (isGrantingPermissions) {
        setActiveEta(
          computeEta(permissionsStartTime, permissionsCurrentCount, permissionsTotalCount),
        );
      }
    };

    updateCurrentEta();
    const interval = setInterval(updateCurrentEta, 1000);
    return () => clearInterval(interval);
  }, [
    isSpoofing,
    isReplacing,
    isGrantingPermissions,
    spoofStartTime,
    spoofCurrentCount,
    spoofTotalCount,
    replaceStartTime,
    replaceCurrentCount,
    replaceTotalCount,
    permissionsStartTime,
    permissionsCurrentCount,
    permissionsTotalCount,
  ]);

  const { studioConnected, scanStatus, studioPlaceId, studioPlaceName } =
    useStudioConnectionState();

  const studioDisplayName = useMemo(() => {
    if (studioPlaceName && studioPlaceName.trim() !== '') return studioPlaceName;
    if (studioPlaceId && studioPlaceId !== '0') return `Place ${studioPlaceId}`;
    return 'Studio Session';
  }, [studioPlaceName, studioPlaceId]);

  const lastStudioSnapshotRef = useRef('');

  const processStudioData = useCallback(
    (
      anims: PluginAssetStore,
      sounds: PluginAssetStore,
      images: PluginAssetStore,
      meshes: PluginAssetStore,
      scriptRefs: PluginAssetStore,
    ) => {
      const animationAssets = anims.assets ?? [];
      const soundAssets = sounds.assets ?? [];
      const imageAssets = images.assets ?? [];
      const meshAssets = meshes.assets ?? [];
      const scriptRefAssets = scriptRefs.assets ?? [];

      const snapshot =
        [animationAssets, soundAssets, imageAssets, meshAssets, scriptRefAssets]
          .flatMap((assets, i) => assets.map((a) => `${i}:${a.assetId ?? ''}`).sort())
          .join('|') || 'EMPTY';
      if (snapshot === lastStudioSnapshotRef.current) return;
      lastStudioSnapshotRef.current = snapshot;

      const includeAnims = scanTypes.has('animations');
      const includeSounds = scanTypes.has('sounds');
      const includeImages = scanTypes.has('images');
      const includeMeshes = scanTypes.has('meshes');
      const includeScripts = scanTypes.has('scripts');

      const allInitialAssets: { asset: PluginAsset; type: ParsedAssetRef['type'] }[] = [
        ...(includeAnims
          ? animationAssets.map((asset) => ({ asset, type: 'animation' as const }))
          : []),
        ...(includeSounds ? soundAssets.map((asset) => ({ asset, type: 'audio' as const })) : []),
        ...(includeImages ? imageAssets.map((asset) => ({ asset, type: 'image' as const })) : []),
        ...(includeMeshes ? meshAssets.map((asset) => ({ asset, type: 'mesh' as const })) : []),
      ];

      const children = buildDataModelTree(allInitialAssets);

      if (children.length === 0 && scriptRefAssets.length === 0) {
        return;
      }

      const studioNode: RbxInstance = {
        referent: 'studio-root',
        className: 'Place',
        name: studioDisplayName,
        assets: [],
        children,
      };

      setRootInstances((prev) => [studioNode, ...prev.filter((n) => n.referent !== 'studio-root')]);
      setLoadedFileName((prev) => prev ?? studioDisplayName);
      useSpooferStore.getState().setLastScanTime(Date.now());

      if (scriptRefAssets.length > 0 && isTauriRuntime()) {
        const uniqueIds = Array.from(
          new Set(scriptRefAssets.map((a) => a.assetId).filter((id): id is string => Boolean(id))),
        );
        invoke<Record<string, string>>('resolve_script_references', { assetIds: uniqueIds })
          .then((resolvedMap) => {
            const existingAnimIds = new Set(animationAssets.map((a) => a.assetId).filter(Boolean));
            const existingSoundIds = new Set(soundAssets.map((a) => a.assetId).filter(Boolean));
            const existingImageIds = new Set(imageAssets.map((a) => a.assetId).filter(Boolean));
            const existingMeshIds = new Set(meshAssets.map((a) => a.assetId).filter(Boolean));

            const finalAnims = includeAnims ? [...animationAssets] : [];
            const finalSounds = includeSounds ? [...soundAssets] : [];
            const finalImages = includeImages ? [...imageAssets] : [];
            const finalMeshes = includeMeshes ? [...meshAssets] : [];
            for (const asset of scriptRefAssets) {
              if (!asset.assetId) continue;
              const resolved = resolvedMap[asset.assetId];
              if (resolved === 'animation' && includeAnims && !existingAnimIds.has(asset.assetId))
                finalAnims.push({ ...asset, type: 'animation' });
              else if (
                resolved === 'audio' &&
                includeSounds &&
                !existingSoundIds.has(asset.assetId)
              )
                finalSounds.push({ ...asset, type: 'audio' });
              else if (
                resolved === 'image' &&
                includeImages &&
                !existingImageIds.has(asset.assetId)
              )
                finalImages.push({ ...asset, type: 'image' });
              else if (resolved === 'mesh' && includeMeshes && !existingMeshIds.has(asset.assetId))
                finalMeshes.push({ ...asset, type: 'mesh' });
            }

            const allResolvedAssets: { asset: PluginAsset; type: ParsedAssetRef['type'] }[] = [
              ...(includeAnims
                ? finalAnims.map((asset) => ({ asset, type: 'animation' as const }))
                : []),
              ...(includeSounds
                ? finalSounds.map((asset) => ({ asset, type: 'audio' as const }))
                : []),
              ...(includeImages
                ? finalImages.map((asset) => ({ asset, type: 'image' as const }))
                : []),
              ...(includeMeshes
                ? finalMeshes.map((asset) => ({ asset, type: 'mesh' as const }))
                : []),
            ];

            let allTreeAssets = [...allResolvedAssets];
            if (includeScripts) {
              const unknownRefs = scriptRefAssets.filter((a) => {
                if (!a.assetId) return false;
                const r = resolvedMap[a.assetId];
                return (
                  r !== 'animation' &&
                  r !== 'audio' &&
                  r !== 'image' &&
                  r !== 'mesh' &&
                  r !== 'false_positive'
                );
              });
              if (unknownRefs.length > 0) {
                const unverifiedAssets = unknownRefs.map((a) => ({
                  asset: a,
                  type: 'script_ref' as ParsedAssetRef['type'],
                }));
                allTreeAssets = [...allTreeAssets, ...unverifiedAssets];
              }
            }

            const rebuiltChildren = buildDataModelTree(allTreeAssets);

            if (rebuiltChildren.length === 0) {
              return;
            }
            setRootInstances((prev) => [
              { ...studioNode, children: rebuiltChildren },
              ...prev.filter((n) => n.referent !== 'studio-root'),
            ]);
          })
          .catch((err) => {
            logValencyStudio('error', `Failed to resolve script references: ${String(err)}`);
          });
      }
    },
    [setRootInstances, setLoadedFileName],
  );

  useStudioAssetPoll(studioConnected || isScanningStudio, (bundle) => {
    processStudioData(bundle.anims, bundle.sounds, bundle.images, bundle.meshes, bundle.scriptRefs);
    if (onScanReceived) onScanReceived();
  });

  const selectedIds = Array.from(selectedAssetIds);
  const selectedCount = selectedAssetKeys.size > 0 ? selectedAssetKeys.size : selectedAssetIds.size;
  const pinnedCount = selectedIds.filter((id) => assetForcePlaceIds[id]).length;

  const applyPin = () => {
    const trimmed = placeIdInput.replace(/\D/g, '');
    if (!trimmed || selectedIds.length === 0) return;
    setAssetForcePlaceIds((prev) => {
      const next = { ...prev };
      for (const id of selectedIds) next[id] = trimmed;
      return next;
    });
    setPlaceIdInput('');
    setLockOpen(false);
  };

  useEffect(() => {
    const handlePlaybackChange = (event: Event) => {
      setPlayingAudioId((event as CustomEvent<{ assetId: string | null }>).detail.assetId);
    };
    window.addEventListener('ValencyStudio-audio-playback-change', handlePlaybackChange);
    return () => {
      window.removeEventListener('ValencyStudio-audio-playback-change', handlePlaybackChange);
      stopRobloxAudio();
    };
  }, []);

  const handleForceApplyReplacements = useCallback(async () => {
    const store = useSpooferStore.getState();
    const replacements = store.lastReplacements || {};
    const count = Object.keys(replacements).length;
    if (count === 0) {
      showToast('error', 'No stored replacements found. Spoof some assets or paste IDs first!');
      return;
    }

    let toApply: Record<string, string> = {};
    if (selectedAssetIds.size > 0) {
      for (const id of selectedAssetIds) {
        if (replacements[id]) {
          toApply[id] = replacements[id];
        }
      }
    }
    if (Object.keys(toApply).length === 0) {
      toApply = replacements;
    }

    try {
      const { applyReplacements } = await import('../../stores/spooferStore');
      await applyReplacements(toApply);
      showToast(
        'success',
        `Pushed ${Object.keys(toApply).length} asset replacement(s) to Studio without re-spoofing!`,
      );
    } catch (err) {
      showToast('error', `Failed to apply replacements: ${String(err)}`);
    }
  }, [selectedAssetIds, showToast]);

  const displayedInstances = useMemo(() => {
    const VALID_ROOTS = new Set([
      'Workspace',
      'Lighting',
      'ReplicatedFirst',
      'ReplicatedStorage',
      'ServerScriptService',
      'ServerStorage',
      'StarterGui',
      'StarterPack',
      'StarterPlayer',
      'SoundService',
      'Teams',
      'MaterialService',
      'StudioSession',
      'Folder',
    ]);
    const list = rootInstances.filter(
      (node) => VALID_ROOTS.has(node.className) || node.referent.startsWith('studio-'),
    );

    if (ghostAssetIds.size > 0) {
      const ghostNode: RbxInstance = {
        referent: 'ghost-ids-root',
        className: 'Folder',
        name: 'Ghost IDs',
        assets: Array.from(ghostAssetIds).map((id) => ({
          type: 'ghost' as ParsedAssetRef['type'],
          assetId: id,
          rawValue: `rbxassetid://${id}`,
          className: 'GhostAsset',
          instanceName: `Ghost ID ${id}`,
          propertyName: 'GhostID',
          path: 'GhostIDs',
        })),
        children: [],
      };
      return [...list, ghostNode];
    }

    return list;
  }, [rootInstances, ghostAssetIds]);

  const stats = useMemo(() => {
    let total = 0;
    const walk = (list: RbxInstance[]) => {
      for (const n of list) {
        total += n.assets.length;
        walk(n.children);
      }
    };
    walk(displayedInstances);
    return { total, displayed: total };
  }, [displayedInstances]);

  const getAllAssetKeys = useCallback(
    (node: RbxInstance): string[] => {
      const filters = activeAssetFilters;
      const filterFn = (type: string) => {
        if (!filters || filters.length === 0) return true;
        if (type === 'ghost') return true;
        return filters.includes(type);
      };

      let keys: string[] = (node?.assets || [])
        .filter((a) => filterFn(a?.type || ''))
        .map((a) => getAssetKey(a))
        .filter(Boolean);
      for (const child of node?.children || []) {
        keys = keys.concat(getAllAssetKeys(child));
      }
      return keys;
    },
    [activeAssetFilters],
  );

  const getAllAssetIds = useCallback(
    (node: RbxInstance): string[] => {
      const filters = activeAssetFilters;
      const filterFn = (type: string) => {
        if (!filters || filters.length === 0) return true;
        if (type === 'ghost') return true;
        return filters.includes(type);
      };

      let ids: string[] = (node?.assets || [])
        .filter((a) => filterFn(a?.type || ''))
        .map((a) => getAssetId(a))
        .filter(Boolean);
      for (const child of node?.children || []) {
        ids = ids.concat(getAllAssetIds(child));
      }
      return ids;
    },
    [activeAssetFilters],
  );

  const toggleAsset = useCallback(
    (assetOrKey: ParsedAssetRef | string, checked: boolean) => {
      const key = typeof assetOrKey === 'string' ? assetOrKey : getAssetKey(assetOrKey);
      const assetId =
        typeof assetOrKey === 'string'
          ? assetOrKey.split(':').pop() || assetOrKey
          : getAssetId(assetOrKey);

      setSelectedAssetKeys((prev) => {
        const next = new Set(prev);
        if (checked) next.add(key);
        else next.delete(key);
        return next;
      });

      setSelectedAssetIds((prev) => {
        const next = new Set(prev);
        if (checked) {
          if (assetId) next.add(assetId);
        } else {
          const currentKeys = useSpooferStore.getState().selectedAssetKeys;
          const stillHas = Array.from(currentKeys).some(
            (k) => k !== key && (k.endsWith(`:${assetId}`) || k === assetId),
          );
          if (!stillHas && assetId) {
            next.delete(assetId);
          }
        }
        return next;
      });
    },
    [setSelectedAssetKeys, setSelectedAssetIds],
  );

  const toggleNode = useCallback(
    (node: RbxInstance, checked: boolean) => {
      const keys = getAllAssetKeys(node);
      const ids = getAllAssetIds(node);

      setSelectedAssetKeys((prev) => {
        const next = new Set(prev);
        for (const k of keys) {
          if (checked) next.add(k);
          else next.delete(k);
        }
        return next;
      });

      setSelectedAssetIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) {
          if (checked) next.add(id);
          else {
            const currentKeys = useSpooferStore.getState().selectedAssetKeys;
            const stillHas = Array.from(currentKeys).some(
              (k) => !keys.includes(k) && (k.endsWith(`:${id}`) || k === id),
            );
            if (!stillHas) {
              next.delete(id);
            }
          }
        }
        return next;
      });
    },
    [getAllAssetKeys, getAllAssetIds, setSelectedAssetKeys, setSelectedAssetIds],
  );

  const computeTargetPaths = useCallback(() => {
    const keys = useSpooferStore.getState().selectedAssetKeys;
    if (keys.size === 0) return undefined;
    const map: Record<string, string[]> = {};
    const walk = (nodes: RbxInstance[]) => {
      for (const node of nodes) {
        for (const asset of node.assets) {
          const key = getAssetKey(asset);
          if (keys.has(key)) {
            const id = getAssetId(asset);
            if (id) {
              map[id] = map[id] || [];
              if (asset.path && !map[id].includes(asset.path)) {
                map[id].push(asset.path);
              }
            }
          }
        }
        if (node.children) walk(node.children);
      }
    };
    walk(displayedInstances);
    return map;
  }, [displayedInstances]);

  return (
    <div className="h-full bg-background flex flex-col shrink-0 overflow-hidden relative w-full border-l-0">
      <div
        key="asset-explorer-body"
        className="flex-1 overflow-y-auto scrollbar-hide w-full flex flex-col"
      >
        {displayedInstances.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-5 overflow-y-auto px-8 py-10">
            <div className="w-full max-w-md">
              <h2 className="text-lg font-semibold leading-snug text-text-primary">
                {t('explorer.emptyTitle')}
              </h2>
              <p className="text-sm leading-relaxed text-text-secondary mt-1.5">
                {t('explorer.emptyBody')}
              </p>
            </div>
            {(studioConnected && scanStatus?.scanning) || isScanningStudio ? (
              <div className="flex flex-col items-start gap-2 w-full max-w-md">
                <Loader2 size={20} className="animate-spin text-primary" />
                <span className="text-xs font-bold text-primary">{t('misc.scanningStudio')}</span>
              </div>
            ) : (
              <div className="flex flex-col items-start gap-3 w-full max-w-md">
                {!studioConnected && (
                  <p className="flex items-start gap-2 text-sm text-text-secondary">
                    <CircleAlert size={15} className="text-signal-warn shrink-0 mt-0.5" />
                    <span>{t('explorer.studioNotConnected')}</span>
                  </p>
                )}
                <div className="flex items-center rounded-lg overflow-hidden border border-border-strong bg-bg-surface">
                  <button
                    type="button"
                    data-tutorial-target="explorer-open-file"
                    onClick={async () => {
                      try {
                        const selected = await openFilePicker({
                          multiple: false,
                          filters: [
                            {
                              name: 'Roblox Place',
                              extensions: ['rbxl', 'rbxlx', 'rbxm', 'rbxmx'],
                            },
                          ],
                        });
                        const path = Array.isArray(selected) ? selected[0] : selected;
                        if (!path) return;
                        const result = await invoke<{ rootInstances: RbxInstance[] }>(
                          'parse_place_file',
                          { filePath: path },
                        );

                        const filterCategory = (type: string) => {
                          if (type === 'animation' || type === 'raw_keyframe_sequence')
                            return scanTypes.has('animations');
                          if (type === 'audio') return scanTypes.has('sounds');
                          if (type === 'image') return scanTypes.has('images');
                          if (type === 'mesh') return scanTypes.has('meshes');
                          if (type === 'script_ref') return scanTypes.has('scripts');
                          return true;
                        };

                        const filterTree = (nodes: RbxInstance[]): RbxInstance[] => {
                          return nodes
                            .map((node) => ({
                              ...node,
                              assets: node.assets.filter((a) => filterCategory(a.type)),
                              children: filterTree(node.children),
                            }))
                            .filter((node) => node.assets.length > 0 || node.children.length > 0);
                        };

                        const incoming = result.rootInstances ?? [];
                        const filteredIncoming = filterTree(incoming);
                        useSpooferStore.getState().setRootInstances(filteredIncoming);
                        useSpooferStore
                          .getState()
                          .setLoadedFileName(path.split(/[\\/]/).pop() ?? path);
                        setLoadedFilePath(path);
                        logValencyStudio('success', `Loaded place file: ${path}`);
                      } catch (err) {
                        logValencyStudio('error', `Failed to load place file: ${String(err)}`);
                      }
                    }}
                    className="flex items-center justify-center gap-2 px-5 h-11 text-text-primary font-bold text-sm hover:bg-bg-elevated disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    <FolderOpen size={18} />
                    {t('explorer.openFile')}
                  </button>

                  <Popover>
                    <PopoverTrigger
                      render={
                        <button
                          type="button"
                          aria-label={t('explorer.fileExtractionOptions')}
                          className="h-11 w-10 text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors border-l border-border flex items-center justify-center cursor-pointer"
                        >
                          <Settings2 size={16} />
                        </button>
                      }
                    />
                    <PopoverContent
                      align="center"
                      side="bottom"
                      sideOffset={8}
                      className="w-72 p-3 bg-bg-surface border border-border shadow-xl rounded-lg z-[210]"
                    >
                      <div className="flex flex-col gap-3">
                        <div>
                          <span className="text-2xs font-bold uppercase tracking-widest text-text-muted mb-2 block">
                            Asset Types
                          </span>
                          <AssetTypePicker scanTypes={scanTypes} onToggle={toggleScanType} />
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="flex items-center rounded-lg overflow-hidden border border-primary/20 shadow-sm">
                  <button
                    type="button"
                    onClick={() => {
                      if (!studioConnected) {
                        showToast('error', t('explorer.studioNotConnectedAction'));
                        return;
                      }
                      const types = SCAN_ASSET_TYPES.filter((k) => scanTypes.has(k));
                      document.dispatchEvent(
                        new CustomEvent('ValencyStudio-start-scan', {
                          detail: { scanTypes: types },
                        }),
                      );
                    }}
                    data-tutorial-target="explorer-scan-studio"
                    disabled={scanTypes.size === 0}
                    aria-label={t('spoof.scanStudio')}
                    className={cn(
                      'flex items-center justify-center gap-2 px-6 h-11 bg-primary text-primary-foreground font-bold text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors',
                      !studioConnected && 'opacity-70',
                    )}
                  >
                    <ScanSearch size={18} />
                    {t('spoof.scanStudio')}
                  </button>

                  <Popover open={showScanOptions} onOpenChange={setShowScanOptions}>
                    <PopoverTrigger
                      render={
                        <button
                          type="button"
                          aria-label={t('explorer.allAssetTypes')}
                          className="h-11 w-10 bg-primary text-primary-foreground hover:bg-primary/90 transition-colors border-l border-primary-foreground/20 flex items-center justify-center"
                        >
                          <Settings2 size={16} />
                        </button>
                      }
                    />
                    <PopoverContent
                      align="center"
                      side="bottom"
                      sideOffset={8}
                      className="w-72 p-3 bg-bg-surface border border-border shadow-xl rounded-lg z-[210]"
                    >
                      <div className="flex flex-col gap-3">
                        <div>
                          <span className="text-2xs font-bold uppercase tracking-widest text-text-muted mb-2 block">
                            Asset Types
                          </span>
                          <AssetTypePicker scanTypes={scanTypes} onToggle={toggleScanType} />
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            )}

            {!((studioConnected && scanStatus?.scanning) || isScanningStudio) && (
              <button
                type="button"
                onClick={() => {
                  if (!studioConnected) {
                    showToast(
                      'error',
                      'No Roblox Studio plugin connected. Please connect Studio first.',
                    );
                    return;
                  }
                  setRootInstances((prev) =>
                    prev.length > 0
                      ? prev
                      : [
                          {
                            referent: 'studio-root',
                            className: 'Place',
                            name: studioDisplayName,
                            assets: [],
                            children: [],
                          },
                        ],
                  );
                  setLoadedFileName(studioDisplayName);
                }}
                className={cn(
                  'text-sm text-text-muted hover:text-primary underline font-medium transition-colors cursor-pointer',
                  !studioConnected && 'opacity-60 cursor-not-allowed hover:text-text-muted',
                )}
              >
                {t('explorer.connectWithoutScanning')}
              </button>
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden h-full w-full relative">
            {(isSpoofing || isReplacing || isGrantingPermissions) && (
              <div className="absolute top-0 left-0 right-0 z-50 pointer-events-none">
                <div className="h-1 bg-bg-base w-full overflow-hidden shadow-md">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{
                      width: `${
                        isSpoofing
                          ? spoofProgress
                          : isReplacing
                            ? replaceTotalCount > 0
                              ? Math.min(
                                  100,
                                  Math.max(5, (replaceCurrentCount / replaceTotalCount) * 100),
                                )
                              : 50
                            : isGrantingPermissions
                              ? permissionsTotalCount > 0
                                ? Math.min(
                                    100,
                                    Math.max(
                                      5,
                                      (permissionsCurrentCount / permissionsTotalCount) * 100,
                                    ),
                                  )
                                : 50
                              : 0
                      }%`,
                    }}
                  />
                </div>
                <div
                  role="status"
                  aria-live="polite"
                  className="absolute top-1.5 right-3 px-2.5 py-0.5 rounded bg-bg-surface/90 border border-border-subtle text-2xs text-text-primary font-mono shadow-sm pointer-events-auto flex items-center gap-1.5"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                  <span>
                    {isSpoofing
                      ? `${spoofStatusText || 'Initializing...'}${spoofTotalCount > 0 ? ` · ${spoofCurrentCount}/${spoofTotalCount}` : ''}${activeEta ? ` · ${activeEta}` : ''}`
                      : isReplacing
                        ? `Replacing${replaceTotalCount > 0 ? ` · ${replaceCurrentCount}/${replaceTotalCount}` : '...'}${activeEta ? ` · ${activeEta}` : ''}`
                        : isGrantingPermissions
                          ? `Asset Permissions${permissionsTotalCount > 0 ? ` · ${permissionsCurrentCount}/${permissionsTotalCount}` : '...'}${activeEta ? ` · ${activeEta}` : ''}`
                          : ''}
                  </span>
                </div>
              </div>
            )}
            <div className="flex-1 flex overflow-hidden w-full relative min-h-0">
              <div
                className={cn(
                  'h-full border-r border-border-subtle flex flex-col overflow-hidden shrink-0 transition-all duration-200',
                  isRightPanelOpen ? 'w-1/2' : 'w-full border-r-0',
                )}
              >
                <div
                  data-tutorial-target="explorer-tree"
                  className="flex flex-col flex-1 p-2 overflow-y-auto scrollbar-hide"
                >
                  {stats.total === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-6 gap-3 select-none h-full bg-bg-surface/5">
                      <FolderOpen size={36} className="text-primary/30" />
                      <div className="space-y-1 max-w-xs">
                        <h4 className="text-xs font-bold text-text-primary">
                          {isScanningStudio || (studioConnected && scanStatus?.scanning)
                            ? 'Scanning Studio...'
                            : 'No Assets Scanned Yet'}
                        </h4>
                        <p className="text-2xs text-text-secondary leading-relaxed">
                          {isScanningStudio || (studioConnected && scanStatus?.scanning)
                            ? 'Crawling Roblox Studio for spoofable assets...'
                            : 'You connected without a full scan. You can scan Studio, run a targeted model scan, or add manual IDs.'}
                        </p>
                      </div>

                      {!isScanningStudio && (
                        <div className="flex flex-col gap-2 w-full max-w-xs mt-2">
                          <div className="flex items-center rounded-lg overflow-hidden border border-primary/20 shadow-sm w-full">
                            <button
                              type="button"
                              onClick={() => {
                                const types = SCAN_ASSET_TYPES.filter((k) => scanTypes.has(k));
                                document.dispatchEvent(
                                  new CustomEvent('ValencyStudio-start-scan', {
                                    detail: { scanTypes: types },
                                  }),
                                );
                              }}
                              disabled={scanTypes.size === 0 || !studioConnected}
                              className="flex-1 flex items-center justify-center gap-2 h-8 bg-primary text-primary-foreground font-bold text-xs hover:bg-primary/90 disabled:opacity-50 transition-colors"
                            >
                              <ScanSearch size={14} />
                              <span>Scan Studio</span>
                            </button>

                            <Popover>
                              <PopoverTrigger
                                render={
                                  <button
                                    type="button"
                                    className="h-8 w-8 bg-primary text-primary-foreground hover:bg-primary/90 transition-colors border-l border-primary-foreground/20 flex items-center justify-center cursor-pointer"
                                  >
                                    <Settings2 size={13} />
                                  </button>
                                }
                              />
                              <PopoverContent
                                align="end"
                                side="bottom"
                                sideOffset={6}
                                className="w-72 p-3 bg-bg-surface border border-border shadow-xl rounded-lg z-[250]"
                              >
                                <div className="flex flex-col gap-3">
                                  <div>
                                    <span className="text-2xs font-bold uppercase tracking-widest text-text-muted mb-2 block">
                                      Asset Types
                                    </span>
                                    <AssetTypePicker
                                      scanTypes={scanTypes}
                                      onToggle={toggleScanType}
                                      size="sm"
                                    />
                                  </div>
                                </div>
                              </PopoverContent>
                            </Popover>
                          </div>

                          <Popover open={targetedScanOpen} onOpenChange={setTargetedScanOpen}>
                            <PopoverTrigger
                              render={
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-8 text-xs font-medium gap-1.5 w-full"
                                >
                                  <MapPin size={13} />
                                  <span>Scan Specific Path / Model</span>
                                </Button>
                              }
                            />
                            <PopoverContent
                              align="center"
                              side="bottom"
                              sideOffset={6}
                              className="w-76 p-3 bg-bg-surface border border-border shadow-xl rounded-lg z-[250]"
                            >
                              <div className="flex flex-col gap-2.5">
                                <div className="text-2xs font-bold uppercase tracking-wider text-text-muted">
                                  Targeted Path Scan
                                </div>
                                <p className="text-2xs text-text-secondary leading-snug">
                                  Scan only a specific instance or container instead of the whole
                                  game:
                                </p>
                                <Input
                                  value={targetedPath}
                                  onChange={(e) => setTargetedPath(e.target.value)}
                                  placeholder="e.g. game.Workspace.AKAnims or Guns"
                                  className="h-8 text-xs font-mono bg-bg-base"
                                  onKeyDown={(e) => e.key === 'Enter' && handleRunTargetedScan()}
                                />

                                <div>
                                  <span className="text-2xs font-bold uppercase tracking-widest text-text-muted mb-1.5 block">
                                    Asset Types
                                  </span>
                                  <AssetTypePicker
                                    scanTypes={scanTypes}
                                    onToggle={toggleScanType}
                                    size="sm"
                                  />
                                </div>

                                <div className="flex justify-end gap-2 pt-1 border-t border-border-subtle/50">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-xs"
                                    onClick={() => setTargetedScanOpen(false)}
                                  >
                                    Cancel
                                  </Button>
                                  <Button
                                    size="sm"
                                    className="h-7 text-xs font-semibold"
                                    disabled={!targetedPath.trim() || !studioConnected}
                                    onClick={() => handleRunTargetedScan()}
                                  >
                                    Scan Path
                                  </Button>
                                </div>
                              </div>
                            </PopoverContent>
                          </Popover>

                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 text-xs text-text-secondary hover:text-text-primary gap-1.5 w-full"
                            onClick={() =>
                              document.dispatchEvent(
                                new CustomEvent('ValencyStudio-open-paste-ids'),
                              )
                            }
                          >
                            <ClipboardPaste size={13} />
                            <span>Add Manual / Ghost IDs</span>
                          </Button>
                        </div>
                      )}
                    </div>
                  ) : (
                    displayedInstances.map((node) => (
                      <ExplorerTreeNode
                        key={node.referent}
                        node={node}
                        level={0}
                        config={config}
                        selectedAssetIds={selectedAssetIds}
                        selectedAssetKeys={selectedAssetKeys}
                        toggleAsset={toggleAsset}
                        toggleNode={toggleNode}
                        getAllAssetIds={getAllAssetIds}
                        getAllAssetKeys={getAllAssetKeys}
                        activeAssetFilters={activeAssetFilters}
                        searchQuery={deferredSearchQuery}
                        playingAudioId={playingAudioId}
                        initialExpanded={true}
                        onInspectAsset={setActiveInspectAsset}
                        activeInspectAssetId={
                          activeInspectAsset ? getAssetId(activeInspectAsset) : null
                        }
                      />
                    ))
                  )}
                </div>
              </div>

              {isRightPanelOpen && (
                <div className="w-1/2 h-full flex flex-col bg-bg-surface/10 overflow-hidden">
                  <AssetInspectorPanel
                    asset={activeInspectAsset}
                    onClose={() => {
                      useSpooferStore.getState().setIsInspectorOpen(false);
                      useSpooferStore.getState().setIsPropertiesOpen(false);
                    }}
                    playingAudioId={playingAudioId}
                    setPlayingAudioId={setPlayingAudioId}
                    allInstances={displayedInstances}
                    showViewport={isInspectorOpen}
                    showProperties={isPropertiesOpen}
                  />
                </div>
              )}
            </div>

            <div className="h-12 shrink-0 border-t border-border-subtle bg-bg-surface/30 px-3 flex items-center justify-between gap-3 font-sans">
              <div className="flex items-center gap-3">
                <Popover open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
                  <PopoverTrigger
                    render={
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label={t('explorer.clearExplorer')}
                        className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10 border-border-subtle"
                      />
                    }
                  >
                    <Trash2 size={14} />
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    side="top"
                    sideOffset={8}
                    className="w-56 p-3 bg-bg-surface border border-border rounded-lg shadow-lg"
                  >
                    <div className="flex flex-col gap-2.5">
                      <div className="text-2xs font-bold uppercase tracking-widest text-text-muted">
                        {t('explorer.clearExplorer')}
                      </div>
                      <div className="text-xs text-text-secondary leading-normal">
                        {t('common.areYouSure')}{' '}
                        <span className="text-text-muted">
                          This will remove all {stats.total} scanned assets.
                        </span>
                      </div>
                      <div className="flex items-center gap-2 justify-end pt-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs px-2.5"
                          onClick={() => setClearConfirmOpen(false)}
                        >
                          {t('common.cancel')}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="h-7 text-xs px-3 font-semibold bg-danger text-white"
                          onClick={() => {
                            setRootInstances([]);
                            setLoadedFileName(null);
                            setActiveInspectAsset(null);
                            useSpooferStore.getState().clearAssetStatuses();
                            useSpooferStore.getState().setLastReplacements({});
                            useSpooferStore.getState().setAssetForcePlaceIds({});
                            useSpooferStore.getState().clearGhostAssets();
                            localStorage.removeItem('ValencyStudio - Spoofer_SavedReplacements');
                            localStorage.removeItem('ValencyStudio - Spoofer_SavedPlaceIds');
                            void invoke('clear_plugin_cache').catch(console.warn);
                            setClearConfirmOpen(false);
                          }}
                        >
                          {t('common.clear')}
                        </Button>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
                <div className="flex items-center gap-1.5 text-2xs text-text-muted">
                  <span>{stats.total} assets found</span>
                  {lastScanTime && (
                    <>
                      <span>•</span>
                      <span>
                        Scanned{' '}
                        {new Date(lastScanTime).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {selectedCount > 0 && (
                  <div className="flex items-center rounded-lg border border-border-subtle bg-bg-surface p-0.5 shrink-0 gap-0.5 shadow-sm">
                    <Popover open={lockOpen} onOpenChange={setLockOpen}>
                      <PopoverTrigger
                        render={
                          <button
                            type="button"
                            className="h-7 px-2 flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground rounded transition-colors relative"
                          >
                            <Lock
                              size={13}
                              className={pinnedCount > 0 ? 'text-primary' : 'text-muted-foreground'}
                            />
                            {pinnedCount > 0 && (
                              <span className="min-w-[12px] h-[12px] px-1 rounded-full bg-primary text-primary-foreground text-2xs font-bold flex items-center justify-center">
                                {pinnedCount}
                              </span>
                            )}
                          </button>
                        }
                      />
                      <PopoverContent
                        align="end"
                        side="top"
                        sideOffset={8}
                        className="w-64 p-3 bg-bg-surface border border-border shadow-xl rounded-lg"
                      >
                        <div className="flex flex-col gap-2">
                          <div className="text-2xs font-semibold uppercase tracking-widest text-text-muted">
                            {t('settings.forcePlaceIds')} · {selectedCount} selected
                          </div>
                          <Input
                            value={placeIdInput}
                            onChange={(e) => setPlaceIdInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && applyPin()}
                            placeholder={t('settings.forcePlaceIdsPlaceholder')}
                            className="h-8 text-xs bg-bg-base font-mono"
                          />
                          <div className="flex items-center justify-between gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-2xs text-destructive"
                              disabled={pinnedCount === 0}
                              onClick={() => setConfirmClearPins(true)}
                            >
                              <Trash2 size={12} className="mr-1" />
                              {t('common.clear')}
                            </Button>
                            <Button
                              size="sm"
                              className="h-7 text-2xs"
                              onClick={applyPin}
                              disabled={!placeIdInput.trim()}
                            >
                              {t('common.apply')}
                            </Button>
                          </div>
                        </div>
                      </PopoverContent>
                    </Popover>

                    {(() => {
                      const lastReplacements = useSpooferStore.getState().lastReplacements || {};
                      const selectedArray = Array.from(selectedAssetIds);
                      const hasAnyReplacement = selectedArray.some((id) => lastReplacements[id]);
                      const allHaveReplacements = selectedArray.every((id) => lastReplacements[id]);

                      const handleDefaultCopy = () => {
                        if (allHaveReplacements) {
                          const pairs = selectedArray.map(
                            (id) => `${id} -> ${lastReplacements[id]}`,
                          );
                          void navigator.clipboard.writeText(pairs.join(',\n'));
                          showToast('success', `Copied ${pairs.length} replacement pair(s)!`);
                        } else {
                          const ids = selectedArray.map((id) => lastReplacements[id] || id);
                          void navigator.clipboard.writeText(ids.join(',\n'));
                          showToast('success', `Copied ${ids.length} selected ID(s)!`);
                        }
                      };

                      const handleCopySelected = () => {
                        const ids = selectedArray.map((id) => id);
                        void navigator.clipboard.writeText(ids.join(',\n'));
                        showToast('success', `Copied ${ids.length} selected ID(s)!`);
                      };

                      const handleCopyPairs = () => {
                        const pairs = selectedArray
                          .filter((id) => lastReplacements[id])
                          .map((id) => `${id} -> ${lastReplacements[id]}`);
                        void navigator.clipboard.writeText(pairs.join(',\n'));
                        showToast('success', `Copied ${pairs.length} replacement pair(s)!`);
                      };

                      const handleCopyReplacedOnly = () => {
                        const replacedIds = selectedArray
                          .map((id) => lastReplacements[id])
                          .filter((id): id is string => Boolean(id));
                        void navigator.clipboard.writeText(replacedIds.join(',\n'));
                        showToast('success', `Copied ${replacedIds.length} replaced ID(s)!`);
                      };

                      return (
                        <Popover>
                          <div className="flex items-center shrink-0 rounded overflow-hidden">
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <button
                                    type="button"
                                    onClick={handleDefaultCopy}
                                    className="h-7 px-2 flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
                                  >
                                    <Copy size={13} />
                                    <span>Copy</span>
                                  </button>
                                }
                              />
                              <TooltipContent>
                                {allHaveReplacements
                                  ? 'Copy replacement pairs (orig -> new)'
                                  : `Copy selected IDs (${selectedCount})`}
                              </TooltipContent>
                            </Tooltip>

                            <PopoverTrigger
                              render={
                                <button
                                  type="button"
                                  className="h-7 px-1 text-muted-foreground hover:text-foreground border-l border-border-subtle/50 flex items-center justify-center transition-colors"
                                >
                                  <ChevronDown size={11} />
                                </button>
                              }
                            />
                          </div>

                          <PopoverContent
                            align="end"
                            side="top"
                            sideOffset={8}
                            className="w-52 p-1 bg-bg-surface border border-border shadow-xl rounded-lg z-[220]"
                          >
                            <div className="flex flex-col gap-0.5">
                              <button
                                type="button"
                                onClick={handleCopySelected}
                                className="flex items-center gap-2 w-full h-8 px-2 rounded-md text-xs font-medium text-left transition-colors text-text-secondary hover:text-text-primary hover:bg-bg-elevated"
                              >
                                <Copy size={13} className="text-muted-foreground" />
                                <span className="flex-1">Copy Selected IDs ({selectedCount})</span>
                              </button>

                              <button
                                type="button"
                                onClick={handleCopyPairs}
                                disabled={!hasAnyReplacement}
                                className={cn(
                                  'flex items-center gap-2 w-full h-8 px-2 rounded-md text-xs font-medium text-left transition-colors',
                                  hasAnyReplacement
                                    ? 'text-signal-spoofed hover:bg-signal-spoofed/10'
                                    : 'text-text-muted/40 cursor-not-allowed',
                                )}
                              >
                                <Copy size={13} />
                                <span className="flex-1">Copy Replacement Pairs</span>
                              </button>

                              <button
                                type="button"
                                onClick={handleCopyReplacedOnly}
                                disabled={!hasAnyReplacement}
                                className={cn(
                                  'flex items-center gap-2 w-full h-8 px-2 rounded-md text-xs font-medium text-left transition-colors',
                                  hasAnyReplacement
                                    ? 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated'
                                    : 'text-text-muted/40 cursor-not-allowed',
                                )}
                              >
                                <Copy size={13} className="text-muted-foreground" />
                                <span className="flex-1">Copy Replaced IDs Only</span>
                              </button>
                            </div>
                          </PopoverContent>
                        </Popover>
                      );
                    })()}
                  </div>
                )}

                <div className="flex items-center rounded-lg border border-border-subtle bg-bg-surface p-0.5 shrink-0 gap-0.5 shadow-sm">
                  {config.spoofing.selectedUser !== 'none' && (
                    <div className="flex items-center rounded overflow-hidden">
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <button
                              type="button"
                              className="h-7 px-2 flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                              onClick={() =>
                                document.dispatchEvent(
                                  new CustomEvent('ValencyStudio-discover-place-ids', {
                                    detail: { timeoutSecs: discoveryTimeoutSecs },
                                  }),
                                )
                              }
                              disabled={busy || isDiscoveringPlaceIds}
                            >
                              {isDiscoveringPlaceIds ? (
                                <Loader2 size={13} className="animate-spin text-primary" />
                              ) : (
                                <MapPin size={13} />
                              )}
                              <span>Discover</span>
                            </button>
                          }
                        />
                        <TooltipContent>
                          {isDiscoveringPlaceIds
                            ? 'Discovering Place IDs...'
                            : `Discover Place IDs (${discoveryTimeoutSecs}s limit/asset)`}
                        </TooltipContent>
                      </Tooltip>

                      <Popover>
                        <PopoverTrigger
                          render={
                            <button
                              type="button"
                              className="h-7 px-1 text-muted-foreground hover:text-foreground border-l border-border-subtle/50 flex items-center justify-center transition-colors"
                            >
                              <ChevronDown size={11} />
                            </button>
                          }
                        />
                        <PopoverContent
                          align="end"
                          side="top"
                          sideOffset={8}
                          className="w-64 p-3 bg-bg-surface border border-border shadow-xl rounded-lg z-[220]"
                        >
                          <div className="flex flex-col gap-3">
                            <div className="flex items-center justify-between">
                              <span className="text-2xs font-bold uppercase tracking-wider text-text-muted">
                                Discovery Timeout
                              </span>
                              <span className="text-xs font-mono font-bold text-primary">
                                {discoveryTimeoutSecs}s / asset
                              </span>
                            </div>
                            <input
                              type="range"
                              min={30}
                              max={300}
                              step={10}
                              value={discoveryTimeoutSecs}
                              onChange={(e) => setDiscoveryTimeoutSecs(Number(e.target.value))}
                              className="w-full accent-primary h-1.5 bg-bg-base rounded-lg cursor-pointer"
                            />
                            <div className="flex justify-between text-2xs text-text-muted font-mono">
                              <span>30s (fast)</span>
                              <span>120s</span>
                              <span>300s (deep)</span>
                            </div>
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                  )}

                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          className="h-7 w-7 flex items-center justify-center text-muted-foreground hover:text-foreground rounded transition-colors cursor-pointer"
                          onClick={() =>
                            document.dispatchEvent(new CustomEvent('ValencyStudio-open-paste-ids'))
                          }
                        >
                          <ClipboardPaste size={13} />
                        </button>
                      }
                    />
                    <TooltipContent>{t('spoof.manualReplace')}</TooltipContent>
                  </Tooltip>

                  {storedReplacementsCount > 0 && (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            disabled={busy}
                            className="h-7 px-2.5 flex items-center gap-1.5 text-xs text-primary bg-primary/10 hover:bg-primary/20 border border-primary/30 rounded transition-colors disabled:opacity-50 cursor-pointer font-medium"
                            onClick={() => void handleForceApplyReplacements()}
                          >
                            <RotateCcw size={12} className={isReplacing ? 'animate-spin' : ''} />
                            <span>Apply IDs ({storedReplacementsCount})</span>
                          </button>
                        }
                      />
                      <TooltipContent>
                        Force push stored ID replacements into Studio (Memory Injection + Plugin)
                        without re-spoofing or downloading.
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>

                <Popover open={spoofModeOpen} onOpenChange={setSpoofModeOpen}>
                  <div className="flex items-center shrink-0 rounded-md overflow-hidden">
                    <Button
                      size="sm"
                      data-tutorial-target="run-spoofer"
                      className="h-8 px-3 rounded-r-none rounded-l-md text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 shadow-sm"
                      onClick={() => {
                        const targetPaths = computeTargetPaths();
                        useSpooferStore.getState().setTargetPathsMap(targetPaths || {});
                        if (selectedAssetIds.size > 0) {
                          document.dispatchEvent(
                            new CustomEvent('ValencyStudio-run-spoofer', {
                              detail: {
                                assetIds: Array.from(selectedAssetIds),
                                targetPaths,
                              },
                            }),
                          );
                        } else {
                          document.dispatchEvent(
                            new CustomEvent('ValencyStudio-run-spoofer', {
                              detail: { targetPaths },
                            }),
                          );
                        }
                      }}
                      disabled={busy}
                    >
                      {config.spoofing.downloadOnly ? (
                        <Download size={13} />
                      ) : (
                        <Play size={13} fill="currentColor" />
                      )}
                      {isSpoofing
                        ? t('spoof.runSpoofer') + '…'
                        : config.spoofing.downloadOnly
                          ? selectedCount > 0
                            ? `Download Selected (${selectedCount})`
                            : `Download All (${stats.displayed})`
                          : selectedCount > 0
                            ? `Spoof Selected (${selectedCount})`
                            : `Spoof All Assets (${stats.displayed})`}
                    </Button>
                    <PopoverTrigger
                      render={
                        <Button
                          size="sm"
                          className="h-8 w-6 rounded-l-none rounded-r-md text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 border-l border-primary-foreground/20 px-0 flex items-center justify-center"
                          disabled={busy}
                        >
                          <ChevronDown size={12} />
                        </Button>
                      }
                    />
                  </div>
                  <PopoverContent
                    align="end"
                    side="top"
                    sideOffset={6}
                    className="w-48 p-1 bg-bg-surface border border-border shadow-xl flex flex-col gap-0.5"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        updateConfig('spoofing', 'downloadOnly', false);
                        setSpoofModeOpen(false);
                      }}
                      className={cn(
                        'flex items-center gap-2 w-full h-7 px-2 rounded-md text-xs text-left transition-colors cursor-pointer',
                        !config.spoofing.downloadOnly
                          ? 'text-primary bg-primary/10 font-semibold'
                          : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated',
                      )}
                    >
                      <Play
                        size={12}
                        className={cn(
                          !config.spoofing.downloadOnly ? 'text-primary' : 'text-muted-foreground',
                        )}
                        fill="currentColor"
                      />
                      <span className="flex-1">Spoof (Upload)</span>
                      {!config.spoofing.downloadOnly && (
                        <Check size={12} className="text-primary" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        updateConfig('spoofing', 'downloadOnly', true);
                        setSpoofModeOpen(false);
                      }}
                      className={cn(
                        'flex items-center gap-2 w-full h-7 px-2 rounded-md text-xs text-left transition-colors cursor-pointer',
                        config.spoofing.downloadOnly
                          ? 'text-primary bg-primary/10 font-semibold'
                          : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated',
                      )}
                    >
                      <Download
                        size={12}
                        className={cn(
                          config.spoofing.downloadOnly ? 'text-primary' : 'text-muted-foreground',
                        )}
                      />
                      <span className="flex-1">Download Only</span>
                      {config.spoofing.downloadOnly && <Check size={12} className="text-primary" />}
                    </button>

                    <div className="my-0.5 border-t border-border-subtle" />

                    <button
                      type="button"
                      onClick={() => {
                        setSpoofModeOpen(false);
                        void handleForceApplyReplacements();
                      }}
                      className="flex items-center gap-2 w-full h-7 px-2 rounded-md text-xs text-left transition-colors text-text-secondary hover:text-text-primary hover:bg-bg-elevated cursor-pointer"
                    >
                      <RotateCcw size={12} className="text-primary" />
                      <span className="flex-1 font-medium">Re-apply Replacements</span>
                      {storedReplacementsCount > 0 && (
                        <span className="text-2xs text-muted-foreground font-mono bg-bg-base px-1 rounded border border-border-subtle">
                          {storedReplacementsCount}
                        </span>
                      )}
                    </button>

                    <div className="my-0.5 border-t border-border-subtle" />
                    <button
                      type="button"
                      onClick={() => {
                        setSpoofModeOpen(false);
                        useSpooferStore.getState().setIsSpoofing(false);
                        useSpooferStore.getState().setIsReplacing(false);
                        useSpooferStore.getState().setIsScanningStudio(false);
                        useSpooferStore.getState().setIsDiscoveringPlaceIds(false);

                        import('@tauri-apps/api/core')
                          .then(({ invoke }) => invoke('force_reset_spoofer_job'))
                          .catch(() => {});
                        showToast('info', 'Button state reset. You can start a new spoof.');
                      }}
                      className="flex items-center gap-2 w-full h-7 px-2 rounded-md text-xs text-left transition-colors text-danger hover:bg-danger/10"
                    >
                      <X size={12} className="text-danger" />
                      <span className="flex-1 font-medium">Force Reset (Stuck?)</span>
                    </button>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>
        )}
      </div>

      <Dialog open={confirmClearPins} onOpenChange={setConfirmClearPins}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('settings.forcePlaceIds')}</DialogTitle>
          </DialogHeader>
          <div className="py-2 text-sm text-text-secondary">
            {t('common.areYouSure')}{' '}
            <span className="text-text-muted">
              ({pinnedCount} pinned asset{pinnedCount === 1 ? '' : 's'})
            </span>
          </div>
          <DialogFooter className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmClearPins(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                clearAssetForcePlaceIds(selectedIds);
                setConfirmClearPins(false);
                setLockOpen(false);
              }}
            >
              {t('common.clear')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
