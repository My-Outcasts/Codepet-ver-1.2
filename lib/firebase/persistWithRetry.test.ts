import { describe, it, expect, vi } from 'vitest';
import { persistWithRetry } from './persistWithRetry';

const opts = (toast: (m: string) => void, extra = {}) => ({
  toast,
  failMessage: 'could not save',
  label: 'test',
  baseDelayMs: 0, // no real wait in tests
  ...extra,
});

describe('persistWithRetry', () => {
  it('succeeds on the first try → write once, no toast', async () => {
    const toast = vi.fn();
    const write = vi.fn().mockResolvedValue(undefined);
    await persistWithRetry(write, opts(toast));
    expect(write).toHaveBeenCalledTimes(1);
    expect(toast).not.toHaveBeenCalled();
  });

  it('retries a transient failure then succeeds → no toast', async () => {
    const toast = vi.fn();
    const write = vi
      .fn()
      .mockRejectedValueOnce(new Error('blip'))
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValue(undefined);
    await persistWithRetry(write, opts(toast));
    expect(write).toHaveBeenCalledTimes(3); // 1 + 2 retries
    expect(toast).not.toHaveBeenCalled();
  });

  it('exhausts retries → write retries+1 times, toast once with failMessage', async () => {
    const toast = vi.fn();
    const write = vi.fn().mockRejectedValue(new Error('down'));
    await persistWithRetry(write, opts(toast)); // default retries: 2
    expect(write).toHaveBeenCalledTimes(3);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith('could not save');
  });

  it('honors a custom retries count', async () => {
    const toast = vi.fn();
    const write = vi.fn().mockRejectedValue(new Error('down'));
    await persistWithRetry(write, opts(toast, { retries: 0 }));
    expect(write).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('never rejects, even when write always throws', async () => {
    const write = vi.fn().mockRejectedValue(new Error('down'));
    await expect(persistWithRetry(write, opts(vi.fn()))).resolves.toBeUndefined();
  });
});
