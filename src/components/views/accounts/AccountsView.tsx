import { invoke } from '@tauri-apps/api/core';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import {
  CheckCircle2,
  Cookie,
  Key,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
  User2,
} from 'lucide-react';
import { useState } from 'react';

import { useConfig } from '../../../contexts/ConfigContext';
import { useLanguage } from '../../../contexts/LanguageContext';
import { useConfigStore } from '../../../stores/configStore';
import {
  loadCachedUsers,
  logValencyStudio,
  validateCookieProfile,
} from '../../../utils/robloxProfiles';
import { Button } from '../../ui/button';
import { Card } from '../../ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../../ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/tooltip';
import { AddAccountForm } from './AddAccountForm';

type ApiKeyOwnerDetectResult = {
  ok: boolean;
  ownerUserId?: string | null;
  message?: string;
};

export default function AccountsView() {
  const { config } = useConfig();
  const { t } = useLanguage();
  const { accountSecrets, updateAccountSecret, updateAccountsList, secretsLoaded } =
    useConfigStore();

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newCookie, setNewCookie] = useState('');
  const [newApiKey, setNewApiKey] = useState('');
  const [isDownloader, setIsDownloader] = useState(true);
  const [isUploader, setIsUploader] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const discoveredUsers = loadCachedUsers();

  const [isValidatingAll, setIsValidatingAll] = useState(false);

  const handleAddAccount = async () => {
    setIsAdding(true);
    try {
      let userId = '';
      let name = 'Unknown';
      let avatarUrl = '';

      let cookieValidated = false;
      let apiKeyValidated = false;

      if (newCookie.trim()) {
        const result = await validateCookieProfile(newCookie.trim());
        userId = String(result.user.id);
        name = result.user.displayName || result.user.name;
        avatarUrl = result.user.avatarUrl || '';
        cookieValidated = true;
      } else if (newApiKey.trim()) {
        const result = await invoke<ApiKeyOwnerDetectResult>('detect_opencloud_api_key_owner', {
          key: newApiKey.trim(),
        });
        if (result.ok && result.ownerUserId) {
          userId = result.ownerUserId;
          name = `API Key Owner (${userId})`;
          apiKeyValidated = true;
        } else {
          throw new Error(
            'The Open Cloud API key is invalid or unauthorized. Please verify the key and its permissions in Creator Hub.',
          );
        }
      } else {
        throw new Error('Please enter a Roblox cookie (.ROBLOSECURITY) or an Open Cloud API key.');
      }

      if (newCookie.trim() && newApiKey.trim() && !apiKeyValidated) {
        try {
          const apiResult = await invoke<ApiKeyOwnerDetectResult>(
            'detect_opencloud_api_key_owner',
            { key: newApiKey.trim() },
          );
          apiKeyValidated = apiResult.ok;
        } catch {
          apiKeyValidated = false;
        }
      }

      const existingAccounts = [...config.accounts];
      const existingIdx = existingAccounts.findIndex((a) => a.id === userId);

      if (existingIdx >= 0) {
        existingAccounts[existingIdx] = {
          ...existingAccounts[existingIdx],
          isDownloader,
          isUploader,
          name,
          avatarUrl: avatarUrl || existingAccounts[existingIdx].avatarUrl,

          cookieValidated: newCookie.trim()
            ? cookieValidated
            : existingAccounts[existingIdx].cookieValidated,
          apiKeyValidated: newApiKey.trim()
            ? apiKeyValidated
            : existingAccounts[existingIdx].apiKeyValidated,
        };
      } else {
        existingAccounts.push({
          id: userId,
          name,
          avatarUrl,
          isDownloader,
          isUploader,
          cookieValidated,
          apiKeyValidated,
        });
      }

      updateAccountsList(existingAccounts);
      await updateAccountSecret(
        userId,
        newCookie.trim() || undefined,
        newApiKey.trim() || undefined,
      );

      setIsAddOpen(false);
      setNewCookie('');
      setNewApiKey('');
      logValencyStudio('success', 'Roblox account added.', true);
    } catch (e: any) {
      logValencyStudio('error', `Could not add account: ${e.message || String(e)}`, true);
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemoveAccount = (id: string) => {
    const updated = config.accounts.filter((a) => a.id !== id);
    updateAccountsList(updated);
  };

  const handleValidateAll = async () => {
    setIsValidatingAll(true);
    let validCount = 0;
    let invalidCount = 0;

    const updated = [...config.accounts];

    for (let i = 0; i < updated.length; i++) {
      const acc = updated[i];
      const secrets = accountSecrets[acc.id];
      let cookieOk = acc.cookieValidated ?? false;
      let apiKeyOk = acc.apiKeyValidated ?? false;

      if (secrets?.cookie) {
        try {
          await validateCookieProfile(secrets.cookie);
          cookieOk = true;
          validCount++;
        } catch {
          cookieOk = false;
          invalidCount++;
        }
      }
      if (secrets?.apiKey) {
        try {
          const result = await invoke<ApiKeyOwnerDetectResult>('detect_opencloud_api_key_owner', {
            key: secrets.apiKey,
          });
          apiKeyOk = result.ok;
          if (result.ok) {
            validCount++;
          } else {
            invalidCount++;
          }
        } catch {
          apiKeyOk = false;
          invalidCount++;
        }
      }

      updated[i] = { ...acc, cookieValidated: cookieOk, apiKeyValidated: apiKeyOk };
    }

    updateAccountsList(updated);
    setIsValidatingAll(false);
    logValencyStudio(
      'info',
      `Account validation finished: ${validCount} valid, ${invalidCount} invalid.`,
      true,
    );
  };

  const handleSelectAccount = async (acc: (typeof config.accounts)[0]) => {
    const store = useConfigStore.getState();
    const secrets = accountSecrets[acc.id];

    store.updateConfig('spoofing', 'selectedUser', acc.id);

    store.updateCategory('advanced', {
      autoCookieStudio: false,
      autoCookieBrowser: false,
    });

    const applied: string[] = [];

    if (secrets?.cookie && acc.isDownloader) {
      store.updateConfig('spoofing', 'cookie', secrets.cookie);
      applied.push(t('accounts.downloader'));
    }
    if (secrets?.apiKey && acc.isUploader) {
      store.updateConfig('spoofing', 'apiKey', secrets.apiKey);
      applied.push(t('accounts.uploader'));
    }

    const roles = applied.length > 0 ? ` (${applied.join(', ')})` : '';
    const msg = `${t('accounts.selectedAccount')}: ${acc.name}${roles}`;

    try {
      let permissionGranted = await isPermissionGranted();
      if (!permissionGranted) {
        const permission = await requestPermission();
        permissionGranted = permission === 'granted';
      }
      if (permissionGranted) {
        sendNotification({ title: 'ValencyStudio - Spoofer', body: msg });
      } else {
        logValencyStudio('success', msg, true);
      }
    } catch (e) {
      logValencyStudio('success', msg, true);
    }
  };

  return (
    <div className="w-full h-full overflow-y-auto overflow-x-hidden">
      <div className="w-full h-full p-4 lg:p-8">
        {config.accounts.length === 0 && discoveredUsers.length > 0 ? (
          <div className="w-full max-w-4xl mx-auto flex flex-col gap-6 pb-12">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">{t('accounts.description')}</p>
              <div className="flex gap-2">
                <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                  <DialogTrigger render={<Button />}>
                    <Plus size={16} className="mr-2" />
                    {t('accounts.addAccount')}
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{t('accounts.addAccountTitle')}</DialogTitle>
                    </DialogHeader>
                    <AddAccountForm
                      newCookie={newCookie}
                      setNewCookie={setNewCookie}
                      newApiKey={newApiKey}
                      setNewApiKey={setNewApiKey}
                      isDownloader={isDownloader}
                      setIsDownloader={setIsDownloader}
                      isUploader={isUploader}
                      setIsUploader={setIsUploader}
                      isAdding={isAdding}
                      onSubmit={() => void handleAddAccount()}
                      onCancel={() => setIsAddOpen(false)}
                    />
                  </DialogContent>
                </Dialog>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <p className="text-2xs font-bold uppercase tracking-widest text-text-muted px-1">
                Discovered Accounts
              </p>
              {discoveredUsers.map((user) => (
                <div
                  key={user.id}
                  className="flex items-center gap-3 rounded-lg border border-border-subtle bg-bg-base p-3"
                >
                  {user.avatarUrl ? (
                    <img
                      src={user.avatarUrl}
                      alt=""
                      className="w-10 h-10 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-bg-surface flex items-center justify-center">
                      <User2 size={20} className="text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-semibold text-foreground block truncate">
                      {user.displayName || user.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      ID: {user.id} · Auto-detected
                    </span>
                  </div>
                  <span className="text-2xs text-primary bg-primary/10 px-2 py-1 rounded-full font-semibold shrink-0">
                    Discovered
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : config.accounts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[calc(100vh-140px)] text-center text-muted-foreground space-y-4">
            <User2 size={48} className="opacity-20 text-primary" />
            <div className="space-y-1">
              <p className="text-base font-semibold text-foreground">
                {t('accounts.noAccounts') ?? 'No Accounts Configured'}
              </p>
              <p className="text-xs text-muted-foreground max-w-sm">{t('accounts.description')}</p>
            </div>
            <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
              <DialogTrigger render={<Button size="sm" className="font-semibold" />}>
                <Plus size={16} className="mr-2" />
                {t('accounts.addAccount')}
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('accounts.addAccountTitle')}</DialogTitle>
                </DialogHeader>
                <AddAccountForm
                  newCookie={newCookie}
                  setNewCookie={setNewCookie}
                  newApiKey={newApiKey}
                  setNewApiKey={setNewApiKey}
                  isDownloader={isDownloader}
                  setIsDownloader={setIsDownloader}
                  isUploader={isUploader}
                  setIsUploader={setIsUploader}
                  isAdding={isAdding}
                  onSubmit={() => void handleAddAccount()}
                  onCancel={() => setIsAddOpen(false)}
                />
              </DialogContent>
            </Dialog>
          </div>
        ) : (
          <div className="w-full max-w-4xl mx-auto flex flex-col gap-6 pb-12">
            <div className="flex items-center justify-between">
              <p className="text-xs text-text-secondary">{t('accounts.description')}</p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs font-semibold"
                  disabled={isValidatingAll || config.accounts.length === 0}
                  onClick={() => void handleValidateAll()}
                >
                  <RefreshCw
                    size={13}
                    className={`mr-1.5 ${isValidatingAll ? 'animate-spin' : ''}`}
                  />
                  {t('accounts.validateAll')}
                </Button>

                <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                  <DialogTrigger
                    render={<Button size="sm" className="h-8 text-xs font-semibold" />}
                  >
                    <Plus size={14} className="mr-1.5" />
                    {t('accounts.addAccount')}
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{t('accounts.addAccountTitle')}</DialogTitle>
                    </DialogHeader>
                    <AddAccountForm
                      newCookie={newCookie}
                      setNewCookie={setNewCookie}
                      newApiKey={newApiKey}
                      setNewApiKey={setNewApiKey}
                      isDownloader={isDownloader}
                      setIsDownloader={setIsDownloader}
                      isUploader={isUploader}
                      setIsUploader={setIsUploader}
                      isAdding={isAdding}
                      onSubmit={() => void handleAddAccount()}
                      onCancel={() => setIsAddOpen(false)}
                    />
                  </DialogContent>
                </Dialog>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {config.accounts?.map((acc) => {
                const secrets = accountSecrets[acc.id];
                const isSelected = config.spoofing.selectedUser === acc.id;
                return (
                  <Card
                    key={acc.id}
                    className={`p-4 flex flex-col gap-4 transition-colors ${isSelected ? 'border-primary/60 bg-primary/5' : ''}`}
                  >
                    <div className="flex items-start gap-4">
                      <div className="relative">
                        {acc.avatarUrl ? (
                          <img
                            src={acc.avatarUrl}
                            alt="Avatar"
                            className="w-12 h-12 rounded-full bg-secondary object-cover"
                          />
                        ) : (
                          <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center text-lg font-bold">
                            {acc.name.charAt(0)}
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold truncate flex items-center gap-1.5">
                          {acc.name}
                          {(acc.cookieValidated === true || acc.apiKeyValidated === true) && (
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <span className="inline-flex">
                                    <CheckCircle2 size={14} className="text-signal-live" />
                                  </span>
                                }
                              />
                              <TooltipContent>{t('accounts.validated')}</TooltipContent>
                            </Tooltip>
                          )}
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          {t('accounts.id')}: {acc.id}
                        </p>
                      </div>
                      <Button
                        variant={isSelected ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => handleSelectAccount(acc)}
                      >
                        {isSelected ? t('accounts.selected') : t('accounts.select')}
                      </Button>
                      <Button
                        aria-label={t('accounts.deleteAccount')}
                        variant="ghost"
                        size="icon"
                        className="text-danger hover:bg-danger/10 hover:text-danger"
                        onClick={() => handleRemoveAccount(acc.id)}
                      >
                        <Trash2 size={16} />
                      </Button>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {acc.isDownloader && (
                        <div className="flex items-center gap-1.5 text-sm px-2 py-1 rounded-md w-fit bg-signal-live/10">
                          <Cookie size={13} className="text-signal-live" />
                          <span className="text-signal-live">{t('accounts.downloader')}</span>
                          {secrets?.cookie && acc.cookieValidated === true && (
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <span className="inline-flex">
                                    <CheckCircle2 size={13} className="text-signal-live" />
                                  </span>
                                }
                              />
                              <TooltipContent>{t('accounts.cookieValid')}</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      )}
                      {acc.isUploader && (
                        <div className="flex items-center gap-1.5 text-sm px-2 py-1 rounded-md w-fit bg-signal-info/10">
                          <Key size={13} className="text-signal-info" />
                          <span className="text-signal-info">{t('accounts.uploader')}</span>
                          {secrets?.apiKey && acc.apiKeyValidated === true && (
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <span className="inline-flex">
                                    <CheckCircle2 size={13} className="text-signal-info" />
                                  </span>
                                }
                              />
                              <TooltipContent>{t('accounts.apiKeyValid')}</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      )}
                      {}
                      {secretsLoaded && !secrets?.cookie && acc.isDownloader && (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <div className="text-xs text-danger flex items-center gap-1">
                                <ShieldAlert size={12} /> Missing cookie
                              </div>
                            }
                          />
                          <TooltipContent>{t('accounts.missingCookie')}</TooltipContent>
                        </Tooltip>
                      )}
                      {secretsLoaded && !secrets?.apiKey && acc.isUploader && (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <div className="text-xs text-signal-warn flex items-center gap-1">
                                <ShieldAlert size={12} /> Missing API key
                              </div>
                            }
                          />
                          <TooltipContent>{t('accounts.missingApiKey')}</TooltipContent>
                        </Tooltip>
                      )}
                      {secretsLoaded &&
                        acc.isDownloader &&
                        secrets?.cookie &&
                        acc.cookieValidated === false && (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <div className="text-xs text-danger flex items-center gap-1">
                                  <ShieldAlert size={12} /> Cookie rejected by Roblox
                                </div>
                              }
                            />
                            <TooltipContent>{t('accounts.cookieRejected')}</TooltipContent>
                          </Tooltip>
                        )}
                      {secretsLoaded &&
                        acc.isUploader &&
                        secrets?.apiKey &&
                        acc.apiKeyValidated === false && (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <div className="text-xs text-signal-warn flex items-center gap-1">
                                  <ShieldAlert size={12} /> API key rejected by Roblox
                                </div>
                              }
                            />
                            <TooltipContent>{t('accounts.apiKeyRejected')}</TooltipContent>
                          </Tooltip>
                        )}
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
