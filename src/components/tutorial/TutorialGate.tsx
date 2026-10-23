import { useCallback, useEffect, useMemo, useState } from 'react';

import { useConfig } from '../../contexts/ConfigContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { useSpooferStore } from '../../stores/spooferStore';
import { loadCachedUsers } from '../../utils/robloxProfiles';
import { Tutorial, TutorialStep } from './Tutorial';

const hasAnyAccount = (config: ReturnType<typeof useConfig>['config']): boolean => {
  if (config.accounts.length > 0) return true;
  if (config.spoofing.selectedUser !== 'none') return true;
  if (config.spoofing.cookie.trim().length >= 50) return true;
  try {
    const cached = loadCachedUsers();
    if (cached.length > 0) return true;
  } catch {}
  return false;
};

export const TutorialGate = () => {
  const { config, updateConfig } = useConfig();
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const rootInstances = useSpooferStore((s) => s.rootInstances);
  const selectedAssetIds = useSpooferStore((s) => s.selectedAssetIds);

  useEffect(() => {
    if (!config.ui.tutorialCompleted) {
      const t = setTimeout(() => setOpen(true), 600);
      return () => clearTimeout(t);
    }
  }, [config.ui.tutorialCompleted]);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('ValencyStudio-start-tutorial', handler);
    return () => window.removeEventListener('ValencyStudio-start-tutorial', handler);
  }, []);

  const handleComplete = useCallback(() => {
    setOpen(false);
    updateConfig('ui', 'tutorialCompleted', true);

    updateConfig('ui', 'activeTab', 'spoofing');
  }, [updateConfig]);

  const steps: TutorialStep[] = useMemo(
    () => [
      {
        id: 'welcome',
        title: t('misc.tutorialStep1Title'),
        body: t('misc.tutorialStep1Body'),
      },
      {
        id: 'accounts',
        title: t('misc.tutorialStep2Title'),
        body: t('misc.tutorialStep2Body'),
        isComplete: () => hasAnyAccount(config),
        waitingHint: t('misc.tutorialStep2Hint'),
      },
      {
        id: 'api-key',
        title: t('misc.tutorialStep3Title'),
        body: t('misc.tutorialStep3Body'),
        isComplete: () => config.spoofing.apiKey.trim().length >= 20,
        waitingHint: t('misc.tutorialStep3Hint'),
      },
      {
        id: 'scan-studio',
        title: t('misc.tutorialStep4Title'),
        body: t('misc.tutorialStep4Body'),
        isComplete: () => {
          if (rootInstances.length === 0) return false;
          const hasAssets = (list: typeof rootInstances): boolean => {
            for (const n of list) {
              if (n.assets.length > 0) return true;
              if (hasAssets(n.children)) return true;
            }
            return false;
          };
          return hasAssets(rootInstances);
        },
        waitingHint: t('misc.tutorialStep4Hint'),
      },
      {
        id: 'select',
        title: t('misc.tutorialStep5Title'),
        body: t('misc.tutorialStep5Body'),
        isComplete: () => selectedAssetIds.size > 0,
        waitingHint: t('misc.tutorialStep5Hint'),
      },
      {
        id: 'run',
        title: t('misc.tutorialStep6Title'),
        body: t('misc.tutorialStep6Body'),
      },
    ],
    [
      config.accounts.length,
      config.spoofing.selectedUser,
      config.spoofing.apiKey,
      rootInstances,
      selectedAssetIds.size,
      t,
    ],
  );

  if (!open) return null;

  const beforeStep = (nextId: string | null) => {
    const targetTab: Record<string, 'accounts' | 'settings' | 'spoofing'> = {
      accounts: 'accounts',
      'api-key': 'settings',
      'scan-studio': 'spoofing',
      select: 'spoofing',
      run: 'spoofing',
    };
    const tab = nextId ? targetTab[nextId] : undefined;
    if (!tab) return;
    updateConfig('ui', 'activeTab', tab);
  };

  return (
    <Tutorial
      steps={steps}
      onComplete={handleComplete}
      onSkip={handleComplete}
      beforeStep={beforeStep}
    />
  );
};
