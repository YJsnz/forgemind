import type { HoleStyle } from "../../core/features/HoleFeature";
import type {
  KernelEdgeContinuityStation,
  KernelShapeRef,
  KernelSurfacePointAnalysis,
  KernelTopologyRef,
} from "../../core/kernel/KernelTypes";
import type { RecognizedHolePatternCandidate } from "../../core/direct-edit/ImportedPatternRecognition";

export type StandardCadView = "iso" | "front" | "top" | "right";
export type SurfaceInspectionMode = "normal" | "zebra" | "heatmap" | "comb";

export type RenderState = {
  dispose: () => void;
  fit?: () => void;
  setView?: (view: StandardCadView) => void;
  setSection?: (enabled: boolean, offsetMm: number) => void;
  highlightFace?: (topology: KernelTopologyRef) => void;
  setSurfaceInspection?: (mode: "normal" | "zebra") => void;
  showSurfaceHeatmap?: (samples: KernelSurfacePointAnalysis[]) => void;
  showCurvatureComb?: (stations: KernelEdgeContinuityStation[]) => void;
  setControlNetFeature?: (featureId: string | undefined) => void;
};

export type FeaturePanelItem = {
  id: string;
  name: string;
  type: string;
  typeLabel: string;
  enabled: boolean;
  state: string;
  stateLabel: string;
  bodyId?: string;
  summary: string;
  dependencyCount: number;
};

export type ImportedDepthCondition =
  | { type: "throughAll"; confidence: number; reason: string }
  | { type: "blind"; valueMm: number; confidence: number; reason: string };

export type DirectEditCandidate = {
  kind: "hole" | "round" | "cone" | "prismatic" | "pattern";
  label: string;
  topology: KernelTopologyRef;
  topologies: KernelTopologyRef[];
  suggestedValueMm?: number;
  holeSpec?: {
    diameterMm: number;
    axialLengthMm: number;
    depthCondition?: ImportedDepthCondition;
    axisOriginMm: { x: number; y: number; z: number };
    axisDirection: { x: number; y: number; z: number };
    style?: HoleStyle;
  };
  prismaticSpec?: {
    estimatedDepthMm?: number;
    sideFaceCount: number;
    profileEdgeCount: number;
    confidence: number;
    classification?: "boss" | "pocket";
    extrusionDirection?: "positive" | "negative";
    classificationConfidence?: number;
  };
  patternSpec?: {
    candidate: RecognizedHolePatternCandidate;
    patternType: "linear" | "circular";
    count: number;
    spacingMm?: number;
    radiusMm?: number;
    confidence: number;
    seedAxisOriginMm: { x: number; y: number; z: number };
    seedAxisDirection: { x: number; y: number; z: number };
    seedDepthCondition?: ImportedDepthCondition;
  };
};

export type EditableParameter = {
  key: "distance" | "diameterMm" | "depthMm" | "radiusMm" | "endRadiusMm" | "thicknessMm" | "distanceMm" | "angleDeg" | "startLengthMm" | "endLengthMm" | "styleDiameterMm" | "counterboreDepthMm" | "countersinkAngleDeg" | "patternCount" | "patternSpacingMm" | "patternAngleDeg" | "majorDiameterMm" | "pitchMm" | "lengthMm" | "threadedLengthMm" | "threadDepthMm" | "moduleMm" | "teeth" | "pressureAngleDeg" | "boreDiameterMm" | "outerDiameterMm" | "innerDiameterMm" | "widthMm" | "ballCount" | "cableDiameterMm";
  label: string;
  value: number;
  min?: number;
  step?: number;
};

export type CurrentShapeRef = KernelShapeRef | undefined;
