import type { CadKernel } from "./CadKernel.ts";
import { KernelInitializationError } from "./KernelErrors.ts";

let activeKernel: CadKernel | null = null;

/** Registers the runtime implementation without exposing its concrete type to callers. */
export const setCadKernel = (kernel: CadKernel): void => {
  activeKernel = kernel;
};

/** Returns the registered kernel or a typed error instead of an ambiguous null failure. */
export const getCadKernel = (): CadKernel => {
  if (!activeKernel) throw new KernelInitializationError("No CAD kernel has been registered.", "KERNEL_NOT_REGISTERED");
  return activeKernel;
};

/** Clears the boundary manager only; lifecycle disposal remains the caller's responsibility. */
export const clearCadKernel = (): void => {
  activeKernel = null;
};

export const hasCadKernel = (): boolean => activeKernel !== null;
