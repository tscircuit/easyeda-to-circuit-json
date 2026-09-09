import { expect, test } from "bun:test"
import { any_circuit_element } from "circuit-json"
import {
  EasyEdaSchematicList,
  EasyEdaSchematicListEntry,
  parseEasyEdaSchematic,
  parseEasyEdaSource,
} from "easyedats"
import {
  convertEasyEdaDocumentToCircuitJson,
  convertEasyEdaToCircuitJson,
  EASYEDA_SCHEMATIC_UNIT_TO_MM,
} from "lib"
import {
  pathAndArcSource,
  schematicFixtureCases,
  unsupportedShapeSource,
} from "tests/fixtures/schematic-cases"

test("converts EasyEDA wires and junctions using typed Circuit JSON", () => {
  const fixture = schematicFixtureCases[0]
  if (!fixture) throw new Error("Missing wires-and-junctions fixture")
  const result = convertEasyEdaToCircuitJson({
    source: fixture.source,
    documentId: fixture.name,
  })
  const traces = result.circuitJson.filter(
    (element) => element.type === "schematic_trace",
  )

  expect(traces).toHaveLength(2)
  expect(traces[0]?.edges[0]?.from).toEqual({
    x: 20 * EASYEDA_SCHEMATIC_UNIT_TO_MM,
    y: -25 * EASYEDA_SCHEMATIC_UNIT_TO_MM,
  })
  expect(traces.flatMap((trace) => trace.junctions)).toContainEqual({
    x: 75 * EASYEDA_SCHEMATIC_UNIT_TO_MM,
    y: -25 * EASYEDA_SCHEMATIC_UNIT_TO_MM,
  })
  expect(result.diagnostics).toEqual([])
})

test("accepts an EasyEdaDocument without reparsing", () => {
  const fixture = schematicFixtureCases[2]
  if (!fixture) throw new Error("Missing rectangles fixture")
  const easyEdaDocument = parseEasyEdaSource(fixture.source)
  const result = convertEasyEdaDocumentToCircuitJson({
    easyEdaDocument,
    documentId: fixture.name,
  })

  expect(
    result.circuitJson.filter((element) => element.type === "schematic_rect"),
  ).toHaveLength(3)
  expect(easyEdaDocument.getString()).toBe(fixture.source)
})

test("selects a typed sheet from an EasyEDA schematic list", () => {
  const firstFixture = schematicFixtureCases[0]
  const secondFixture = schematicFixtureCases[2]
  if (!firstFixture || !secondFixture) {
    throw new Error("Missing schematic-list fixtures")
  }
  const easyEdaDocument = new EasyEdaSchematicList({
    schematics: [
      new EasyEdaSchematicListEntry({
        document: parseEasyEdaSchematic(firstFixture.source),
      }),
      new EasyEdaSchematicListEntry({
        document: parseEasyEdaSchematic(secondFixture.source),
      }),
    ],
  })
  const result = convertEasyEdaDocumentToCircuitJson({
    easyEdaDocument,
    documentId: "second-sheet",
    schematicIndex: 1,
  })

  expect(
    result.circuitJson.filter((element) => element.type === "schematic_rect"),
  ).toHaveLength(3)
  expect(
    result.circuitJson.filter((element) => element.type === "schematic_trace"),
  ).toHaveLength(0)
})

test("emits Circuit JSON elements accepted by the circuit-json schema", () => {
  for (const fixture of schematicFixtureCases) {
    const result = convertEasyEdaToCircuitJson({
      source: fixture.source,
      documentId: fixture.name,
    })
    for (const element of result.circuitJson) {
      const parsed = any_circuit_element.safeParse(element)
      expect(parsed.success, `${fixture.name}: ${element.type}`).toBe(true)
    }
  }
})

test("reports unsupported EasyEDA records with source identity", () => {
  const result = convertEasyEdaToCircuitJson({
    source: unsupportedShapeSource,
  })

  expect(result.diagnostics).toContainEqual({
    code: "unsupported-shape",
    severity: "warning",
    message: "EasyEDA PI conversion is not implemented yet",
    documentPath: ["shape", 0],
    recordToken: "PI",
    sourceShapeId: "gge-pie-unsupported",
  })
})

test("converts EasyEDA path and arc records to schematic paths", () => {
  const result = convertEasyEdaToCircuitJson({
    source: pathAndArcSource,
  })
  const paths = result.circuitJson.filter(
    (element) => element.type === "schematic_path",
  )
  expect(result.diagnostics).toEqual([])
  expect(paths).toHaveLength(2)
  expect(paths[0]?.points).toEqual([
    {
      x: 20 * EASYEDA_SCHEMATIC_UNIT_TO_MM,
      y: -20 * EASYEDA_SCHEMATIC_UNIT_TO_MM,
    },
    {
      x: 120 * EASYEDA_SCHEMATIC_UNIT_TO_MM,
      y: -80 * EASYEDA_SCHEMATIC_UNIT_TO_MM,
    },
  ])
  expect(paths[1]?.points.length).toBeGreaterThan(2)
  expect(paths[1]?.points[0]).toEqual({
    x: 40 * EASYEDA_SCHEMATIC_UNIT_TO_MM,
    y: -60 * EASYEDA_SCHEMATIC_UNIT_TO_MM,
  })
})

test("reports unsupported PCB documents without inventing a PCB schema", () => {
  const source = JSON.stringify({
    head: "3~1.11.3",
    canvas: "CA~100~100~#000000~yes~#CCCCCC~10~100~100~line~10~pixel~5",
    shape: [],
  })
  const result = convertEasyEdaToCircuitJson({ source })

  expect(result.circuitJson).toEqual([])
  expect(result.diagnostics[0]?.code).toBe("unsupported-document-kind")
})
