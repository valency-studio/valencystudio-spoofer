import { Wrench } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useConfig } from '../../../contexts/ConfigContext';
import { useLanguage } from '../../../contexts/LanguageContext';
import { isMemoryInjectionSupported } from '../../../utils/tauriRuntime';
import { SettingCard, SettingSwitchRow } from './SettingComponents';

export default function AdvancedSection() {
  const { t } = useLanguage();
  const { config, updateConfig } = useConfig();
  const [memoryInjectionSupported, setMemoryInjectionSupported] = useState(false);

  useEffect(() => {
    isMemoryInjectionSupported().then(setMemoryInjectionSupported);
  }, []);

  return (
    <SettingCard
      icon={Wrench}
      title={t('settings.advanced')}
      description={t('settings.advancedDescription')}
    >
      <SettingSwitchRow
        label={t('settings.clipboardMonitoring')}
        description={t('settings.clipboardMonitoringDesc')}
        checked={config.advanced.clipboardMonitoring}
        onCheckedChange={(v) => updateConfig('advanced', 'clipboardMonitoring', v)}
      />

      <SettingSwitchRow
        label={t('settings.memoryInjection')}
        description={
          memoryInjectionSupported
            ? t('settings.memoryInjectionDescSupported')
            : t('settings.memoryInjectionDescUnsupported')
        }
        disabled={!memoryInjectionSupported}
        checked={memoryInjectionSupported ? config.advanced.memoryInjectionEnabled : false}
        onCheckedChange={(v) => {
          if (!memoryInjectionSupported) return;
          updateConfig('advanced', 'memoryInjectionEnabled', v);
        }}
      />
    </SettingCard>
  );
}
