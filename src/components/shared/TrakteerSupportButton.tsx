import { useEffect } from 'react';

/** Trakteer's overlay assets and page. */
const SCRIPT_SRC = 'https://edge-cdn.trakteer.id/js/trbtn-overlay.min.js?v=14-05-2025';
const ICON_SRC = 'https://cdn.trakteer.id/images/mix/coffee.png';
const MODAL_URL = 'https://trakteer.id/v1/valencystudio/tip/embed/modal';
const ACCENT = '#be1e2d';
const SIZE = '40';
const POSITION = 'inline';

const SCRIPT_ID = 'trakteer-overlay-script';
const BOOTSTRAP_ID = 'trakteer-overlay-bootstrap';

declare global {
  interface Window {
    trbtnOverlay?: {
      init: (
        title: string,
        color: string,
        modalUrl: string,
        iconUrl: string,
        size: string,
        position: string,
      ) => string;
      draw: (id: string) => void;
    };
  }
}

/**
 * Mounts Trakteer's floating support button.
 *
 * The widget is a third-party script, so it is injected the same way a browser
 * tag would: a `<script>` element appended to `<body>`. JSX cannot render a
 * script that actually executes, and the CSP in `tauri.conf.json` allows
 * `edge-cdn.trakteer.id` for exactly this file.
 *
 * Loading is failure-tolerant: no support button, no crash. The script is
 * reused across mounts so a tab switch cannot load it twice.
 */
export function TrakteerSupportButton() {
  useEffect(() => {
    if (document.getElementById(SCRIPT_ID)) return;

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => {
      const overlay = window.trbtnOverlay;
      if (!overlay) return;

      const id = overlay.init(
        'Dukung Saya di Trakteer',
        ACCENT,
        MODAL_URL,
        ICON_SRC,
        SIZE,
        POSITION,
      );
      overlay.draw(id);

      // The bootstrap tag is what the vendor snippet ships; keep it out of the
      // document once the button is drawn so nothing re-initialises it.
      document.getElementById(BOOTSTRAP_ID)?.remove();
    };
    script.onerror = () => {
      console.warn('[ValencyStudio - Spoofer] Could not load the Trakteer support button.');
    };

    document.body.appendChild(script);
  }, []);

  return null;
}
