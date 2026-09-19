// A page entry gets one successful automatic fit. User navigation takes priority.
export function createInitialGraphFit(fit: () => boolean) {
  let finished = false;
  return {
    onEngineStop() {
      if (!finished && fit()) finished = true;
    },
    cancel() {
      finished = true;
    },
  };
}
