import type { CircuitJson, LayerRef, Point } from "circuit-json"
import {
  EasyEdaCircle,
  type EasyEdaDocument,
  EasyEdaHole,
  EasyEdaLibrary,
  EasyEdaPad,
  EasyEdaPcbArc,
  EasyEdaPcbRectangle,
  EasyEdaPcbText,
  type EasyEdaPoint,
  type EasyEdaShape,
  EasyEdaTrack,
  EasyEdaVia,
  shapeId,
} from "easyedats"
import type {
  EasyEdaToCircuitJsonDiagnostic,
  EasyEdaToCircuitJsonResult,
} from "../types"

/** EasyEDA PCB coordinates use a 10 mil base unit in Standard documents. */
export const EASYEDA_PCB_UNIT_TO_MM = 0.254

type RawPoint = EasyEdaPoint

interface LibraryRecord {
  index: number
  shape: EasyEdaLibrary
  reference: string
  value?: string
  packageName?: string
  x: number
  y: number
  rotation: number
  layer: "top" | "bottom"
  pads: EasyEdaPad[]
}

interface RawPort {
  pcbPortId: string
  sourcePortId: string
  net?: string
  point: RawPoint
}

interface Bounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

function sanitizeIdPart(value: string) {
  return (
    value
      .trim()
      .replace(/[^A-Za-z0-9_-]+/gu, "-")
      .replace(/^-+|-+$/gu, "") || "shape"
  )
}

function finite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value)
}

function addToBounds(bounds: Bounds, point: RawPoint) {
  bounds.minX = Math.min(bounds.minX, point.x)
  bounds.maxX = Math.max(bounds.maxX, point.x)
  bounds.minY = Math.min(bounds.minY, point.y)
  bounds.maxY = Math.max(bounds.maxY, point.y)
}

function addCircleToBounds(
  bounds: Bounds,
  x: number,
  y: number,
  radius: number,
) {
  addToBounds(bounds, { x: x - radius, y: y - radius })
  addToBounds(bounds, { x: x + radius, y: y + radius })
}

function createEmptyBounds(): Bounds {
  return {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  }
}

function isValidBounds(bounds: Bounds) {
  return (
    Number.isFinite(bounds.minX) &&
    Number.isFinite(bounds.maxX) &&
    Number.isFinite(bounds.minY) &&
    Number.isFinite(bounds.maxY)
  )
}

function parseLibraryMetadata(value: string | undefined) {
  const metadata: Record<string, string> = {}
  if (!value) return metadata
  const parts = value.split("`")
  for (let index = 0; index + 1 < parts.length; index += 2) {
    const key = parts[index]?.trim()
    const item = parts[index + 1]
    if (key && item !== undefined) metadata[key] = item
  }
  return metadata
}

function libraryRecordFromShape(
  shape: EasyEdaLibrary,
  index: number,
): LibraryRecord {
  const x = Number(shape.fields[0])
  const y = Number(shape.fields[1])
  const metadata = parseLibraryMetadata(shape.fields[2])
  const rotation = Number(shape.fields[3] ?? 0)
  const pads = shape.children.filter(
    (child): child is EasyEdaPad => child instanceof EasyEdaPad,
  )
  const text = shape.children.find(
    (child): child is EasyEdaPcbText =>
      child instanceof EasyEdaPcbText && Boolean(child.text?.trim()),
  )
  const reference =
    text?.text?.trim() ||
    metadata.name?.trim() ||
    metadata.package?.trim() ||
    `U${index + 1}`
  const layer = pads.some((pad) => pad.layerId === 2) ? "bottom" : "top"
  return {
    index,
    shape,
    reference,
    value: metadata.value?.trim() || undefined,
    packageName: metadata.package?.trim() || undefined,
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    rotation: Number.isFinite(rotation) ? rotation : 0,
    layer,
    pads,
  }
}

function layerRef(layerId: number | undefined): LayerRef {
  if (layerId === 2 || layerId === 4 || layerId === 6 || layerId === 8) {
    return "bottom"
  }
  if (layerId === 21) return "inner1"
  if (layerId === 22) return "inner2"
  if (layerId === 23) return "inner3"
  if (layerId === 24) return "inner4"
  return "top"
}

function isSilkscreenLayer(layerId: number | undefined) {
  return layerId === 3 || layerId === 4 || layerId === 12
}

// CIRCLE records do not expose a typed layer getter in easyedats yet. The
// Standard format stores it in field 3, just like the other PCB graphics.
function shapeLayerId(shape: EasyEdaShape): number | undefined {
  const value = Number(shape.fields[3])
  return Number.isFinite(value) ? value : undefined
}

function isCopperLayer(layerId: number | undefined) {
  return layerId === 1 || layerId === 2 || layerId === 21 || layerId === 22
}

function toPoint(raw: RawPoint, center: RawPoint): Point {
  return {
    x: (raw.x - center.x) * EASYEDA_PCB_UNIT_TO_MM,
    y: -(raw.y - center.y) * EASYEDA_PCB_UNIT_TO_MM,
  }
}

function toLength(raw: number | undefined, fallback = 0.2) {
  if (!finite(raw)) return fallback
  return Math.max(0.01, raw * EASYEDA_PCB_UNIT_TO_MM)
}

function createDiagnostic(
  diagnostics: EasyEdaToCircuitJsonDiagnostic[],
  shape: EasyEdaShape,
  documentPath: readonly (string | number)[],
  message: string,
  severity: "warning" | "error" = "warning",
) {
  diagnostics.push({
    code: "unsupported-shape",
    severity,
    message,
    documentPath,
    recordToken: shape.token,
    sourceShapeId: shapeId(shape),
  })
}

function padShape(pad: EasyEdaPad) {
  const shape = pad.padShape?.toUpperCase()
  if (shape === "RECT") return "rect" as const
  if (shape === "OVAL") return "pill" as const
  if (shape === "POLYGON") return "polygon" as const
  return "circle" as const
}

function inferComponentType(record: LibraryRecord) {
  const name =
    `${record.reference} ${record.packageName ?? ""} ${record.value ?? ""}`.toLowerCase()
  if (/led|diode|d\d/.test(name)) return "simple_led"
  if (/res|r\d/.test(name)) return "simple_resistor"
  if (/cap|c\d/.test(name)) return "simple_capacitor"
  if (/ind|l\d/.test(name)) return "simple_inductor"
  if (/battery|cell/.test(name)) return "simple_battery"
  if (/connector|usb|header|j\d/.test(name)) return "simple_connector"
  return "simple_chip"
}

function parseEngineeringValue(value: string | undefined, fallback: number) {
  if (!value) return fallback
  const match = value
    .trim()
    .match(/^(-?(?:\d+(?:\.\d*)?|\.\d+))\s*([fpnumkKMGT]?)(?:[ΩRohmFfHh])?$/u)
  if (!match) return fallback
  const multiplier: Record<string, number> = {
    "": 1,
    f: 1e-15,
    p: 1e-12,
    n: 1e-9,
    u: 1e-6,
    m: 1e-3,
    k: 1e3,
    K: 1e3,
    M: 1e6,
    G: 1e9,
    T: 1e12,
  }
  const result = Number(match[1]) * (multiplier[match[2] ?? ""] ?? 1)
  return Number.isFinite(result) && result > 0 ? result : fallback
}

function sourceComponentForRecord(
  sourceComponentId: string,
  record: LibraryRecord,
) {
  const common = {
    type: "source_component" as const,
    source_component_id: sourceComponentId,
    name: record.reference,
    ...(record.value ? { display_value: record.value } : {}),
  }
  const ftype = inferComponentType(record)
  switch (ftype) {
    case "simple_resistor":
      return {
        ...common,
        ftype: "simple_resistor" as const,
        resistance: parseEngineeringValue(record.value, 1),
      }
    case "simple_capacitor":
      return {
        ...common,
        ftype: "simple_capacitor" as const,
        capacitance: parseEngineeringValue(record.value, 1e-6),
      }
    case "simple_inductor":
      return {
        ...common,
        ftype: "simple_inductor" as const,
        inductance: parseEngineeringValue(record.value, 1e-6),
      }
    case "simple_battery":
      return {
        ...common,
        ftype: "simple_battery" as const,
        capacity: parseEngineeringValue(record.value, 1),
      }
    default:
      return {
        ...common,
        ftype: ftype as "simple_led" | "simple_connector" | "simple_chip",
      }
  }
}

function parseArcEndpoints(path: string | undefined): RawPoint[] {
  if (!path) return []
  const matches = [
    ...path.matchAll(/(-?\d+(?:\.\d+)?)\s*,?\s*(-?\d+(?:\.\d+)?)/gu),
  ]
  const points = matches.flatMap((match) => {
    const x = Number(match[1])
    const y = Number(match[2])
    return Number.isFinite(x) && Number.isFinite(y) ? [{ x, y }] : []
  })
  if (points.length < 2) return []
  const first = points[0]
  const last = points.at(-1)
  return first && last ? [first, last] : []
}

function nearestPortId(
  rawPorts: RawPort[],
  point: RawPoint,
  net: string | undefined,
) {
  let nearest: { id: string; distance: number } | undefined
  for (const port of rawPorts) {
    if (net && port.net && port.net !== net) continue
    const distance = Math.hypot(port.point.x - point.x, port.point.y - point.y)
    if (!nearest || distance < nearest.distance) {
      nearest = { id: port.pcbPortId, distance }
    }
  }
  return nearest && nearest.distance <= 1 ? nearest.id : undefined
}

function getBoardOutline(document: EasyEdaDocument): RawPoint[] | undefined {
  const boardTrack = document.shapes.find(
    (shape): shape is EasyEdaTrack =>
      shape instanceof EasyEdaTrack &&
      shape.layerId === 10 &&
      shape.points.length >= 3,
  )
  if (boardTrack) return boardTrack.points
  const boardRect = document.shapes.find(
    (shape): shape is EasyEdaPcbRectangle =>
      shape instanceof EasyEdaPcbRectangle && shape.layerId === 10,
  )
  if (
    boardRect &&
    finite(boardRect.x) &&
    finite(boardRect.y) &&
    finite(boardRect.width) &&
    finite(boardRect.height)
  ) {
    return [
      { x: boardRect.x, y: boardRect.y },
      { x: boardRect.x + boardRect.width, y: boardRect.y },
      { x: boardRect.x + boardRect.width, y: boardRect.y + boardRect.height },
      { x: boardRect.x, y: boardRect.y + boardRect.height },
      { x: boardRect.x, y: boardRect.y },
    ]
  }
  return undefined
}

function collectRawBounds(
  document: EasyEdaDocument,
  libraries: LibraryRecord[],
): Bounds {
  const bounds = createEmptyBounds()
  const collectShape = (shape: EasyEdaShape) => {
    if (shape instanceof EasyEdaTrack) {
      for (const point of shape.points) addToBounds(bounds, point)
      return
    }
    if (shape instanceof EasyEdaPad) {
      if (finite(shape.x) && finite(shape.y)) {
        addCircleToBounds(
          bounds,
          shape.x,
          shape.y,
          Math.max(shape.width ?? 0, shape.height ?? 0) / 2,
        )
      }
      return
    }
    if (shape instanceof EasyEdaCircle) {
      if (finite(shape.x) && finite(shape.y) && finite(shape.radius)) {
        addCircleToBounds(bounds, shape.x, shape.y, shape.radius)
      }
      return
    }
    if (shape instanceof EasyEdaHole || shape instanceof EasyEdaVia) {
      if (finite(shape.x) && finite(shape.y)) {
        addToBounds(bounds, { x: shape.x, y: shape.y })
      }
      return
    }
    if (shape instanceof EasyEdaPcbRectangle) {
      if (
        finite(shape.x) &&
        finite(shape.y) &&
        finite(shape.width) &&
        finite(shape.height)
      ) {
        addToBounds(bounds, { x: shape.x, y: shape.y })
        addToBounds(bounds, {
          x: shape.x + shape.width,
          y: shape.y + shape.height,
        })
      }
      return
    }
    if (shape instanceof EasyEdaLibrary) {
      addToBounds(bounds, {
        x: Number(shape.fields[0]) || 0,
        y: Number(shape.fields[1]) || 0,
      })
      for (const child of shape.children) collectShape(child)
    }
  }
  for (const shape of document.shapes) collectShape(shape)
  for (const library of libraries) {
    addToBounds(bounds, { x: library.x, y: library.y })
  }
  return bounds
}

function componentBounds(record: LibraryRecord): Bounds {
  const bounds = createEmptyBounds()
  addToBounds(bounds, { x: record.x, y: record.y })
  for (const child of record.shape.children) {
    if (child instanceof EasyEdaTrack) {
      for (const point of child.points) addToBounds(bounds, point)
    } else if (
      child instanceof EasyEdaPad &&
      finite(child.x) &&
      finite(child.y)
    ) {
      addCircleToBounds(
        bounds,
        child.x,
        child.y,
        Math.max(child.width ?? 0, child.height ?? 0) / 2,
      )
    } else if (
      child instanceof EasyEdaCircle &&
      finite(child.x) &&
      finite(child.y) &&
      finite(child.radius)
    ) {
      addCircleToBounds(bounds, child.x, child.y, child.radius)
    }
  }
  return bounds
}

export function convertEasyEdaPcb({
  easyEdaDocument,
  documentId = "EasyEDA PCB",
}: {
  easyEdaDocument: EasyEdaDocument
  documentId?: string
}): EasyEdaToCircuitJsonResult {
  const diagnostics: EasyEdaToCircuitJsonDiagnostic[] = []
  const circuitJson: CircuitJson = []
  const libraries = easyEdaDocument.shapes.flatMap((shape, index) =>
    shape instanceof EasyEdaLibrary
      ? [libraryRecordFromShape(shape, index)]
      : [],
  )
  const boardOutline = getBoardOutline(easyEdaDocument)
  const bounds = collectRawBounds(easyEdaDocument, libraries)
  if (boardOutline) {
    const outlineBounds = createEmptyBounds()
    for (const point of boardOutline) addToBounds(outlineBounds, point)
    bounds.minX = outlineBounds.minX
    bounds.maxX = outlineBounds.maxX
    bounds.minY = outlineBounds.minY
    bounds.maxY = outlineBounds.maxY
  }
  if (!isValidBounds(bounds)) {
    diagnostics.push({
      code: "invalid-shape",
      severity: "error",
      message: "EasyEDA PCB does not contain any usable geometry",
      documentPath: ["shape"],
    })
    return { circuitJson, diagnostics }
  }

  const rawCenter = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  }
  const outline = boardOutline?.map((point) => toPoint(point, rawCenter)) ?? [
    toPoint({ x: bounds.minX, y: bounds.minY }, rawCenter),
    toPoint({ x: bounds.maxX, y: bounds.minY }, rawCenter),
    toPoint({ x: bounds.maxX, y: bounds.maxY }, rawCenter),
    toPoint({ x: bounds.minX, y: bounds.maxY }, rawCenter),
    toPoint({ x: bounds.minX, y: bounds.minY }, rawCenter),
  ]
  const boardId = `pcb_board_${sanitizeIdPart(documentId)}`
  circuitJson.push({
    type: "pcb_board",
    pcb_board_id: boardId,
    center: { x: 0, y: 0 },
    width: Math.max(0.1, (bounds.maxX - bounds.minX) * EASYEDA_PCB_UNIT_TO_MM),
    height: Math.max(0.1, (bounds.maxY - bounds.minY) * EASYEDA_PCB_UNIT_TO_MM),
    outline,
    shape: "polygon",
    thickness: 1.6,
    num_layers: Math.max(
      2,
      easyEdaDocument.layers.filter(
        (layer) => (layer.id ?? 0) >= 1 && (layer.id ?? 0) <= 24,
      ).length > 0
        ? 2
        : 2,
    ),
    material: "fr4",
    solder_mask_color: "#0b6b3a",
    silkscreen_color: "#f2eda1",
    position_mode: "none",
  })

  const netIds = new Map<string, string>()
  const netIdFor = (net: string | undefined) => {
    if (!net?.trim()) return undefined
    const normalized = net.trim()
    const existing = netIds.get(normalized)
    if (existing) return existing
    const id = `source_net_${sanitizeIdPart(normalized) || netIds.size + 1}`
    netIds.set(normalized, id)
    circuitJson.push({
      type: "source_net",
      source_net_id: id,
      name: normalized,
      member_source_group_ids: [],
    })
    circuitJson.push({
      type: "pcb_net",
      pcb_net_id: `pcb_net_${sanitizeIdPart(normalized) || netIds.size}`,
      source_net_id: id,
    })
    return id
  }

  const rawPorts: RawPort[] = []
  for (const record of libraries) {
    const sourceComponentId = `source_component_${sanitizeIdPart(record.reference)}_${record.index}`
    const pcbComponentId = `pcb_component_${sanitizeIdPart(record.reference)}_${record.index}`
    const componentBoundsValue = componentBounds(record)
    const componentWidth = Math.max(
      0.1,
      (componentBoundsValue.maxX - componentBoundsValue.minX) *
        EASYEDA_PCB_UNIT_TO_MM,
    )
    const componentHeight = Math.max(
      0.1,
      (componentBoundsValue.maxY - componentBoundsValue.minY) *
        EASYEDA_PCB_UNIT_TO_MM,
    )
    circuitJson.push(sourceComponentForRecord(sourceComponentId, record))
    circuitJson.push({
      type: "pcb_component",
      pcb_component_id: pcbComponentId,
      source_component_id: sourceComponentId,
      center: toPoint({ x: record.x, y: record.y }, rawCenter),
      layer: record.layer,
      rotation: record.rotation,
      width: componentWidth,
      height: componentHeight,
      position_mode: "none",
      obstructs_within_bounds: false,
    })

    for (const [padIndex, pad] of record.pads.entries()) {
      if (!finite(pad.x) || !finite(pad.y)) {
        createDiagnostic(
          diagnostics,
          pad,
          ["shape", record.index, "children", padIndex],
          "EasyEDA PAD record is missing numeric coordinates",
          "error",
        )
        continue
      }
      const padId = `pcb_smtpad_${sanitizeIdPart(record.reference)}_${padIndex + 1}_${record.index}`
      const portId = `pcb_port_${sanitizeIdPart(record.reference)}_${padIndex + 1}_${record.index}`
      const sourcePortId = `source_port_${sanitizeIdPart(record.reference)}_${padIndex + 1}_${record.index}`
      const net = pad.net?.trim() || undefined
      netIdFor(net)
      const padLayer = layerRef(pad.layerId)
      const center = toPoint({ x: pad.x, y: pad.y }, rawCenter)
      const hints = [
        ...(pad.number?.trim() ? [pad.number.trim()] : []),
        ...(net ? [net] : []),
      ]
      const pinNumber = Number(pad.number)
      circuitJson.push({
        type: "source_port",
        source_port_id: sourcePortId,
        source_component_id: sourceComponentId,
        name: pad.number?.trim() || net || `pin${padIndex + 1}`,
        ...(Number.isFinite(pinNumber) ? { pin_number: pinNumber } : {}),
        ...(hints.length > 0 ? { port_hints: hints } : {}),
      })
      circuitJson.push({
        type: "pcb_port",
        pcb_port_id: portId,
        source_port_id: sourcePortId,
        pcb_component_id: pcbComponentId,
        x: center.x,
        y: center.y,
        layers: [padLayer],
      })
      const shape = padShape(pad)
      if (shape === "polygon") {
        const points = pad.fields[8]?.trim().split(/[ ,]+/u).map(Number)
        if (points && points.length >= 6 && points.every(Number.isFinite)) {
          circuitJson.push({
            type: "pcb_smtpad",
            pcb_smtpad_id: padId,
            shape,
            points: Array.from({ length: points.length / 2 }, (_, pointIndex) =>
              toPoint(
                {
                  x: points[pointIndex * 2] ?? 0,
                  y: points[pointIndex * 2 + 1] ?? 0,
                },
                rawCenter,
              ),
            ),
            layer: padLayer,
            port_hints: hints,
            pcb_component_id: pcbComponentId,
            pcb_port_id: portId,
          })
        } else {
          createDiagnostic(
            diagnostics,
            pad,
            ["shape", record.index, "children", padIndex],
            "EasyEDA polygon PAD has no usable point list; rendered as a circle",
          )
          circuitJson.push({
            type: "pcb_smtpad",
            pcb_smtpad_id: padId,
            shape: "circle",
            x: center.x,
            y: center.y,
            radius: Math.min(toLength(pad.width), toLength(pad.height)) / 2,
            layer: padLayer,
            port_hints: hints,
            pcb_component_id: pcbComponentId,
            pcb_port_id: portId,
          })
        }
      } else if (shape === "rect") {
        circuitJson.push({
          type: "pcb_smtpad",
          pcb_smtpad_id: padId,
          shape,
          x: center.x,
          y: center.y,
          width: toLength(pad.width),
          height: toLength(pad.height),
          layer: padLayer,
          port_hints: hints,
          pcb_component_id: pcbComponentId,
          pcb_port_id: portId,
        })
      } else if (shape === "pill") {
        const width = toLength(pad.width)
        const height = toLength(pad.height)
        circuitJson.push({
          type: "pcb_smtpad",
          pcb_smtpad_id: padId,
          shape,
          x: center.x,
          y: center.y,
          width,
          height,
          radius: Math.min(width, height) / 2,
          layer: padLayer,
          port_hints: hints,
          pcb_component_id: pcbComponentId,
          pcb_port_id: portId,
        })
      } else {
        circuitJson.push({
          type: "pcb_smtpad",
          pcb_smtpad_id: padId,
          shape,
          x: center.x,
          y: center.y,
          radius: Math.min(toLength(pad.width), toLength(pad.height)) / 2,
          layer: padLayer,
          port_hints: hints,
          pcb_component_id: pcbComponentId,
          pcb_port_id: portId,
        })
      }
      rawPorts.push({
        pcbPortId: portId,
        sourcePortId,
        net,
        point: { x: pad.x, y: pad.y },
      })
    }

    for (const [childIndex, child] of record.shape.children.entries()) {
      const childPath = ["shape", record.index, "children", childIndex]
      if (child instanceof EasyEdaTrack && isSilkscreenLayer(child.layerId)) {
        if (child.points.length < 2) continue
        circuitJson.push({
          type: "pcb_silkscreen_path",
          pcb_silkscreen_path_id: `pcb_silkscreen_path_${record.index}_${childIndex}`,
          pcb_component_id: pcbComponentId,
          layer: layerRef(child.layerId) as "top" | "bottom",
          route: child.points.map((point) => toPoint(point, rawCenter)),
          stroke_width: toLength(child.width),
        })
      } else if (
        child instanceof EasyEdaCircle &&
        isSilkscreenLayer(shapeLayerId(child))
      ) {
        const x = child.x
        const y = child.y
        const radius = child.radius
        if (!finite(x) || !finite(y) || !finite(radius)) continue
        const route = Array.from({ length: 25 }, (_, pointIndex) => {
          const angle = (Math.PI * 2 * pointIndex) / 24
          return toPoint(
            {
              x: x + Math.cos(angle) * radius,
              y: y + Math.sin(angle) * radius,
            },
            rawCenter,
          )
        })
        circuitJson.push({
          type: "pcb_silkscreen_path",
          pcb_silkscreen_path_id: `pcb_silkscreen_circle_${record.index}_${childIndex}`,
          pcb_component_id: pcbComponentId,
          layer: layerRef(shapeLayerId(child)) as "top" | "bottom",
          route,
          stroke_width: toLength(1),
        })
      } else if (
        child instanceof EasyEdaPcbText &&
        isSilkscreenLayer(child.layerId)
      ) {
        if (!finite(child.x) || !finite(child.y) || !child.text?.trim())
          continue
        circuitJson.push({
          type: "pcb_silkscreen_text",
          pcb_silkscreen_text_id: `pcb_silkscreen_text_${record.index}_${childIndex}`,
          font: "tscircuit2024",
          font_size: Math.max(0.4, child.fontSize ?? 1),
          pcb_component_id: pcbComponentId,
          text: child.text.trim(),
          layer: layerRef(child.layerId) as "top" | "bottom",
          anchor_position: toPoint({ x: child.x, y: child.y }, rawCenter),
          anchor_alignment: "center",
        })
      } else if (
        child instanceof EasyEdaPcbArc &&
        isSilkscreenLayer(child.layerId)
      ) {
        const endpoints = parseArcEndpoints(child.path)
        if (endpoints.length < 2) {
          createDiagnostic(
            diagnostics,
            child,
            childPath,
            "EasyEDA ARC has no renderable endpoints",
          )
          continue
        }
        circuitJson.push({
          type: "pcb_silkscreen_path",
          pcb_silkscreen_path_id: `pcb_silkscreen_arc_${record.index}_${childIndex}`,
          pcb_component_id: pcbComponentId,
          layer: layerRef(child.layerId) as "top" | "bottom",
          route: endpoints.map((point) => toPoint(point, rawCenter)),
          stroke_width: toLength(child.width),
        })
      }
    }
  }

  for (const [shapeIndex, shape] of easyEdaDocument.shapes.entries()) {
    if (shape instanceof EasyEdaTrack) {
      if (shape.layerId === 10) continue
      if (isCopperLayer(shape.layerId) && shape.points.length >= 2) {
        const net = shape.net?.trim() || undefined
        const route: Array<{
          route_type: "wire"
          x: number
          y: number
          width: number
          layer: "top" | "bottom"
          start_pcb_port_id?: string
          end_pcb_port_id?: string
        }> = shape.points.map((point) => ({
          route_type: "wire" as const,
          ...toPoint(point, rawCenter),
          width: toLength(shape.width),
          layer: layerRef(shape.layerId) as "top" | "bottom",
        }))
        const firstPoint = shape.points[0]
        const lastPoint = shape.points.at(-1)
        const startPortId = firstPoint
          ? nearestPortId(rawPorts, firstPoint, net)
          : undefined
        const endPortId = lastPoint
          ? nearestPortId(rawPorts, lastPoint, net)
          : undefined
        const firstRoutePoint = route[0]
        const lastRoutePoint = route.at(-1)
        if (startPortId && firstRoutePoint) {
          firstRoutePoint.start_pcb_port_id = startPortId
        }
        if (endPortId && lastRoutePoint) {
          lastRoutePoint.end_pcb_port_id = endPortId
        }
        const sourceNetId = netIdFor(net)
        const sourceTraceId = `source_trace_${shapeId(shape) ?? shapeIndex}`
        const connectedSourcePortIds = rawPorts
          .filter((port) => net && port.net === net)
          .map((port) => port.sourcePortId)
        circuitJson.push({
          type: "source_trace",
          source_trace_id: sourceTraceId,
          connected_source_port_ids: connectedSourcePortIds,
          connected_source_net_ids: sourceNetId ? [sourceNetId] : [],
          ...(net ? { name: net, display_name: net } : {}),
        })
        circuitJson.push({
          type: "pcb_trace",
          pcb_trace_id: `pcb_trace_${shapeId(shape) ?? shapeIndex}`,
          source_trace_id: sourceTraceId,
          route,
        })
      } else if (isSilkscreenLayer(shape.layerId) && shape.points.length >= 2) {
        circuitJson.push({
          type: "pcb_silkscreen_path",
          pcb_silkscreen_path_id: `pcb_silkscreen_path_board_${shapeIndex}`,
          pcb_component_id: "board-graphics",
          layer: layerRef(shape.layerId) as "top" | "bottom",
          route: shape.points.map((point) => toPoint(point, rawCenter)),
          stroke_width: toLength(shape.width),
        })
      } else if (shape.layerId !== 9) {
        createDiagnostic(
          diagnostics,
          shape,
          ["shape", shapeIndex],
          `EasyEDA TRACK layer ${shape.layerId ?? "unknown"} is not rendered`,
        )
      }
    } else if (
      shape instanceof EasyEdaCircle &&
      isSilkscreenLayer(shapeLayerId(shape))
    ) {
      const x = shape.x
      const y = shape.y
      const radius = shape.radius
      if (!finite(x) || !finite(y) || !finite(radius)) continue
      const route = Array.from({ length: 25 }, (_, pointIndex) => {
        const angle = (Math.PI * 2 * pointIndex) / 24
        return toPoint(
          {
            x: x + Math.cos(angle) * radius,
            y: y + Math.sin(angle) * radius,
          },
          rawCenter,
        )
      })
      circuitJson.push({
        type: "pcb_silkscreen_path",
        pcb_silkscreen_path_id: `pcb_silkscreen_circle_board_${shapeIndex}`,
        pcb_component_id: "board-graphics",
        layer: layerRef(shapeLayerId(shape)) as "top" | "bottom",
        route,
        stroke_width: toLength(1),
      })
    } else if (
      shape instanceof EasyEdaPcbText &&
      isSilkscreenLayer(shape.layerId)
    ) {
      if (!finite(shape.x) || !finite(shape.y) || !shape.text?.trim()) continue
      circuitJson.push({
        type: "pcb_silkscreen_text",
        pcb_silkscreen_text_id: `pcb_silkscreen_text_board_${shapeIndex}`,
        font: "tscircuit2024",
        font_size: Math.max(0.4, shape.fontSize ?? 1),
        pcb_component_id: "board-graphics",
        text: shape.text.trim(),
        layer: layerRef(shape.layerId) as "top" | "bottom",
        anchor_position: toPoint({ x: shape.x, y: shape.y }, rawCenter),
        anchor_alignment: "center",
      })
    } else if (shape instanceof EasyEdaHole) {
      if (!finite(shape.x) || !finite(shape.y) || !finite(shape.diameter))
        continue
      circuitJson.push({
        type: "pcb_hole",
        pcb_hole_id: `pcb_hole_${shapeId(shape) ?? shapeIndex}`,
        hole_shape: "circle",
        hole_diameter: toLength(shape.diameter),
        ...toPoint({ x: shape.x, y: shape.y }, rawCenter),
      })
    } else if (shape instanceof EasyEdaVia) {
      if (!finite(shape.x) || !finite(shape.y) || !finite(shape.diameter))
        continue
      circuitJson.push({
        type: "pcb_via",
        pcb_via_id: `pcb_via_${shapeId(shape) ?? shapeIndex}`,
        outer_diameter: toLength(shape.diameter),
        hole_diameter: toLength(
          shape.holeRadius ? shape.holeRadius * 2 : undefined,
          0.3,
        ),
        layers: ["top", "bottom"],
        ...toPoint({ x: shape.x, y: shape.y }, rawCenter),
      })
    } else if (
      !(shape instanceof EasyEdaLibrary) &&
      !(shape instanceof EasyEdaPcbRectangle) &&
      !(shape instanceof EasyEdaPcbArc)
    ) {
      createDiagnostic(
        diagnostics,
        shape,
        ["shape", shapeIndex],
        `EasyEDA ${shape.token} conversion is not implemented yet`,
      )
    }
  }

  return { circuitJson, diagnostics }
}
