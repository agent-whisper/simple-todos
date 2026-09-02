import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library only auto-cleans when vitest runs with globals:true. This
// project does not, so unmount explicitly — otherwise every render stacks and
// queries find duplicates from earlier tests.
afterEach(cleanup);
