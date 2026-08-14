import {
  type EasyEdaDocument,
  EasyEdaSchematicList,
  parseEasyEdaSource,
} from "easyedats"
import { convertEasyEdaPcb } from "./pcb/convert-easyeda-pcb"
import { convertEasyEdaSchematic } from "./schematic/convert-easyeda-schematic"
import type {
  ConvertEasyEdaDocumentToCircuitJsonOptions,
  ConvertEasyEdaToCircuitJsonOptions,
  EasyEdaToCircuitJsonResult,
} from "./types"

function resolveSchematicDocument({
  easyEdaDocument,
  schematicIndex,
}: {
  easyEdaDocument: EasyEdaDocument
  schematicIndex: number
}) {
  if (!(easyEdaDocument instanceof EasyEdaSchematicList)) {
    return easyEdaDocument
  }
  return easyEdaDocument.sheets[schematicIndex]
}

export function convertEasyEdaDocumentToCircuitJson({
  easyEdaDocument,
  documentId = "EasyEDA schematic",
  schematicIndex = 0,
}: ConvertEasyEdaDocumentToCircuitJsonOptions): EasyEdaToCircuitJsonResult {
  const selectedDocument = resolveSchematicDocument({
    easyEdaDocument,
    schematicIndex,
  })
  if (!selectedDocument) {
    return {
      circuitJson: [],
      diagnostics: [
        {
          code: "unsupported-document-kind",
          severity: "error",
          message: `EasyEDA schematic index ${schematicIndex} is out of range`,
          documentPath: ["schematics", schematicIndex],
        },
      ],
    }
  }
  if (
    selectedDocument.kind === "pcb" ||
    selectedDocument.kind === "pcb-footprint"
  ) {
    return convertEasyEdaPcb({
      easyEdaDocument: selectedDocument,
      documentId,
    })
  }
  if (
    selectedDocument.kind !== "schematic" &&
    selectedDocument.kind !== "schematic-symbol"
  ) {
    return {
      circuitJson: [],
      diagnostics: [
        {
          code: "unsupported-document-kind",
          severity: "error",
          message: `EasyEDA ${selectedDocument.kind} conversion is not implemented yet`,
          documentPath: [],
        },
      ],
    }
  }
  return convertEasyEdaSchematic({
    easyEdaDocument: selectedDocument,
    documentId,
  })
}

export function convertEasyEdaToCircuitJson({
  source,
  documentId,
  schematicIndex,
}: ConvertEasyEdaToCircuitJsonOptions): EasyEdaToCircuitJsonResult {
  return convertEasyEdaDocumentToCircuitJson({
    easyEdaDocument: parseEasyEdaSource(source),
    documentId,
    schematicIndex,
  })
}
