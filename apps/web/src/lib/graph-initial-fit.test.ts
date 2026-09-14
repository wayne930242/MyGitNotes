import { describe, expect, it, vi } from 'vitest';
import { createInitialGraphFit } from './graph-initial-fit.js';

describe('initial graph fit', () => {
  it('fits once despite subsequent simulation stops and filter updates', () => {
    const fit = vi.fn(() => true);
    const controller = createInitialGraphFit(fit);
    controller.onEngineStop();
    controller.onEngineStop();
    controller.onEngineStop();
    expect(fit).toHaveBeenCalledTimes(1);
  });
  it('waits for usable bounds before consuming the initial fit', () => {
    const fit = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    const controller = createInitialGraphFit(fit);
    controller.onEngineStop();
    controller.onEngineStop();
    controller.onEngineStop();
    expect(fit).toHaveBeenCalledTimes(2);
  });
  it('preserves navigation performed before the first simulation stops', () => {
    const fit = vi.fn(() => true);
    const controller = createInitialGraphFit(fit);
    controller.cancel();
    controller.onEngineStop();
    expect(fit).not.toHaveBeenCalled();
  });
  it('allows one initial fit for each new page entry', () => {
    const fit = vi.fn(() => true);
    createInitialGraphFit(fit).onEngineStop();
    createInitialGraphFit(fit).onEngineStop();
    expect(fit).toHaveBeenCalledTimes(2);
  });
});
