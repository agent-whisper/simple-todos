import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library only auto-cleans when vitest runs with globals:true. This
// project does not, so unmount explicitly — otherwise every render stacks and
// queries find duplicates from earlier tests.
afterEach(cleanup);

// jsdom keeps one localStorage for the whole file, so anything a test stores —
// a token, a collapsed section — would leak into the next and make the suite
// order-dependent. Persistence within a test still works; only the boundary is
// swept.
afterEach(() => {
  try {
    localStorage.clear();
  } catch {
    // Nothing stored, nothing to clear.
  }
});

// jsdom does not implement HTMLDialogElement's modal methods. The app uses a
// native <dialog> deliberately — the browser gives focus trapping, Escape, and
// an inert background that a hand-rolled overlay usually gets wrong — so this
// stands in for them here rather than the app avoiding the element.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
}
