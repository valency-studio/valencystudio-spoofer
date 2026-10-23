import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  CheckCircle2,
  Clock,
  FileText,
  Play,
  RotateCcw,
  Trash2,
  User2,
  XCircle,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { useConfig } from '../../contexts/ConfigContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { queueSpoofRetry, type SpoofJob } from '../../utils/jobTypes';
import { deleteUploadRecord, getUploadHistory, type UploadRecord } from '../../utils/music';
import { logValencyStudio } from '../../utils/robloxProfiles';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../ui/accordion';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { HistoryRow } from './music/MusicView';

export default function ActivityView() {
  const { t } = useLanguage();

  const { updateConfig } = useConfig();
  const [jobs, setJobs] = useState<SpoofJob[]>([]);
  const [musicHistory, setMusicHistory] = useState<UploadRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchJobs = async () => {
    try {
      const data = await invoke<SpoofJob[]>('get_jobs');
      const finalJobs = data ? [...data] : [];

      setJobs(finalJobs);
    } catch (e) {
      logValencyStudio('error', `Failed to load job history: ${e}`, true);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchMusicHistory = async () => {
    try {
      setMusicHistory(await getUploadHistory());
    } catch (e) {
      logValencyStudio('error', `Failed to load music upload history: ${e}`, true);
    }
  };

  useEffect(() => {
    fetchJobs();
    fetchMusicHistory();
    // Music uploads resolve in the background, so the section stays live
    // without a manual refresh, mirroring the Music view's own listener.
    const stopListening = listen<UploadRecord>('music-upload-status', (event) => {
      const record = event.payload;
      setMusicHistory((previous) => [
        record,
        ...previous.filter((existing) => existing.id !== record.id),
      ]);
    });
    return () => {
      stopListening.then((stop) => stop()).catch(() => {});
    };
  }, []);

  const handleDeleteMusicRecord = async (id: string) => {
    try {
      await deleteUploadRecord(id);
      setMusicHistory((previous) => previous.filter((record) => record.id !== id));
    } catch (error) {
      logValencyStudio('error', `Could not delete music upload record: ${error}`, true);
    }
  };

  const handleDelete = async (jobId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await invoke('delete_job', { jobId });
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
    } catch (error) {
      logValencyStudio('error', `Could not delete job: ${error}`, true);
    }
  };

  const handleOpenLog = async (logPath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await invoke('open_job_log', { logPath });
    } catch (error) {
      logValencyStudio('error', `Could not open log: ${error}`, true);
    }
  };

  const handleRedoJob = (job: SpoofJob, e: React.MouseEvent) => {
    e.stopPropagation();
    const assetIds = job.assetResults.map((r) => r.id);
    queueSpoofRetry({
      jobId: job.id,
      assetIds,
      selectedUserId: job.account?.id,
      selectedGroupId: job.config?.groupId ?? undefined,
      spoofSounds: job.config?.spoofSounds,
      uploadTypes: job.config?.uploadTypes,
      account: job.account,
      group: job.group,
    });
    updateConfig('ui', 'activeTab', 'spoofing');
  };

  const handleRetryFailed = (job: SpoofJob, e: React.MouseEvent) => {
    e.stopPropagation();
    const failedIds = job.assetResults.filter((r) => !r.success && !r.skipped).map((r) => r.id);
    if (failedIds.length === 0) return;
    queueSpoofRetry({
      jobId: job.id,
      assetIds: failedIds,
      selectedUserId: job.account?.id,
      selectedGroupId: job.config?.groupId ?? undefined,
      spoofSounds: job.config?.spoofSounds,
      uploadTypes: job.config?.uploadTypes,
      account: job.account,
      group: job.group,
    });
    updateConfig('ui', 'activeTab', 'spoofing');
  };

  return (
    <div className="w-full h-full">
      <div className="w-full h-full flex flex-col">
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-6">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <span className="text-muted-foreground">{t('misc.loadingHistory')}</span>
            </div>
          ) : jobs.length === 0 && musicHistory.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground space-y-3">
              <Clock size={48} className="opacity-20" />
              <p>{t('misc.noJobHistory')}</p>
              <p className="text-sm opacity-70">{t('misc.jobsWillAppear')}</p>
            </div>
          ) : (
            <div className="space-y-8 pb-8 w-full">
              {jobs.length > 0 && (
                <Accordion className="space-y-4 w-full">
                  {jobs.map((job) => {
                    const totalAssets = job.assetResults?.length || 0;
                    const failedAssets =
                      job.assetResults?.filter((r) => !r.success && !r.skipped).length || 0;

                    const dateStr = new Date(job.startTime).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    });

                    return (
                      <AccordionItem
                        key={job.id}
                        value={job.id}
                        className="bg-bg-surface/40 border border-border-subtle shadow-xs rounded-xl overflow-hidden mb-3"
                      >
                        <AccordionTrigger className="hover:no-underline py-2.5 pr-3 pl-2 data-[state=open]:border-b data-[state=open]:border-border-subtle/30">
                          <div className="flex items-center justify-between w-full">
                            <div className="flex items-center gap-3">
                              <div className="relative w-9 h-9 shrink-0">
                                {job.account?.avatarUrl ? (
                                  <img
                                    src={job.account.avatarUrl}
                                    alt=""
                                    className="w-9 h-9 rounded-full border border-border-subtle object-cover bg-bg-base shadow-xs"
                                  />
                                ) : (
                                  <div className="w-9 h-9 rounded-full border border-border-subtle bg-bg-base flex items-center justify-center shadow-xs">
                                    <User2 size={16} className="text-muted-foreground" />
                                  </div>
                                )}
                                {job.group?.iconUrl && (
                                  <img
                                    src={job.group.iconUrl}
                                    alt=""
                                    className="w-4.5 h-4.5 rounded-full border-[2px] border-bg-base absolute -bottom-0.5 -right-0.5 object-cover bg-bg-base shadow-xs"
                                  />
                                )}
                              </div>
                              <div className="flex flex-col items-start gap-0.5">
                                <span className="text-xs font-bold text-text-primary tracking-tight text-left">
                                  {job.group
                                    ? t('activity.spoofedTo').replace('{name}', job.group.name)
                                    : t('activity.spoofedTo').replace(
                                        '{name}',
                                        job.account?.name || t('common.unknown'),
                                      )}
                                </span>
                                <span className="text-2xs text-text-muted flex items-center gap-2">
                                  {dateStr}
                                  <span className="w-1 h-1 rounded-full bg-border" />
                                  <span className="font-medium">
                                    {t('activity.assetCount').replace(
                                      '{count}',
                                      totalAssets.toString(),
                                    )}
                                  </span>
                                </span>
                              </div>
                            </div>
                          </div>
                        </AccordionTrigger>

                        <AccordionContent className="p-0">
                          <div className="px-4 pb-3.5 pt-2.5 bg-bg-base/20">
                            <div className="flex flex-wrap items-center gap-4 mb-3 px-1">
                              <button
                                type="button"
                                onClick={(e) => handleRedoJob(job, e)}
                                className="flex items-center text-xs font-semibold text-text-muted hover:text-primary transition-colors cursor-pointer"
                              >
                                <Play size={12} className="mr-1.5" />
                                {t('activity.redoJob')}
                              </button>
                              {failedAssets > 0 && (
                                <button
                                  type="button"
                                  onClick={(e) => handleRetryFailed(job, e)}
                                  className="flex items-center text-xs font-semibold text-text-muted hover:text-signal-warn transition-colors cursor-pointer"
                                >
                                  <RotateCcw size={12} className="mr-1.5" />
                                  {t('activity.retryFailed').replace(
                                    '{count}',
                                    failedAssets.toString(),
                                  )}
                                </button>
                              )}
                              {job.logFilePath && (
                                <button
                                  type="button"
                                  onClick={(e) => handleOpenLog(job.logFilePath!, e)}
                                  className="flex items-center text-xs font-semibold text-text-muted hover:text-text-primary transition-colors cursor-pointer"
                                >
                                  <FileText size={12} className="mr-1.5" />
                                  {t('activity.viewLog')}
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={(e) => handleDelete(job.id, e)}
                                className="flex items-center text-xs font-semibold text-text-muted hover:text-destructive transition-colors ml-auto cursor-pointer"
                              >
                                <Trash2 size={12} className="mr-1.5" />
                                {t('common.delete')}
                              </button>
                            </div>

                            <div className="space-y-1 max-h-72 overflow-y-auto pr-1 rounded-lg border border-border-subtle/50 p-2 bg-bg-base/50">
                              {job.assetResults?.map((res, i) => (
                                <div
                                  key={i}
                                  className="flex items-center justify-between p-1.5 rounded-md hover:bg-bg-elevated/40 text-2xs transition-colors"
                                >
                                  <div className="flex items-center gap-3 overflow-hidden">
                                    {res.success ? (
                                      <CheckCircle2
                                        size={14}
                                        className="text-signal-live shrink-0"
                                      />
                                    ) : res.skipped ? (
                                      <div className="w-3.5 h-3.5 rounded-full border border-signal-warn/50 flex items-center justify-center shrink-0">
                                        <div className="w-1.5 h-0.5 bg-signal-warn/50 rounded-full" />
                                      </div>
                                    ) : (
                                      <XCircle size={14} className="text-destructive shrink-0" />
                                    )}
                                    <span className="font-mono text-muted-foreground min-w-[120px] shrink-0">
                                      {res.id}
                                    </span>
                                    <span className="truncate text-foreground max-w-50">
                                      {res.name || t('activity.unknownAsset')}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-3">
                                    {res.newId && (
                                      <span className="font-mono text-signal-live">
                                        &rarr; {res.newId}
                                      </span>
                                    )}
                                    {res.errorReason && (
                                      <Tooltip>
                                        <TooltipTrigger
                                          render={
                                            <span className="text-destructive max-w-50 truncate">
                                              {res.errorReason}
                                            </span>
                                          }
                                        />
                                        <TooltipContent className="max-w-xs break-words">
                                          {res.errorReason}
                                        </TooltipContent>
                                      </Tooltip>
                                    )}
                                    {res.reason && res.skipped && (
                                      <span className="text-signal-warn/80 max-w-50 truncate">
                                        {res.reason}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                </Accordion>
              )}

              {musicHistory.length > 0 && (
                <section>
                  <div className="flex items-baseline justify-between mb-3">
                    <h2 className="text-sm font-semibold text-text-primary">
                      {t('music.history')}
                    </h2>
                    <span className="text-xs text-text-muted tabular-nums">
                      {t('music.historyCount').replace('{count}', String(musicHistory.length))}
                    </span>
                  </div>
                  <ul className="flex flex-col gap-2">
                    {musicHistory.map((record) => (
                      <HistoryRow
                        key={record.id}
                        record={record}
                        onDelete={(id) => void handleDeleteMusicRecord(id)}
                      />
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
