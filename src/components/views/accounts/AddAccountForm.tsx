import { RefreshCw } from 'lucide-react';

import { useLanguage } from '../../../contexts/LanguageContext';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Switch } from '../../ui/switch';

export interface AddAccountFormProps {
  newCookie: string;
  setNewCookie: (value: string) => void;
  newApiKey: string;
  setNewApiKey: (value: string) => void;
  isDownloader: boolean;
  setIsDownloader: (value: boolean) => void;
  isUploader: boolean;
  setIsUploader: (value: boolean) => void;
  isAdding: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}

function RoleToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border-subtle p-3 bg-bg-base/40">
      <div className="space-y-0.5">
        <Label className="text-xs font-semibold">{label}</Label>
        <p className="text-2xs text-text-secondary leading-snug">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

// One form for the three places that offer "Add Account": the empty state, the
// discovered-accounts state, and the populated list. They used to be three
// hand-copied bodies that had already drifted apart in spacing and type scale.
export function AddAccountForm({
  newCookie,
  setNewCookie,
  newApiKey,
  setNewApiKey,
  isDownloader,
  setIsDownloader,
  isUploader,
  setIsUploader,
  isAdding,
  onSubmit,
  onCancel,
}: AddAccountFormProps) {
  const { t } = useLanguage();

  return (
    <>
      <div className="flex flex-col gap-3 py-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs font-semibold">{t('accounts.cookieLabel')}</Label>
          <Input
            type="password"
            value={newCookie}
            onChange={(e) => setNewCookie(e.target.value)}
            placeholder={t('accounts.cookiePlaceholder')}
            className="h-8 text-xs bg-bg-base/70"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs font-semibold">{t('accounts.apiKeyLabel')}</Label>
          <Input
            type="password"
            value={newApiKey}
            onChange={(e) => setNewApiKey(e.target.value)}
            placeholder={t('accounts.apiKeyPlaceholder')}
            className="h-8 text-xs bg-bg-base/70"
          />
        </div>
        <RoleToggle
          label={t('accounts.useForDownloading')}
          description={t('accounts.useForDownloadingDesc')}
          checked={isDownloader}
          onChange={setIsDownloader}
        />
        <RoleToggle
          label={t('accounts.useForUploading')}
          description={t('accounts.useForUploadingDesc')}
          checked={isUploader}
          onChange={setIsUploader}
        />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onCancel}>
          {t('accounts.cancel')}
        </Button>
        <Button
          size="sm"
          className="h-8 text-xs font-semibold"
          onClick={onSubmit}
          disabled={isAdding || (!newCookie && !newApiKey)}
        >
          {isAdding ? <RefreshCw className="animate-spin mr-1.5" size={13} /> : null}
          {t('accounts.add')}
        </Button>
      </div>
    </>
  );
}
