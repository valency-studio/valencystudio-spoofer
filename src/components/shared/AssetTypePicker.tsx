import { Check } from 'lucide-react';

import { useLanguage } from '../../contexts/LanguageContext';
import { cn } from '../../lib/utils';

/** The scan categories the Studio plugin understands, in display order. */
export const SCAN_ASSET_TYPES = ['sounds', 'animations', 'images', 'meshes', 'scripts'] as const;

export type ScanAssetType = (typeof SCAN_ASSET_TYPES)[number];

const ASSET_TYPE_KEYS: Record<ScanAssetType, string> = {
  sounds: 'explorer.assetTypeSounds',
  animations: 'explorer.assetTypeAnimations',
  images: 'explorer.assetTypeImages',
  meshes: 'explorer.assetTypeMeshes',
  scripts: 'explorer.assetTypeScripts',
};

export function assetTypeLabel(t: (key: string) => string, key: ScanAssetType): string {
  return t(ASSET_TYPE_KEYS[key]);
}

export function AssetTypePicker({
  scanTypes,
  onToggle,
  size = 'md',
}: {
  scanTypes: Set<string>;
  onToggle: (key: string) => void;
  size?: 'md' | 'sm';
}) {
  const { t } = useLanguage();
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
            {assetTypeLabel(t, key)}
          </button>
        );
      })}
    </div>
  );
}
