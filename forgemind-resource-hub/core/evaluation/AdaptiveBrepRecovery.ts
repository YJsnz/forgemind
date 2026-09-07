import type { CadKernel } from "../kernel/CadKernel.ts";
import type { KernelShapeRef } from "../kernel/KernelTypes.ts";

export interface AdaptiveBrepRecoveryResult {
  shape: KernelShapeRef;
  warnings: string[];
}

/** Retries an exact modifier against a healed source without changing the
 * requested distance/thickness. This is intentionally conservative: recovery
 * may repair B-Rep tolerances, but never silently changes design dimensions. */
export const runAdaptiveBrepRecovery = async (
  kernel: CadKernel,
  source: KernelShapeRef,
  operationLabel: string,
  attempts: Array<{ label: string; run: (input: KernelShapeRef) => Promise<KernelShapeRef> }>,
): Promise<AdaptiveBrepRecoveryResult> => {
  const failures: string[] = [];
  for (const attempt of attempts) {
    let shape: KernelShapeRef | undefined;
    try {
      shape = await attempt.run(source);
      const validation = await kernel.validate(shape);
      if (!validation.valid) throw new Error("result is not a valid B-Rep");
      return { shape, warnings: attempt.label === "原始几何" ? [] : [`${operationLabel} 已通过${attempt.label}恢复，原设计尺寸保持不变。`] };
    } catch (error) {
      if (shape) await kernel.disposeShape(shape).catch(() => undefined);
      failures.push(`${attempt.label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  let healed: KernelShapeRef | undefined;
  try {
    healed = await kernel.heal(source);
    for (const attempt of attempts) {
      let shape: KernelShapeRef | undefined;
      try {
        shape = await attempt.run(healed);
        const validation = await kernel.validate(shape);
        if (!validation.valid) throw new Error("result is not a valid B-Rep");
        return { shape, warnings: [`${operationLabel} 已先修复输入面的连接和容差，原设计尺寸保持不变。`, ...(attempt.label === "原始几何" ? [] : [`采用${attempt.label}的内核容差。`])] };
      } catch (error) {
        if (shape) await kernel.disposeShape(shape).catch(() => undefined);
        failures.push(`修复后/${attempt.label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally { if (healed) await kernel.disposeShape(healed).catch(() => undefined); }
  throw new Error(`${operationLabel} 自动修复未通过：${failures.join("；")}`);
};

export const adaptiveToleranceValues = (requested: number): number[] => {
  const base = Number.isFinite(requested) && requested > 0 ? requested : 1e-6;
  return [...new Set([base, Math.max(1e-7, base / 10), Math.min(1e-3, Math.max(1e-6, base * 10))])];
};
