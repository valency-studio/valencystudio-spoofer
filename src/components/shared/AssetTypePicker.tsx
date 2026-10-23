import { Check } from 'lucide-react';

import { cn } from '../../lib/utils';

/** The scan categories the Studio plugin understands, in display order. */
export const SCAN_ASSET_TYPES = ['sounds', 'animations', 'images', 'meshes', 'scripts'] as const;

export type ScanAssetType = (typeof SCAN_ASSET_TYPES)[number];

// ponytail: labels stay literal English — explorer has `sounds`/`scripts` keys nowhere yet.
// Add them to the five locale files and read them here when i18n catches up.
const ASSET_TYPE_LABELS: Record<ScanAssetType, string> = {
  sounds: 'Sounds',
  animations: 'Animations',
  images: 'Images',
  meshes: 'Meshes',
  scripts: 'Scripts',
};

export function AssetTypePicker({
  scanTypes,
  onToggle,
  size = 'md',
}: {
  scanTypes: Set<string>;
  onToggle: (key: string) => void;
  size?: 'md' | 'sm';
}) {
  const compact = size === 'sm';

  return (
    <div className={cn('flex flex-wrap', compact ? 'gap-1' : 'gap-1.5')}>
      {SCAN_ASSET_TYPES.map((key) => {
        const active = scanTypes.has(key);
        return (
          <button
            key={key}
            type="button"
            onClick={() => onToggle(key)}
            className={cn(
              'rounded-full text-2xs font-semibold border transition-colors cursor-pointer',
              compact ? 'px-2 py-0.5' : 'px-2.5 py-1',
              active
                ? 'bg-primary/15 border-primary/40 text-primary'
                : 'bg-bg-base border-border-subtle text-text-muted hover:text-text-primary hover:border-border',
            )}
          >
            {active && <Check size={compact ? 8 : 9} className="inline mr-1" />}
            {ASSET_TYPE_LABELS[key]}
          </button>
        );
      })}
    </div>
  );
}
