import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library only auto-cleans when vitest runs with globals:true. This
// project does not, so unmount explicitly — otherwise every render stacks and
// queries find duplicates from earlier tests.
afterEach(cleanup);

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
