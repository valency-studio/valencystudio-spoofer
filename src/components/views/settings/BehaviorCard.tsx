import { invoke } from '@tauri-apps/api/core';
import { HelpCircle, Laptop } from 'lucide-react';

import { useConfig } from '../../../contexts/ConfigContext';
import { useLanguage } from '../../../contexts/LanguageContext';
import { logValencyStudio } from '../../../utils/robloxProfiles';
import { Button } from '../../ui/button';
import { SettingCard, SettingSwitchRow } from './SettingComponents';

export default function BehaviorCard() {
  const { t } = useLanguage();
  const { config, updateConfig } = useConfig();

  const handleDesktopNotificationsChange = async (enabled: boolean) => {
    updateConfig('general', 'desktopNotifications', enabled);
    if (!enabled) {
      logValencyStudio('info', t('misc.notificationsDisabledTitle'));
      return;
    }

    try {
      const shown = await invoke<boolean>('show_notification', {
        options: {
          title: 'ValencyStudio - Spoofer',
          body: t('misc.desktopNotificationsEnabled'),
        },
      });
      logValencyStudio(
        shown ? 'success' : 'warn',
        shown ? t('misc.notificationsEnabledTitle') : t('misc.notificationsFailed'),
      );
    } catch (err) {
      logValencyStudio('error', `Desktop notifications failed: ${String(err)}`);
    }
  };

  const handleShowTutorial = () => {
    updateConfig('ui', 'tutorialCompleted', false);
    window.dispatchEvent(new Event('ValencyStudio-start-tutorial'));
  };

  return (
    <SettingCard
      icon={Laptop}
      title={t('settings.behavior')}
      description={t('settings.behaviorDescription')}
    >
      <SettingSwitchRow
        label={t('settings.desktopNotifications')}
        description={t('settings.notificationsDescription')}
        checked={config.general.desktopNotifications}
        onCheckedChange={handleDesktopNotificationsChange}
      />

      <SettingSwitchRow
        label={t('settings.hideToTray')}
        description={t('settings.hideToTrayDesc')}
        checked={config.general.hideToTrayOnClose}
        onCheckedChange={(v) => updateConfig('general', 'hideToTrayOnClose', v)}
      />

      <SettingSwitchRow
        label={t('settings.telemetry')}
        description={t('settings.telemetryDesc')}
        checked={config.general.telemetryEnabled}
        onCheckedChange={(v) => updateConfig('general', 'telemetryEnabled', v)}
      />

      <div className="px-4 py-3 flex items-center justify-between gap-4 hover:bg-bg-elevated/20 transition-colors">
        <div className="space-y-0.5 min-w-0 flex-1">
          <span className="text-xs font-semibold text-text-primary block">
            {t('settings.onboardingTutorial')}
          </span>
          <p className="text-2xs text-text-secondary leading-relaxed">
            {t('settings.tutorialDescription')}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleShowTutorial}
          className="h-8 px-3 text-xs flex items-center gap-1.5 shrink-0"
        >
          <HelpCircle size={13} />
          <span>{t('settings.launchTutorial')}</span>
        </Button>
      </div>
    </SettingCard>
  );
}
