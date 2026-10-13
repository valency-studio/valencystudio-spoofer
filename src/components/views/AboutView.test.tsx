import { invoke } from '@tauri-apps/api/core';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as LanguageContext from '../../contexts/LanguageContext';
import AboutView from './AboutView';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('../../contexts/LanguageContext', () => ({
  useLanguage: vi.fn(),
}));

vi.mock('../../utils/tauriRuntime', () => ({
  isTauriRuntime: () => true,
}));

describe('AboutView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Keys render as their own path, which is what the view is asserted against.
    vi.mocked(LanguageContext.useLanguage).mockReturnValue({
      t: (key: string) => key,
    } as never);
  });

  it('shows the app name and the version reported by the backend', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'get_app_version') return '3.0.2';
      if (cmd === 'get_runtime_info') {
        return { appVersion: '3.0.2', platform: 'windows', arch: 'x86_64', runtime: 'tauri' };
      }
      return null;
    });

    render(<AboutView />);

    expect(await screen.findByText('v3.0.2')).toBeInTheDocument();
    expect(screen.getByText('about.version')).toBeInTheDocument();
    expect(screen.getByText('windows')).toBeInTheDocument();
    expect(screen.getByText('x86_64')).toBeInTheDocument();
  });

  it('renders a dash when the backend cannot report a value', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('nope'));

    render(<AboutView />);

    // Nothing crashes and no field is silently missing.
    expect(await screen.findByText('about.title')).toBeInTheDocument();
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThan(0);
  });
});
