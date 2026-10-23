import { invoke } from '@tauri-apps/api/core';
import { Bug, FolderOpen, Trash2 } from 'lucide-react';

import { useConfig } from '../../../contexts/ConfigContext';
import { useLanguage } from '../../../contexts/LanguageContext';
import { useSpooferStore } from '../../../stores/spooferStore';
import { logValencyStudio } from '../../../utils/robloxProfiles';
import { Button } from '../../ui/button';
import { SettingCard, SettingSwitchRow } from './SettingComponents';

export default function DebugCard() {
  const { t } = useLanguage();
  const { config, updateConfig } = useConfig();

  async function handleClearCache(successMessage = t('settings.cacheCleared')) {
    try {
      await Promise.all([
        invoke('clear_asset_cache'),
        invoke('clear_plugin_cache'),
        invoke('clear_app_cache'),
      ]);

      const store = useSpooferStore.getState();
      store.setLastReplacements({});
      store.clearAssetStatuses();
      store.setAssetForcePlaceIds({});

      Object.keys(localStorage).forEach((key) => {
        if (key.startsWith('ValencyStudio - Spoofer_') || key.startsWith('preview-')) {
          localStorage.removeItem(key);
        }
      });
      sessionStorage.clear();
      store.showToast('success', successMessage);
      logValencyStudio('success', successMessage);
    } catch (err) {
      useSpooferStore
        .getState()
        .showToast('error', `${t('settings.cacheClearFailed')}: ${String(err)}`);
      logValencyStudio('error', `Failed to clear cache: ${String(err)}`);
    }
  }

  const handleCacheChange = async (enabled: boolean) => {
    updateConfig('debug', 'enableCache', enabled);
    if (enabled) {
      logValencyStudio('success', t('settings.cacheEnabled'));
      return;
    }
    await handleClearCache(t('settings.cacheDisabled'));
  };

  return (
    <SettingCard icon={Bug} title={t('debug.title')} description={t('settings.debugDescription')}>
      <SettingSwitchRow
        label={t('settings.debugMode')}
        description={t('settings.debugConsoleDescription')}
        checked={config.debug.debugMode}
        onCheckedChange={(v) => updateConfig('debug', 'debugMode', v)}
      />

      <SettingSwitchRow
        label={t('settings.enableCache')}
        description={t('settings.cacheDescription')}
        checked={config.debug.enableCache}
        onCheckedChange={handleCacheChange}
      />

      <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-2.5 bg-bg-base/20">
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs font-semibold flex items-center justify-center gap-2"
          onClick={() => void handleClearCache()}
        >
          <Trash2 size={13} className="text-muted-foreground" />
          <span>{t('settings.clearCache')}</span>
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs font-semibold flex items-center justify-center gap-2"
          onClick={() =>
            invoke('open_logs_folder').catch((err) =>
              logValencyStudio('error', `Failed to open logs folder: ${String(err)}`),
            )
          }
        >
          <FolderOpen size={13} className="text-muted-foreground" />
          <span>{t('settings.openLogsFolder')}</span>
        </Button>
      </div>
    </SettingCard>
  );
}
