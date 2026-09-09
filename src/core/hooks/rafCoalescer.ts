/** Coalesces gesture dispatches to one per frame — Android touch sampling outpaces render, and each dispatch rebuilds the Skia LUT filter (photo) or seeks the player (video). */
export interface RafCoalescer {
  /** Replace the pending closure and (re)arm a single-frame callback if none is scheduled. */
  schedule(fn: () => void): void;
  /** Cancel the scheduled frame and run the pending closure synchronously (if any). */
  flush(): void;
  /** Cancel the scheduled frame and drop the pending closure without running it. */
  cancel(): void;
}

export function createRafCoalescer(): RafCoalescer {
  let handle: number | null = null;
  let pending: (() => void) | null = null;
  return {
    schedule(fn) {
      pending = fn;
      if (handle != null) return;
      handle = requestAnimationFrame(() => {
        handle = null;
        const run = pending;
        pending = null;
        run?.();
      });
    },
    flush() {
      if (handle != null) {
        cancelAnimationFrame(handle);
        handle = null;
      }
      const run = pending;
      pending = null;
      run?.();
    },
    cancel() {
      if (handle != null) {
        cancelAnimationFrame(handle);
        handle = null;
      }
      pending = null;
    },
  };
}
