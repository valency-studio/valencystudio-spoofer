import { ArrowDownUp } from 'lucide-react';

import { useConfig } from '../../../contexts/ConfigContext';
import { useLanguage } from '../../../contexts/LanguageContext';
import { SettingCard, SettingSwitchRow } from '../settings/SettingComponents';

export default function UploadSection() {
  const { t } = useLanguage();
  const { config, updateConfig } = useConfig();

  return (
    <SettingCard
      icon={ArrowDownUp}
      title={t('config.assetProcessing')}
      description={t('settings.assetProcessingDescription')}
    >
      <SettingSwitchRow
        label={t('settings.skipOwned')}
        description={t('settings.skipOwnedDescription')}
        checked={config.advanced.skipOwned}
        onCheckedChange={(value) => updateConfig('advanced', 'skipOwned', value)}
      />

      <SettingSwitchRow
        label={t('settings.preserveMetadata')}
        description={t('config.preserveMetadataDesc')}
        checked={config.spoofing.preserveMetadata}
        onCheckedChange={(value) => updateConfig('spoofing', 'preserveMetadata', value)}
      />

      <SettingSwitchRow
        label={t('settings.archiveRecovery')}
        description={t('config.archiveRecoveryDesc')}
        checked={config.advanced.enableArchiveRecovery}
        onCheckedChange={(value) => updateConfig('advanced', 'enableArchiveRecovery', value)}
      />
    </SettingCard>
  );
}
