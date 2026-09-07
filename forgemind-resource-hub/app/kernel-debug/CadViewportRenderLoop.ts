export type CadViewportFrameScheduler = {
  request: (callback: FrameRequestCallback) => number;
  cancel: (handle: number) => void;
};

export type CadViewportRenderLoop = {
  requestRender: () => void;
  setInteracting: (active: boolean) => void;
  dispose: () => void;
};

const browserFrameScheduler = (): CadViewportFrameScheduler => ({
  request: (callback) => window.requestAnimationFrame(callback),
  cancel: (handle) => window.cancelAnimationFrame(handle),
});

/**
 * Coalesces viewport invalidations into animation frames and keeps calling the
 * controls update while an orbit gesture or damping motion is active.
 */
export const createCadViewportRenderLoop = ({
  render,
  updateControls,
  scheduler = browserFrameScheduler(),
}: {
  render: () => void;
  updateControls: () => boolean;
  scheduler?: CadViewportFrameScheduler;
}): CadViewportRenderLoop => {
  let frameHandle: number | undefined;
  let dirty = false;
  let interacting = false;
  let disposed = false;

  const schedule = () => {
    if (disposed || frameHandle !== undefined) return;
    frameHandle = scheduler.request(runFrame);
  };

  const runFrame: FrameRequestCallback = () => {
    if (disposed) return;
    const controlsChanged = updateControls();
    if (dirty || controlsChanged) render();
    dirty = false;
    if (interacting || controlsChanged) frameHandle = scheduler.request(runFrame);
    else frameHandle = undefined;
  };

  const requestRender = () => {
    if (disposed) return;
    dirty = true;
    schedule();
  };

  return {
    requestRender,
    setInteracting: (active) => {
      if (disposed) return;
      interacting = active;
      requestRender();
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      interacting = false;
      dirty = false;
      if (frameHandle !== undefined) scheduler.cancel(frameHandle);
      frameHandle = undefined;
    },
  };
};
