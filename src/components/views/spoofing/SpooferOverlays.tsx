import { useLanguage } from '../../../contexts/LanguageContext';
import type { SpooferController } from '../../../hooks/useSpooferController';
import PasteIdsModal from '../../modals/PasteIdsModal';
import ResultsModal from '../../modals/ResultsModal';
import ScanOptionsModal from '../../modals/ScanOptionsModal';
import { Button } from '../../ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../ui/dialog';

/**
 * Everything the headless spoofer controller needs to surface: the modals opened
 * by `ValencyStudio-*` document events and the audio-quota confirmation.
 *
 * Rendered from the app root next to `useSpooferController()`.
 */
export function SpooferOverlays({ controller }: { controller: SpooferController }) {
  const { t } = useLanguage();
  const { pendingQuotaRun } = controller;

  return (
    <>
      <ResultsModal
        isOpen={controller.resultsModalOpen}
        onClose={controller.closeResultsModal}
        onRetryFailed={() => void controller.retryFailedAssets()}
      />
      <PasteIdsModal open={controller.pasteIdsOpen} onOpenChange={controller.setPasteIdsOpen} />
      <ScanOptionsModal
        open={controller.scanOptionsOpen}
        onOpenChange={controller.setScanOptionsOpen}
        onScanStart={(opts) => controller.scanStudio(opts)}
      />

      <Dialog
        open={Boolean(pendingQuotaRun)}
        onOpenChange={(open) => !open && controller.cancelPendingQuotaRun()}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('misc.audioQuotaExceeded')}</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <div className="text-sm text-text-secondary">
              {t('spoof.audioQuotaWarning')
                .replace('{audioCount}', (pendingQuotaRun?.audioCount ?? 0).toString())
                .replace('{remaining}', (pendingQuotaRun?.remaining ?? 0).toString())}
            </div>
          </div>
          <DialogFooter className="flex justify-end gap-2 sm:justify-end">
            <Button variant="outline" onClick={controller.cancelPendingQuotaRun}>
              {t('common.cancel')}
            </Button>
            <Button variant="default" onClick={controller.continuePendingQuotaRun}>
              {t('spoof.continueAnyway')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
