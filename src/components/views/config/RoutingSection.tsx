import { Gauge } from 'lucide-react';

import { useConfig } from '../../../contexts/ConfigContext';
import { useLanguage } from '../../../contexts/LanguageContext';
import {
  SettingCard,
  SettingFieldRow,
  SettingSliderItem,
  SettingSwitchRow,
} from '../settings/SettingComponents';

export default function RoutingSection() {
  const { t } = useLanguage();
  const { config, updateConfig } = useConfig();

  return (
    <SettingCard
      icon={Gauge}
      title={t('config.routingLimits')}
      description={t('settings.routingDescription')}
    >
      <SettingFieldRow
        label={t('settings.proxyUrl')}
        description={t('settings.proxyUrlPlaceholder')}
        value={config.advanced.proxyUrl}
        onChange={(val) => updateConfig('advanced', 'proxyUrl', val)}
        placeholder="http://127.0.0.1:8080"
      />

      <SettingSwitchRow
        label={t('settings.concurrentSpoofing')}
        description={t('settings.concurrentSpoofingDescription')}
        checked={config.advanced.concurrentSpoofing}
        onCheckedChange={(val) => updateConfig('advanced', 'concurrentSpoofing', val)}
      />

      {config.advanced.concurrentSpoofing && (
        <>
          <SettingSliderItem
            label={t('settings.maxConcurrency')}
            description={t('settings.maxConcurrencyDescription')}
            value={config.advanced.maxConcurrency}
            onChange={(val) => updateConfig('advanced', 'maxConcurrency', val)}
            min={1}
            max={100}
            ticks={[1, 50, 100]}
          />

          <SettingSliderItem
            label={t('settings.maxDownloadConcurrency')}
            description={t('settings.maxDownloadConcurrencyDescription')}
            value={config.advanced.maxDownloadConcurrency}
            onChange={(val) => updateConfig('advanced', 'maxDownloadConcurrency', val)}
            min={1}
            max={100}
            ticks={[1, 50, 100]}
          />

          <SettingSliderItem
            label={t('settings.discoveryConcurrency')}
            description={t('settings.discoveryConcurrencyDescription')}
            value={config.advanced.discoveryConcurrency ?? 30}
            onChange={(val) => updateConfig('advanced', 'discoveryConcurrency', val)}
            min={1}
            max={50}
            ticks={[1, 25, 50]}
          />

          <SettingSliderItem
            label={t('settings.uploadPollInterval')}
            description={t('settings.uploadPollIntervalDescription')}
            value={config.advanced.operationPollIntervalMs ?? 250}
            onChange={(val) => updateConfig('advanced', 'operationPollIntervalMs', val)}
            min={100}
            max={1000}
            ticks={[100, 250, 500, 1000]}
          />

          <SettingSliderItem
            label={t('settings.batchSizeSpeed')}
            description={
              (config.advanced.batchSize ?? 50) <= 25
                ? t('settings.batchSpeedUltra')
                : (config.advanced.batchSize ?? 50) <= 80
                  ? t('settings.batchSpeedBalanced')
                  : (config.advanced.batchSize ?? 50) <= 180
                    ? t('settings.batchSpeedFast')
                    : t('settings.batchSpeedMax')
            }
            value={config.advanced.batchSize ?? 50}
            onChange={(val) => {
              updateConfig('advanced', 'batchSize', val);
              import('@tauri-apps/api/core').then(({ invoke }) => {
                invoke('set_plugin_batch_size', { batchSize: val }).catch(console.error);
              });
            }}
            min={10}
            max={500}
            step={5}
            ticks={[10, 50, 100, 180, 250, 350, 425, 500]}
          />
        </>
      )}
    </SettingCard>
  );
}
