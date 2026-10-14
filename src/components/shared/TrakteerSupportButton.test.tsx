import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TrakteerSupportButton } from './TrakteerSupportButton';

const SCRIPT_SRC = 'https://edge-cdn.trakteer.id/js/trbtn-overlay.min.js?v=14-05-2025';

describe('TrakteerSupportButton', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.getElementById('trakteer-overlay-script')?.remove();
    delete window.trbtnOverlay;
  });

  it('injects the vendor script into the document', () => {
    render(<TrakteerSupportButton />);

    const script = document.getElementById('trakteer-overlay-script');
    expect(script).not.toBeNull();
    expect(script?.getAttribute('src')).toBe(SCRIPT_SRC);
  });

  it('does not inject the script twice', () => {
    render(<TrakteerSupportButton />);
    render(<TrakteerSupportButton />);

    expect(document.querySelectorAll('#trakteer-overlay-script')).toHaveLength(1);
  });

  it('draws the button once the vendor script reports it loaded', () => {
    const init = vi.fn().mockReturnValue('trbtn-1');
    const draw = vi.fn();
    window.trbtnOverlay = { init, draw };

    render(<TrakteerSupportButton />);

    document.getElementById('trakteer-overlay-script')?.dispatchEvent(new Event('load'));

    expect(init).toHaveBeenCalledWith(
      'Dukung Saya di Trakteer',
      '#be1e2d',
      'https://trakteer.id/v1/valencystudio/tip/embed/modal',
      'https://cdn.trakteer.id/images/mix/coffee.png',
      '40',
      'inline',
    );
    expect(draw).toHaveBeenCalledWith('trbtn-1');
  });

  it('survives a vendor script that fails to load', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    window.trbtnOverlay = undefined;

    expect(() => {
      render(<TrakteerSupportButton />);
      document.getElementById('trakteer-overlay-script')?.dispatchEvent(new Event('error'));
    }).not.toThrow();

    expect(warn).toHaveBeenCalled();
  });
});
