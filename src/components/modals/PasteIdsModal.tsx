import { ClipboardPaste, Plus, Replace } from 'lucide-react';
import { useState } from 'react';

import { useLanguage } from '../../contexts/LanguageContext';
import { cn } from '../../lib/utils';
import { useSpooferStore } from '../../stores/spooferStore';
import { logValencyStudio } from '../../utils/robloxProfiles';
import { queueStudioReplacements } from '../../utils/studioBridge';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';

export default function PasteIdsModal({
  open,
  onOpenChange,
  initialMode = 'add',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMode?: 'add' | 'replace';
}) {
  const { t } = useLanguage();
  const [mode, setMode] = useState<'add' | 'replace'>(initialMode);
  const [rawInput, setRawInput] = useState('');
  const [isApplying, setIsApplying] = useState(false);

  const rootInstances = useSpooferStore((s) => s.rootInstances);
  const setSelectedAssetIds = useSpooferStore((s) => s.setSelectedAssetIds);
  const setSelectedAssetKeys = useSpooferStore((s) => s.setSelectedAssetKeys);
  const addGhostAssets = useSpooferStore((s) => s.addGhostAssets);
  const showToast = useSpooferStore((s) => s.showToast);

  const parsePairsInput = (text: string): { pairs: Record<string, string>; badLines: number } => {
    const pairs: Record<string, string> = {};
    let badLines = 0;
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#') || line.startsWith('//')) continue;

      const parts = line
        .split(/->|=>|[=,\t\s]+/)
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts.length < 2) {
        badLines++;
        continue;
      }
      const [oldId, newId] = parts;
      if (!/^\d+$/.test(oldId) || !/^\d+$/.test(newId)) {
        badLines++;
        continue;
      }
      pairs[oldId] = newId;
    }
    return { pairs, badLines };
  };

  const parseSingleIdsInput = (text: string): string[] => {
    const ids = new Set<string>();
    const tokens = text.split(/[\s,;\n\r\t]+/);
    for (const token of tokens) {
      const cleaned = token.replace(/\D/g, '');
      if (cleaned.length >= 4 && cleaned.length <= 20) {
        ids.add(cleaned);
      }
    }
    return Array.from(ids);
  };

  const { pairs, badLines: badReplaceLines } = parsePairsInput(rawInput);
  const replacePairCount = Object.keys(pairs).length;
  const singleIds = parseSingleIdsInput(rawInput);

  const handleApply = async () => {
    if (mode === 'replace') {
      if (replacePairCount === 0) return;
      setIsApplying(true);
      try {
        await queueStudioReplacements(pairs);
        logValencyStudio(
          'success',
          `Sent ${replacePairCount} replacement${replacePairCount === 1 ? '' : 's'} to the Studio plugin.`,
          true,
        );
        showToast('success', `Sent ${replacePairCount} replacement pair(s) to Studio!`);
        import('@tauri-apps/plugin-notification')
          .then(({ sendNotification }) => {
            sendNotification({
              title: 'ValencyStudio - Spoofer',
              body: `Dispatched ${replacePairCount} manual replacement(s) to Studio.`,
            });
          })
          .catch(() => {});
        setRawInput('');
        onOpenChange(false);
      } catch (e: unknown) {
        logValencyStudio(
          'error',
          `Could not send replacements to Studio: ${e instanceof Error ? e.message : String(e)}. Make sure Roblox Studio is open and the ValencyStudio - Spoofer plugin is running.`,
          true,
        );
      } finally {
        setIsApplying(false);
      }
    } else {
      if (singleIds.length === 0) return;

      const existingStudioIds = new Set<string>();
      const collectStudioIds = (nodes: typeof rootInstances) => {
        for (const node of nodes) {
          for (const asset of node.assets) {
            const id = asset.assetId || (asset as any).id;
            if (id) existingStudioIds.add(String(id));
          }
          if (node.children) collectStudioIds(node.children);
        }
      };
      collectStudioIds(rootInstances);

      const matchedIds: string[] = [];
      const ghostIds: string[] = [];

      for (const id of singleIds) {
        if (existingStudioIds.has(id)) {
          matchedIds.push(id);
        } else {
          ghostIds.push(id);
        }
      }

      if (ghostIds.length > 0) {
        addGhostAssets(ghostIds);
      }

      setSelectedAssetIds((prev) => {
        const next = new Set(prev);
        for (const id of singleIds) next.add(id);
        return next;
      });
      setSelectedAssetKeys((prev) => {
        const next = new Set(prev);
        for (const id of singleIds) next.add(id);
        return next;
      });

      const message = t('misc.pasteIdsAdded')
        .replace('{single}', String(singleIds.length))
        .replace('{matched}', String(matchedIds.length))
        .replace('{ghost}', String(ghostIds.length));
      logValencyStudio('info', message, true);
      showToast('info', message);

      setRawInput('');
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <ClipboardPaste size={18} className="text-primary" />
            {t('misc.pasteIdsTitle')}
          </DialogTitle>
        </DialogHeader>

        <div className="flex rounded-lg overflow-hidden border border-border-subtle bg-bg-base p-1 gap-1">
          <button
            type="button"
            onClick={() => setMode('add')}
            className={cn(
              'flex-1 flex items-center justify-center gap-2 py-1.5 rounded-md text-xs font-semibold transition-all',
              mode === 'add'
                ? 'bg-primary/15 text-primary border border-primary/30 shadow-sm'
                : 'text-text-muted hover:text-text-primary hover:bg-bg-elevated',
            )}
          >
            <Plus size={14} />
            {t('misc.pasteIdsAddMode')}
          </button>
          <button
            type="button"
            onClick={() => setMode('replace')}
            className={cn(
              'flex-1 flex items-center justify-center gap-2 py-1.5 rounded-md text-xs font-semibold transition-all',
              mode === 'replace'
                ? 'bg-primary/15 text-primary border border-primary/30 shadow-sm'
                : 'text-text-muted hover:text-text-primary hover:bg-bg-elevated',
            )}
          >
            <Replace size={14} />
            {t('misc.pasteIdsReplaceMode')}
          </button>
        </div>

        <div className="flex flex-col gap-3">
          {mode === 'add' ? (
            <p className="text-xs text-text-secondary leading-relaxed">
              {t('misc.pasteIdsAddBodyPre')}
              <strong className="text-primary font-semibold">Ghost IDs</strong>
              {t('misc.pasteIdsAddBodyPost')}
            </p>
          ) : (
            <p className="text-xs text-text-secondary leading-relaxed">
              {t('misc.pasteIdsReplaceBodyPre')}
              <code className="text-2xs bg-bg-elevated px-1 rounded">-{'>'}</code>{' '}
              <code className="text-2xs bg-bg-elevated px-1 rounded">=</code>{' '}
              <code className="text-2xs bg-bg-elevated px-1 rounded">,</code>
              {t('misc.pasteIdsReplaceBodyMid')}
              <code className="text-2xs bg-bg-elevated px-1 rounded">#</code>
              {t('common.or')} <code className="text-2xs bg-bg-elevated px-1 rounded">//</code>
              {t('misc.pasteIdsReplaceBodyPost')}
            </p>
          )}

          <textarea
            value={rawInput}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setRawInput(e.target.value)}
            placeholder={
              mode === 'add'
                ? '123456789\n987654321\n1122334455'
                : '12345 67890\n11111 -> 22222\n33333, 44444'
            }
            className="w-full h-48 p-2.5 rounded-md font-mono text-xs bg-bg-surface border border-border-strong text-text-primary focus:border-primary focus:outline-none resize-none"
            spellCheck={false}
          />

          <div className="flex items-center justify-between text-xs">
            <div className="text-text-secondary">
              {mode === 'add' ? (
                singleIds.length > 0 && (
                  <span className="text-primary font-medium">
                    {t('misc.pasteIdsReady').replace('{count}', String(singleIds.length))}
                  </span>
                )
              ) : (
                <>
                  {replacePairCount > 0 && (
                    <span className="text-primary font-medium">
                      {t('misc.pasteIdsValidPairs').replace('{count}', String(replacePairCount))}
                    </span>
                  )}
                  {replacePairCount > 0 && badReplaceLines > 0 && (
                    <span className="text-text-muted"> · </span>
                  )}
                  {badReplaceLines > 0 && (
                    <span className="text-signal-warn">
                      {t('misc.pasteIdsLinesSkipped').replace('{count}', String(badReplaceLines))}
                    </span>
                  )}
                </>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                size="sm"
                onClick={() => void handleApply()}
                disabled={
                  (mode === 'add' ? singleIds.length === 0 : replacePairCount === 0) || isApplying
                }
              >
                {isApplying
                  ? t('misc.pasteIdsProcessing')
                  : mode === 'add'
                    ? t('misc.pasteIdsAddToExplorer')
                    : t('misc.pasteIdsSendToStudio')}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
