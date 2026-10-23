import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  FolderOpen,
  Image as ImageIcon,
  Inbox,
  Loader2,
  Lock,
  Maximize2,
  Minimize2,
  Play,
  Square,
  Volume2,
  X,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';

import { useConfig } from '../../../contexts/ConfigContext';
import { useLanguage } from '../../../contexts/LanguageContext';
import { cn } from '../../../lib/utils';
import { useSpooferStore } from '../../../stores/spooferStore';
import { getAssetId } from '../../../utils/explorerTree';
import { playRobloxAudio, stopRobloxAudio } from '../../../utils/robloxAudio';
import type { ParsedAssetRef, RbxInstance } from '../../../utils/robloxPlaceParser/types';
import { EmptyState } from '../../shared/EmptyState';
import { SectionLabel } from '../../shared/SectionLabel';
import { Button } from '../../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/tooltip';
import { formatShortId, getBrightPlaceIdColor } from './ExplorerTree';

const AnimationPreview = lazy(() => import('../../shared/AnimationPreview'));

function findPropertiesForInstance(instancePath: string, roots: RbxInstance[]): ParsedAssetRef[] {
  const list: ParsedAssetRef[] = [];
  const walk = (nodes: RbxInstance[]) => {
    for (const node of nodes) {
      for (const a of node.assets) {
        if (a.path === instancePath) {
          list.push(a);
        }
      }
      walk(node.children);
    }
  };
  walk(roots);
  return list;
}

export default function AssetInspectorPanel({
  asset,
  onClose,
  playingAudioId,
  setPlayingAudioId,
  allInstances = [],
  showViewport = true,
  showProperties = true,
}: {
  asset: ParsedAssetRef | null;
  onClose: () => void;
  playingAudioId: string | null;
  setPlayingAudioId: (id: string | null) => void;
  allInstances?: RbxInstance[];
  showViewport?: boolean;
  showProperties?: boolean;
}) {
  const { config } = useConfig();
  const { t } = useLanguage();
  const [selectedAssetRef, setSelectedAssetRef] = useState<ParsedAssetRef | null>(asset);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [appearanceOpen, setAppearanceOpen] = useState(true);
  const [dataOpen, setDataOpen] = useState(true);
  const [isPoppedOut, setIsPoppedOut] = useState(false);

  const [imageZoom, setImageZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  const assetForcePlaceIds = useSpooferStore((s) => s.assetForcePlaceIds) ?? {};
  const lastReplacements = useSpooferStore((s) => s.lastReplacements) ?? {};

  useEffect(() => {
    setSelectedAssetRef(asset);
    setImageZoom(1);
    setPan({ x: 0, y: 0 });
  }, [asset]);

  const activeAsset = selectedAssetRef || asset;
  const activeAssetId = activeAsset ? getAssetId(activeAsset) : '';
  const isImage = activeAsset?.type === 'image';
  const isMesh = activeAsset?.type === 'mesh';
  const isAudio = activeAsset?.type === 'audio';
  const isAnimation =
    activeAsset?.type === 'animation' || activeAsset?.type === 'raw_keyframe_sequence';

  useEffect(() => {
    const unlistenClosed = listen('preview-window-closed', () => {
      setIsPoppedOut(false);
    });
    const unlistenReady = listen('preview-window-ready', () => {
      if (activeAsset) {
        void emit('preview-asset-change', activeAsset);
      }
    });
    return () => {
      unlistenClosed.then((fn) => fn());
      unlistenReady.then((fn) => fn());
    };
  }, [activeAsset]);

  useEffect(() => {
    if (activeAsset && isPoppedOut) {
      try {
        localStorage.setItem('preview-current-asset', JSON.stringify(activeAsset));
        void emit('preview-asset-change', activeAsset);
      } catch {}
    }
  }, [activeAsset, isPoppedOut]);

  const handleTogglePopout = async () => {
    if (isPoppedOut) {
      try {
        const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        const win = await WebviewWindow.getByLabel('asset-preview');
        if (win) await win.close();
      } catch {}
      setIsPoppedOut(false);
      return;
    }

    try {
      if (activeAsset) {
        localStorage.setItem('preview-current-asset', JSON.stringify(activeAsset));
      }
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      let win = await WebviewWindow.getByLabel('asset-preview');
      if (win) {
        await win.show();
        await win.setFocus();
        if (activeAsset) void emit('preview-asset-change', activeAsset);
      } else {
        win = new WebviewWindow('asset-preview', {
          url: 'preview.html',
          title: 'Asset Preview',
          width: 440,
          height: 480,
          minWidth: 280,
          minHeight: 280,
          alwaysOnTop: true,
          decorations: false,
          transparent: true,
          shadow: true,
        });
      }
      setIsPoppedOut(true);
    } catch (e) {
      console.warn('Could not launch secondary window, fallback to in-app popout', e);
      setIsPoppedOut(true);
    }
  };

  const instanceProperties = useMemo(() => {
    if (!asset) return [];
    const props = findPropertiesForInstance(asset.path, allInstances);
    if (props.length === 0) return [asset];
    return props;
  }, [asset, allInstances]);

  useEffect(() => {
    if (!activeAssetId || (!isImage && !isMesh)) {
      setThumbnailUrl(null);
      return;
    }

    setLoading(true);
    setError(false);
    invoke<string | null>('fetch_roblox_thumbnail', { assetId: activeAssetId })
      .then((url) => {
        if (url) {
          setThumbnailUrl(url);
        } else if (isImage) {
          setThumbnailUrl(`https://assetdelivery.roblox.com/v1/asset/?id=${activeAssetId}`);
        } else {
          setError(true);
        }
      })
      .catch(() => {
        if (isImage) {
          setThumbnailUrl(`https://assetdelivery.roblox.com/v1/asset/?id=${activeAssetId}`);
        } else {
          setError(true);
        }
      })
      .finally(() => setLoading(false));
  }, [activeAssetId, isImage, isMesh]);

  if (!asset || !activeAsset) {
    return (
      <EmptyState
        className="flex-1 p-6 select-none h-full bg-bg-surface/5"
        icon={<FolderOpen size={36} className="opacity-30 text-primary" />}
        title={t('explorer.noInstanceSelected')}
        description={t('explorer.noInstanceSelectedBody')}
      />
    );
  }

  const handleCopy = async (text: string, field: string) => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handlePlayAudio = async () => {
    if (playingAudioId === activeAssetId) {
      stopRobloxAudio();
      setPlayingAudioId(null);
      return;
    }

    setPlayingAudioId(activeAssetId);
    await playRobloxAudio(activeAssetId, config).catch((err) => {
      console.error('Failed to play audio:', err);
      setPlayingAudioId(null);
    });
  };

  const parentName = asset.path.split('.').slice(-2, -1)[0] || 'Workspace';

  const renderViewport = (isFloating: boolean = false) => (
    <div
      className={cn(
        'relative overflow-hidden flex items-center justify-center bg-bg-base/70',
        isFloating ? 'w-full h-full' : 'flex-1 min-h-[160px] border-b border-border-subtle',
      )}
    >
      {isAnimation && (
        <Suspense
          fallback={
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          }
        >
          <AnimationPreview assetId={activeAssetId} assetName={activeAsset.instanceName} inline />
        </Suspense>
      )}

      {(isImage || isMesh) && (
        <div
          className="w-full h-full flex items-center justify-center p-3 bg-checkerboard bg-[size:16px_16px] relative overflow-hidden cursor-grab active:cursor-grabbing select-none"
          onWheel={(e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.2 : 0.2;
            setImageZoom((prev) => Math.max(0.25, Math.min(8, +(prev + delta).toFixed(2))));
          }}
          onMouseDown={(e) => {
            if (e.button === 0) {
              setIsDraggingImage(true);
              dragStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
            }
          }}
          onMouseMove={(e) => {
            if (isDraggingImage) {
              setPan({
                x: e.clientX - dragStartRef.current.x,
                y: e.clientY - dragStartRef.current.y,
              });
            }
          }}
          onMouseUp={() => setIsDraggingImage(false)}
          onMouseLeave={() => setIsDraggingImage(false)}
        >
          {loading ? (
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          ) : error ? (
            <div className="text-xs text-destructive flex flex-col items-center gap-2">
              <ImageIcon size={24} className="opacity-40" />
              <span>{t('explorer.previewFailed')}</span>
            </div>
          ) : thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt=""
              className="max-w-full max-h-full object-contain rounded shadow-lg border border-border pointer-events-none transition-transform duration-75"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${imageZoom})`,
              }}
              draggable={false}
              onError={() => setError(true)}
            />
          ) : (
            <div className="text-xs text-text-muted flex flex-col items-center gap-2">
              <ImageIcon size={24} className="opacity-40" />
              <span>{t('explorer.previewUnavailable')}</span>
            </div>
          )}

          {thumbnailUrl && !loading && !error && (
            <div
              className="absolute bottom-2 right-2 flex items-center gap-1 bg-bg-surface/90 border border-border-subtle rounded-md px-1 py-0.5 shadow-md select-none z-10"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => setImageZoom((prev) => Math.max(0.25, +(prev - 0.25).toFixed(2)))}
                aria-label={t('explorer.zoomOut')}
                className="h-5 w-5 flex items-center justify-center text-muted-foreground hover:text-foreground text-xs font-bold rounded cursor-pointer"
              >
                -
              </button>
              <Popover>
                <PopoverTrigger
                  render={
                    <button
                      type="button"
                      className="h-5 px-1.5 flex items-center gap-0.5 text-2xs tabular-nums font-semibold text-text-secondary hover:text-foreground rounded cursor-pointer"
                    >
                      <span>{Math.round(imageZoom * 100)}%</span>
                      <ChevronDown size={9} />
                    </button>
                  }
                />
                <PopoverContent
                  align="end"
                  side="top"
                  sideOffset={4}
                  className="w-20 p-1 bg-bg-surface border border-border shadow-xl rounded-md z-[350]"
                >
                  <div className="flex flex-col gap-0.5">
                    {[0.5, 1, 1.5, 2, 4].map((z) => (
                      <button
                        key={z}
                        type="button"
                        onClick={() => {
                          setImageZoom(z);
                          setPan({ x: 0, y: 0 });
                        }}
                        className={cn(
                          'flex items-center justify-between px-1.5 py-0.5 rounded text-2xs tabular-nums transition-colors text-left',
                          imageZoom === z
                            ? 'bg-primary text-primary-foreground font-bold'
                            : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated',
                        )}
                      >
                        <span>{Math.round(z * 100)}%</span>
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
              <button
                type="button"
                onClick={() => setImageZoom((prev) => Math.min(8, +(prev + 0.25).toFixed(2)))}
                aria-label={t('explorer.zoomIn')}
                className="h-5 w-5 flex items-center justify-center text-muted-foreground hover:text-foreground text-xs font-bold rounded cursor-pointer"
              >
                +
              </button>
              <button
                type="button"
                onClick={() => {
                  setImageZoom(1);
                  setPan({ x: 0, y: 0 });
                }}
                className="h-5 px-1 flex items-center justify-center text-muted-foreground hover:text-foreground text-2xs font-medium border-l border-border-subtle/50 ml-0.5 cursor-pointer"
                aria-label={t('explorer.zoomReset')}
              >
                {t('explorer.reset')}
              </button>
            </div>
          )}
        </div>
      )}

      {isAudio && (
        <div className="w-full h-full flex flex-col items-center justify-center p-4 gap-2 bg-gradient-to-b from-bg-base/30 to-bg-base/70">
          <div className="w-12 h-10 flex items-center justify-center bg-primary/10 border border-primary/20 rounded-lg">
            <Volume2 size={20} className="text-primary" />
          </div>
          <Button
            size="sm"
            variant={playingAudioId === activeAssetId ? 'destructive' : 'default'}
            className="h-7 px-3 gap-1.5 font-semibold text-xs"
            onClick={handlePlayAudio}
          >
            {playingAudioId === activeAssetId ? (
              <>
                <Square size={11} fill="currentColor" /> {t('explorer.stopAudio')}
              </>
            ) : (
              <>
                <Play size={11} fill="currentColor" /> {t('explorer.playAudio')}
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex-1 flex flex-col h-full bg-bg-surface/10 select-none relative overflow-hidden font-sans">
      <div className="h-8 px-2.5 bg-bg-surface/60 border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="text-2xs font-semibold text-text-muted">
            {showProperties ? 'Properties -' : 'Preview -'}
          </span>
          <span className="text-xs font-bold text-foreground truncate">
            {asset.className} "{asset.instanceName}"
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'h-6 w-6 transition-colors',
              isPoppedOut ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => void handleTogglePopout()}
            aria-label={isPoppedOut ? t('explorer.dockPreview') : t('explorer.popoutPreview')}
          >
            {isPoppedOut ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label={t('explorer.closePanel')}
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
          >
            <X size={13} />
          </Button>
        </div>
      </div>

      {showViewport && !isPoppedOut && renderViewport(false)}

      {showProperties && (
        <div
          className={cn(
            'overflow-y-auto divide-y divide-border-subtle/30 text-xs font-sans transition-all duration-200',
            !showViewport || isPoppedOut ? 'flex-1' : 'shrink-0 max-h-[70%]',
          )}
        >
          <div>
            <button
              type="button"
              onClick={() => setAppearanceOpen(!appearanceOpen)}
              className="w-full h-6 px-2 bg-bg-elevated/40 hover:bg-bg-elevated/70 flex items-center gap-1.5 select-none transition-colors text-left"
            >
              <ChevronRight
                size={11}
                className={cn('transition-transform duration-150', appearanceOpen && 'rotate-90')}
              />
              <SectionLabel>{t('explorer.appearanceAndValues')}</SectionLabel>
              <span className="ml-auto font-normal text-muted-foreground">
                ({instanceProperties.length})
              </span>
            </button>

            {appearanceOpen && (
              <div className="flex flex-col divide-y divide-border-subtle/20">
                {instanceProperties.map((p) => {
                  const propAssetId = getAssetId(p);
                  const isCurrentActive =
                    activeAssetId === propAssetId && activeAsset.propertyName === p.propertyName;
                  const pinnedPid = propAssetId ? assetForcePlaceIds[propAssetId] : undefined;
                  const replId = propAssetId ? lastReplacements[propAssetId] : undefined;

                  return (
                    <div
                      key={`${p.path}:${p.propertyName}:${propAssetId}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedAssetRef(p)}
                      onKeyDown={(e) => {
                        if (e.target !== e.currentTarget) return;
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedAssetRef(p);
                        }
                      }}
                      className={cn(
                        'flex items-center min-h-[28px] px-2 py-1 gap-2 cursor-pointer transition-colors group',
                        isCurrentActive ? 'bg-primary/10' : 'hover:bg-accent/40',
                      )}
                    >
                      <div className="w-[38%] text-2xs font-medium text-text-secondary truncate flex items-center gap-1">
                        <span className="truncate">{p.propertyName || 'Asset'}</span>
                      </div>

                      <div className="flex-1 flex items-center gap-1 min-w-0">
                        <span className="text-2xs font-mono text-foreground truncate flex-1 select-all">
                          {p.rawValue || `rbxassetid://${propAssetId}`}
                        </span>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedAssetRef(p);
                          }}
                          className={cn(
                            'h-5 w-5 rounded flex items-center justify-center shrink-0 transition-colors',
                            isCurrentActive
                              ? 'text-primary bg-primary/20'
                              : 'text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100',
                          )}
                          aria-label={t('explorer.previewAsset')}
                        >
                          <Eye size={11} />
                        </button>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleCopy(propAssetId, `prop-${p.propertyName}`);
                          }}
                          className="h-5 w-5 rounded flex items-center justify-center text-muted-foreground hover:text-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                          aria-label={t('explorer.copyAssetId')}
                        >
                          {copiedField === `prop-${p.propertyName}` ? (
                            <Check size={11} className="text-primary" />
                          ) : (
                            <Copy size={11} />
                          )}
                        </button>

                        {pinnedPid && (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <div
                                  className="h-4 px-1 rounded text-2xs font-mono flex items-center gap-0.5 shrink-0 cursor-help"
                                  style={{
                                    color: getBrightPlaceIdColor(pinnedPid),
                                    backgroundColor: `${getBrightPlaceIdColor(pinnedPid)}18`,
                                  }}
                                >
                                  <Lock size={9} />
                                  <span>{formatShortId(pinnedPid)}</span>
                                </div>
                              }
                            />
                            <TooltipContent className="font-mono text-xs">
                              <span className="block">Pinned Place ID: {pinnedPid}</span>
                              <span className="block font-sans text-muted-foreground">
                                {t('explorer.pinnedPlaceIdHint')}
                              </span>
                            </TooltipContent>
                          </Tooltip>
                        )}

                        {replId && (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <div className="h-4 px-1 rounded text-2xs font-mono flex items-center gap-0.5 text-signal-spoofed bg-signal-spoofed/10 border border-signal-spoofed/20 shrink-0 cursor-help">
                                  <Inbox size={9} />
                                </div>
                              }
                            />
                            <TooltipContent className="whitespace-nowrap font-mono text-xs">
                              {t('explorer.spoofedTo').replace('{id}', String(replId))}
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <button
              type="button"
              onClick={() => setDataOpen(!dataOpen)}
              className="w-full h-6 px-2 bg-bg-elevated/40 hover:bg-bg-elevated/70 flex items-center gap-1.5 select-none transition-colors text-left"
            >
              <ChevronRight
                size={11}
                className={cn('transition-transform duration-150', dataOpen && 'rotate-90')}
              />
              <SectionLabel>{t('explorer.instanceDetails')}</SectionLabel>
            </button>

            {dataOpen && (
              <div className="flex flex-col divide-y divide-border-subtle/20">
                <div className="flex items-center min-h-[26px] px-2 py-1 gap-2">
                  <span className="w-[38%] text-2xs text-text-muted">
                    {t('explorer.className')}
                  </span>
                  <span className="flex-1 text-2xs text-text-primary font-medium truncate">
                    {asset.className || t('common.unknown')}
                  </span>
                </div>
                <div className="flex items-center min-h-[26px] px-2 py-1 gap-2">
                  <span className="w-[38%] text-2xs text-text-muted">{t('explorer.name')}</span>
                  <span className="flex-1 text-2xs text-text-primary font-medium truncate">
                    {asset.instanceName || t('common.unknown')}
                  </span>
                </div>
                <div className="flex items-center min-h-[26px] px-2 py-1 gap-2">
                  <span className="w-[38%] text-2xs text-text-muted">{t('explorer.parent')}</span>
                  <span className="flex-1 text-2xs text-text-secondary truncate">{parentName}</span>
                </div>
                <div className="flex items-center min-h-[28px] px-2 py-1 gap-2 group">
                  <span className="w-[38%] text-2xs text-text-muted">
                    {t('explorer.dataModelPath')}
                  </span>
                  <div className="flex-1 flex items-center gap-1 min-w-0">
                    <span className="text-2xs font-mono text-text-secondary truncate flex-1 select-all">
                      {asset.path || 'Unknown'}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleCopy(asset.path, 'path')}
                      className="h-5 w-5 rounded flex items-center justify-center text-muted-foreground hover:text-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      aria-label={t('explorer.copyPath')}
                    >
                      {copiedField === 'path' ? (
                        <Check size={11} className="text-primary" />
                      ) : (
                        <Copy size={11} />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
