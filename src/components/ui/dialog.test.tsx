import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Dialog, DialogContent, DialogTitle } from './dialog';

const renderDialog = (className?: string) =>
  render(
    <Dialog open>
      <DialogContent className={className} showCloseButton={false}>
        <DialogTitle>Title</DialogTitle>
      </DialogContent>
    </Dialog>,
  );

describe('DialogContent width', () => {
  it('lets the caller replace the default width at every breakpoint', () => {
    // A responsive default (`sm:max-w-sm`) is a different Tailwind-merge group
    // from `max-w-lg`, so both survived and the default won above 640px, which
    // pinned every dialog to 384px.
    renderDialog('max-w-2xl');

    const panel = screen.getByRole('dialog');
    expect(panel.className).toContain('max-w-2xl');
    expect(panel.className).not.toContain('sm:max-w-');
  });

  it('keeps a default width when the caller does not pass one', () => {
    renderDialog();

    expect(screen.getByRole('dialog').className).toMatch(/max-w-\[/);
  });
});

describe('DialogContent height', () => {
  it('clamps the panel and scrolls instead of running off the viewport', () => {
    // Without the clamp a tall body (installer log, long form) grows past both
    // edges: the top overlaps the titlebar and the footer lands off-screen.
    renderDialog();

    const panel = screen.getByRole('dialog');
    expect(panel.className).toContain('max-h-[calc(100dvh-2rem)]');
    expect(panel.className).toContain('overflow-y-auto');
  });

  it('keeps the gutter even when the caller widens the panel', () => {
    // The gutter lives in `w-[calc(100%-2rem)]`, not in the `max-w-*` the
    // caller overwrites, so a wide dialog still stops short of the edge.
    renderDialog('max-w-2xl');

    expect(screen.getByRole('dialog').className).toContain('w-[calc(100%-2rem)]');
  });

  it('lets a caller replace the clamp', () => {
    renderDialog('max-h-[85vh] overflow-hidden');

    const panel = screen.getByRole('dialog');
    expect(panel.className).toContain('max-h-[85vh]');
    expect(panel.className).not.toContain('max-h-[calc(100dvh-2rem)]');
    expect(panel.className).toContain('overflow-hidden');
  });
});
