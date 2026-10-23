import { Info, ShieldCheck } from 'lucide-react';

import { useConfig } from '../../../contexts/ConfigContext';
import { useLanguage } from '../../../contexts/LanguageContext';
import { Label } from '../../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { SettingCard, SettingFieldRow, SettingSwitchRow } from './SettingComponents';

export default function PermissionsCard() {
  const { config, updateConfig } = useConfig();
  const { t } = useLanguage();

  const permissions = config.permissions || {
    enabled: false,
    subjectType: 'experience',
    subjectIds: '',
    action: 'Use',
  };

  const subjectTypeOptions = [
    { value: 'experience', label: t('settings.subjectExperience') },
    { value: 'group', label: t('settings.subjectGroup') },
    { value: 'user', label: t('settings.subjectUser') },
  ];

  const [actionPre, actionPost] = t('settings.accessActionBody').split('{code}');

  return (
    <SettingCard
      icon={ShieldCheck}
      title={t('settings.assetPermissionsTitle')}
      description={t('settings.assetPermissionsDescription')}
    >
      <SettingSwitchRow
        label={t('settings.autoGrantPermissions')}
        description={t('settings.autoGrantPermissionsDescription')}
        checked={permissions.enabled}
        onCheckedChange={(val) => updateConfig('permissions', 'enabled', val)}
      />

      <div className="px-3.5 py-2.5 flex items-center justify-between gap-4 hover:bg-bg-elevated/20 transition-colors">
        <div className="space-y-0.5 min-w-0 flex-1">
          <Label className="text-xs font-semibold text-text-primary block">
            {t('settings.targetSubjectType')}
          </Label>
          <p className="text-2xs text-text-secondary leading-snug">
            {t('settings.targetSubjectTypeDescription')}
          </p>
        </div>
        <Select
          value={permissions.subjectType}
          onValueChange={(val) =>
            updateConfig('permissions', 'subjectType', val as 'experience' | 'user' | 'group')
          }
        >
          <SelectTrigger className="w-56 h-8 text-xs bg-bg-base/70">
            <SelectValue placeholder={t('settings.selectType')} />
          </SelectTrigger>
          <SelectContent>
            {subjectTypeOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value} className="text-xs">
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <SettingFieldRow
        label={t('settings.targetSubjectIds')}
        description={
          permissions.subjectType === 'experience'
            ? t('settings.targetSubjectIdsPlaceDesc')
            : permissions.subjectType === 'user'
              ? t('settings.targetSubjectIdsUserDesc')
              : t('settings.targetSubjectIdsGroupDesc')
        }
        value={permissions.subjectIds}
        onChange={(val) => updateConfig('permissions', 'subjectIds', val)}
        placeholder={
          permissions.subjectType === 'experience'
            ? t('settings.targetSubjectIdsPlacePlaceholder')
            : permissions.subjectType === 'user'
              ? t('settings.targetSubjectIdsUserPlaceholder')
              : t('settings.targetSubjectIdsGroupPlaceholder')
        }
      />

      <div className="px-3.5 py-2.5 bg-primary/5 border-t border-primary/10 flex items-start gap-2.5">
        <Info size={14} className="text-primary shrink-0 mt-0.5" />
        <p className="text-2xs text-text-secondary leading-relaxed">
          <strong className="text-text-primary font-medium">
            {t('settings.accessActionTitle')}
          </strong>{' '}
          {actionPre}
          <code className="px-1 py-0.5 rounded bg-bg-base border border-border-subtle text-primary font-mono text-2xs">
            Use
          </code>
          {actionPost}
        </p>
      </div>
    </SettingCard>
  );
}
