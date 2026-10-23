import { invoke } from '@tauri-apps/api/core';
import { relaunch } from '@tauri-apps/plugin-process';
import { check } from '@tauri-apps/plugin-updater';

async function runSplashFlow() {
  const statusText = document.getElementById('status-text');

  if (statusText) {
    statusText.innerText = 'Checking for updates...';
  }

  let update: Awaited<ReturnType<typeof check>> | null = null;

  try {
    update = await Promise.race([
      check(),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('Updater check timed out')), 10000),
      ),
    ]);
  } catch (err) {
    console.error('Failed to check for updates:', err);
  }

  if (update?.available === true) {
    console.log(`Update available: ${update.version}`);
    if (statusText) {
      statusText.innerText = `Update v${update.version} is available`;
    }

    const spinner = document.getElementById('spinner');
    const updateActions = document.getElementById('update-actions');
    const btnSkip = document.getElementById('btn-skip');
    const btnDownload = document.getElementById('btn-download');

    if (spinner && updateActions && btnSkip && btnDownload) {
      spinner.classList.add('hidden');
      updateActions.classList.remove('hidden');
      updateActions.classList.add('flex');

      btnSkip.classList.remove('drag-region');
      btnDownload.classList.remove('drag-region');

      const userChoice = await new Promise<'download' | 'skip'>((resolve) => {
        // Auto-skip if the user never chooses, so boot can never hang here.
        const fallback = setTimeout(() => resolve('skip'), 120_000);
        btnSkip.onclick = () => {
          clearTimeout(fallback);
          resolve('skip');
        };
        btnDownload.onclick = () => {
          clearTimeout(fallback);
          resolve('download');
        };
      });

      updateActions.classList.add('hidden');
      updateActions.classList.remove('flex');

      if (userChoice === 'download') {
        spinner.classList.remove('hidden');
        if (statusText) {
          statusText.innerText = `Downloading update v${update.version}...`;
        }
        let downloaded = 0;
        let contentLength = 0;
        await update.downloadAndInstall((event) => {
          switch (event.event) {
            case 'Started':
              contentLength = event.data.contentLength || 0;
              console.log(`Started downloading ${event.data.contentLength} bytes`);
              break;
            case 'Progress':
              downloaded += event.data.chunkLength;
              if (statusText && contentLength > 0) {
                const percent = Math.round((downloaded / contentLength) * 100);
                statusText.innerText = `Downloading app & plugin bundle: ${percent}%`;
              }
              break;
            case 'Finished':
              console.log('Download finished');
              break;
          }
        });

        console.log('Update installed, restarting...');
        if (statusText) {
          statusText.innerText = 'Restarting to apply update...';
        }
        await relaunch();
        return;
      } else {
        spinner.classList.remove('hidden');
      }
    }
  }

  if (statusText) {
    statusText.innerText = 'Installing plugin to Roblox...';
  }

  try {
    await invoke('sync_roblox_plugin');
  } catch (err) {
    console.error('Failed to sync Roblox plugin:', err);
  }

  // Installs yt-dlp when it is missing so the Music view is ready on first
  // paint. Failure is non-fatal: the Music view reports what is unavailable and
  // offers a retry, so a failed download never blocks boot.
  if (statusText) {
    statusText.innerText = 'Preparing media tools...';
  }

  let mediaFailed: boolean;
  let mediaTimer: ReturnType<typeof setTimeout> | undefined;

  try {
    // Capped so a stalled download cannot hold the splash open forever; the
    // Music view's retry is the recovery path. 120 s covers a slow first-run
    // download of the release asset.
    const result = await Promise.race([
      invoke<{ tools: { ytdlp: boolean }; ytdlpInstalled: boolean }>('ensure_media_tools'),
      new Promise<null>((_, reject) => {
        mediaTimer = setTimeout(() => reject(new Error('Media tool setup timed out')), 120_000);
      }),
    ]);

    if (result?.ytdlpInstalled) {
      console.log('Installed yt-dlp for the Music editor.');
    }
    mediaFailed = !!result && !result.tools.ytdlp;
    if (mediaFailed) {
      console.warn('yt-dlp is unavailable; importing from a link will be disabled.');
    }
  } catch (err) {
    mediaFailed = true;
    console.error('Failed to prepare media tools:', err);
  } finally {
    // Left running otherwise, the losing branch rejects with nobody listening.
    clearTimeout(mediaTimer);
  }

  // The failure text stays on screen instead of being replaced by "Starting...",
  // which would hide the only signal that the Music view needs a retry.
  if (statusText && !mediaFailed) {
    statusText.innerText = 'Starting...';
  } else if (statusText) {
    statusText.innerText = 'yt-dlp could not be installed. Retry from the Music view.';
    // Held briefly so the message can be read before the window disappears.
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  try {
    await invoke('close_splashscreen');
  } catch (err) {
    console.error('Failed to close splashscreen:', err);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  void runSplashFlow();
});
