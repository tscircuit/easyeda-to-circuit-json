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
  EASYEDA_PCB_UNIT_TO_MM,
  EASYEDA_SCHEMATIC_UNIT_TO_MM,
} from "lib"
import {
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
    message: "EasyEDA PT conversion is not implemented yet",
    documentPath: ["shape", 0],
    recordToken: "PT",
    sourceShapeId: "gge-path-unsupported",
  })
})

const pcbFixtureSource = JSON.stringify({
  head: "3~1.11.3",
  canvas: "CA~100~100~#000000~yes~#CCCCCC~10~100~100~line~10~pixel~5",
  shape: [
    "TRACK~1~10~~0 0 100 0 100 80 0 80 0 0~gge-board",
    "LIB~20~20~package`R`value`1k`~0~~gge-lib~1#@$TEXT~N~20~15~0~0~top~3~3~0~R1~gge-text#@$PAD~RECT~10~20~4~4~1~N1~1~0~gge-p1#@$PAD~RECT~30~20~4~4~1~N2~2~0~gge-p2",
    "TRACK~1~1~N1~10 20 30 20~gge-trace",
  ],
})

test("converts EasyEDA PCB documents to typed Circuit JSON", () => {
  const result = convertEasyEdaToCircuitJson({
    source: pcbFixtureSource,
    documentId: "pcb-fixture",
  })

  expect(result.diagnostics).toEqual([])
  expect(
    result.circuitJson.filter((element) => element.type === "pcb_board"),
  ).toHaveLength(1)
  expect(
    result.circuitJson.filter((element) => element.type === "pcb_component"),
  ).toHaveLength(1)
  expect(
    result.circuitJson.filter((element) => element.type === "pcb_smtpad"),
  ).toHaveLength(2)
  expect(
    result.circuitJson.filter((element) => element.type === "pcb_trace"),
  ).toHaveLength(1)
  expect(
    result.circuitJson.filter((element) => element.type === "source_trace"),
  ).toHaveLength(1)

  const board = result.circuitJson.find(
    (element) => element.type === "pcb_board",
  )
  expect(board).toMatchObject({
    width: 100 * EASYEDA_PCB_UNIT_TO_MM,
    height: 80 * EASYEDA_PCB_UNIT_TO_MM,
  })
  for (const element of result.circuitJson) {
    const parsed = any_circuit_element.safeParse(element)
    expect(parsed.success, element.type).toBe(true)
  }
})
