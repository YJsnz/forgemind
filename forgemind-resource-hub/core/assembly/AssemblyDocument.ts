import type { UUID } from "../cad/CadTypes.ts";
import { ASSEMBLY_DOCUMENT_SCHEMA_VERSION, type AssemblyDocument } from "./AssemblyTypes.ts";

export interface CreateAssemblyDocumentInput {
  id: UUID;
  name: string;
  updatedAt?: number;
}

export const createAssemblyDocument = ({ id, name, updatedAt = Date.now() }: CreateAssemblyDocumentInput): AssemblyDocument => ({
  schemaVersion: ASSEMBLY_DOCUMENT_SCHEMA_VERSION,
  id,
  name,
  unit: "mm",
  components: {},
  componentOrder: [],
  mates: {},
  mateOrder: [],
  updatedAt,
});
