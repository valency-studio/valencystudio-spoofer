import { ask } from '@tauri-apps/plugin-dialog';
import { TriangleAlert } from 'lucide-react';

import { useConfig } from '../../../contexts/ConfigContext';
import { useLanguage } from '../../../contexts/LanguageContext';
import { Button } from '../../ui/button';
import { SettingCard } from './SettingComponents';

export default function DangerCard() {
  const { t } = useLanguage();
  const { resetConfig } = useConfig();

  return (
    <SettingCard
      icon={<TriangleAlert size={16} className="text-danger" />}
      title={t('settings.dangerZone')}
      description="Irreversible actions and complete configuration reset."
      className="bg-danger/5 border-danger/20"
    >
      <div className="px-4 py-3 flex items-center justify-between gap-4 hover:bg-danger/10 transition-colors">
        <div className="space-y-0.5 min-w-0 flex-1">
          <span className="text-xs font-semibold text-text-primary block">Reset All Settings</span>
          <p className="text-2xs text-text-secondary leading-relaxed">
            Reset all settings and preferences to default values. This cannot be undone.
          </p>
        </div>
        <Button
          variant="destructive"
          size="sm"
          className="h-8 px-3 font-semibold text-xs shadow-xs bg-danger hover:bg-danger/90 text-white shrink-0 rounded-md"
          onClick={async () => {
            const confirmed = await ask(
              'Reset all settings to their default values? This cannot be undone.',
              {
                title: 'Reset Settings',
                kind: 'warning',
              },
            );
            if (confirmed) {
              resetConfig();
              window.ValencyStudioLog?.('success', t('settings.resetSuccess'));
            }
          }}
        >
          {t('settings.resetToDefaults')}
        </Button>
      </div>
    </SettingCard>
  );
}
