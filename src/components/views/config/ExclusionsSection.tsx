import { ShieldAlert } from 'lucide-react';

import { useConfig } from '../../../contexts/ConfigContext';
import { useLanguage } from '../../../contexts/LanguageContext';
import { SettingCard, SettingFieldRow } from '../settings/SettingComponents';

export default function ExclusionsSection() {
  const { t } = useLanguage();
  const { config, updateConfig } = useConfig();

  return (
    <SettingCard
      icon={ShieldAlert}
      title={t('config.exclusions')}
      description={t('settings.exclusionsDescription')}
    >
      <SettingFieldRow
        label={t('settings.excludedUsers')}
        description={t('settings.excludedUsersPlaceholder')}
        value={config.advanced.excludedUserIds}
        onChange={(val) => updateConfig('advanced', 'excludedUserIds', val)}
        placeholder="12345, 67890"
      />

      <SettingFieldRow
        label={t('settings.excludedGroups')}
        description={t('settings.excludedGroupsPlaceholder')}
        value={config.advanced.excludedGroupIds}
        onChange={(val) => updateConfig('advanced', 'excludedGroupIds', val)}
        placeholder="54321, 98765"
      />
    </SettingCard>
  );
}
