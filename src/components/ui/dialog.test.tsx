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
