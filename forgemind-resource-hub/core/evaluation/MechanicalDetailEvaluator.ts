import type { MechanicalDetailFeature } from "../features/MechanicalDetailFeature.ts";
import { validateMechanicalDetail } from "../mechanical/MechanicalDetail.ts";
import { KernelError } from "../kernel/KernelErrors.ts";
import type { FeatureEvaluationContext } from "./FeatureEvaluationContext.ts";
import type { FeatureEvaluationResult } from "./FeatureEvaluation.ts";
import { featureEvaluationFailure } from "./FeatureEvaluation.ts";

export const evaluateMechanicalDetail = async (feature: MechanicalDetailFeature, context: FeatureEvaluationContext): Promise<FeatureEvaluationResult> => {
  if (!feature.enabled || feature.state === "suppressed") return featureEvaluationFailure(feature.id, "FEATURE_UNSUPPORTED", "已停用的机械细节不参与模型重建。");
  const issues = validateMechanicalDetail(feature.detail);
  if (issues.length) return featureEvaluationFailure(feature.id, "INVALID_INPUT", issues.join(" "));
  let shape;
  try {
    shape = await context.kernel.createMechanicalDetail({ detail: feature.detail });
    const validation = await context.kernel.validate(shape);
    if (!validation.valid) {
      await context.kernel.disposeShape(shape);
      return featureEvaluationFailure(feature.id, "INVALID_RESULT", "机械细节生成了无效的 B-Rep。请检查尺寸关系。");
    }
    return { status: "success", featureId: feature.id, shape, validation, warnings: shape.operationWarnings ?? [] };
  } catch (error) {
    if (shape) await context.kernel.disposeShape(shape).catch(() => undefined);
    return featureEvaluationFailure(feature.id, "KERNEL_FAILURE", error instanceof Error ? error.message : String(error), error, error instanceof KernelError ? error.code : undefined);
  }
};
