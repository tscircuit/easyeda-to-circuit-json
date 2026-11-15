import type { Point, SchematicTrace } from "circuit-json"
import {
  EasyEdaArc,
  EasyEdaBus,
  EasyEdaBusEntry,
  EasyEdaCircle,
  EasyEdaEllipse,
  EasyEdaJunction,
  EasyEdaLibrary,
  EasyEdaLine,
  EasyEdaNetLabel,
  EasyEdaNoConnect,
  EasyEdaPath,
  EasyEdaPolygon,
  EasyEdaPolyline,
  EasyEdaRectangle,
  EasyEdaSchematicText,
  type EasyEdaShape,
  EasyEdaWire,
  shapeId,
} from "easyedats"
import {
  reportShapeDiagnostic,
  reserveCircuitElementId,
  type SchematicConversionContext,
  type ShapeConversionLocation,
} from "./conversion-context"
import { convertEasyEdaLength, convertEasyEdaPoint } from "./coordinates"
import { parseEasyEdaSvgPath } from "./parse-easyeda-svg-path"
import {
  readEasyEdaFontSize,
  readFillColor,
  readStrokeStyle,
} from "./shape-style"

function isFiniteNumber(candidate: number | undefined): candidate is number {
  return candidate !== undefined && Number.isFinite(candidate)
}

function reportInvalidGeometry({
  context,
  shape,
  location,
}: {
  context: SchematicConversionContext
  shape: EasyEdaShape
  location: ShapeConversionLocation
}) {
  reportShapeDiagnostic({
    context,
    shape,
    documentPath: location.documentPath,
    code: "invalid-shape",
    severity: "error",
    message: `EasyEDA ${shape.token} record is missing required numeric geometry`,
  })
}

function symbolFields(location: ShapeConversionLocation) {
  return location.schematicSymbolId
    ? { schematic_symbol_id: location.schematicSymbolId }
    : {}
}

function createEdges(points: Point[]): SchematicTrace["edges"] {
  const edges: SchematicTrace["edges"] = []
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]
    const to = points[index]
    if (from && to) edges.push({ from, to })
  }
  return edges
}

function isPointOnSegment({
  point,
  start,
  end,
}: {
  point: Point
  start: Point
  end: Point
}) {
  const crossProduct =
    (point.y - start.y) * (end.x - start.x) -
    (point.x - start.x) * (end.y - start.y)
  if (Math.abs(crossProduct) > 1e-8) return false
  const dotProduct =
    (point.x - start.x) * (end.x - start.x) +
    (point.y - start.y) * (end.y - start.y)
  if (dotProduct < 0) return false
  const squaredLength = (end.x - start.x) ** 2 + (end.y - start.y) ** 2
  return dotProduct <= squaredLength
}

function findWireJunctions({
  context,
  points,
}: {
  context: SchematicConversionContext
  points: Point[]
}) {
  const matched: Point[] = []
  for (const junction of context.junctions) {
    const junctionX = junction.x
    const junctionY = junction.y
    if (!isFiniteNumber(junctionX) || !isFiniteNumber(junctionY)) continue
    const junctionPoint = convertEasyEdaPoint({
      x: junctionX,
      y: junctionY,
    })
    let matchesSegment = false
    for (let index = 1; index < points.length; index += 1) {
      const start = points[index - 1]
      const end = points[index]
      if (
        start &&
        end &&
        isPointOnSegment({ point: junctionPoint, start, end })
      ) {
        matchesSegment = true
        break
      }
    }
    if (!matchesSegment) continue
    matched.push(junctionPoint)
    context.consumedJunctions.add(junction)
  }
  return matched
}

function convertWire({
  context,
  shape,
  location,
}: {
  context: SchematicConversionContext
  shape: EasyEdaWire
  location: ShapeConversionLocation
}) {
  const points = shape.points.map(convertEasyEdaPoint)
  if (points.length < 2) {
    reportInvalidGeometry({ context, shape, location })
    return
  }
  const schematicTraceId = reserveCircuitElementId({
    context,
    prefix: "schematic_trace",
    shape,
    documentPath: location.documentPath,
  })
  context.circuitJson.push({
    type: "schematic_trace",
    schematic_trace_id: schematicTraceId,
    schematic_sheet_id: context.schematicSheetId,
    ...(shapeId(shape) ? { source_trace_id: shapeId(shape) } : {}),
    junctions: findWireJunctions({ context, points }),
    edges: createEdges(points),
  })
}

function convertBus({
  context,
  shape,
  location,
}: {
  context: SchematicConversionContext
  shape: EasyEdaBus
  location: ShapeConversionLocation
}) {
  const points = shape.points.map(convertEasyEdaPoint)
  if (points.length < 2) {
    reportInvalidGeometry({ context, shape, location })
    return
  }
  const stroke = readStrokeStyle({
    shape,
    startIndex: 1,
    fallbackColor: "#0000ff",
  })
  context.circuitJson.push({
    type: "schematic_path",
    schematic_path_id: reserveCircuitElementId({
      context,
      prefix: "schematic_path",
      shape,
      documentPath: location.documentPath,
    }),
    schematic_sheet_id: context.schematicSheetId,
    ...symbolFields(location),
    points,
    stroke_color: stroke.color,
    stroke_width: stroke.width,
    is_filled: false,
    is_dashed: false,
  })
}

function convertBusEntry({
  context,
  shape,
  location,
}: {
  context: SchematicConversionContext
  shape: EasyEdaBusEntry
  location: ShapeConversionLocation
}) {
  const startX = shape.startX
  const startY = shape.startY
  const endX = shape.endX
  const endY = shape.endY
  if (
    !isFiniteNumber(startX) ||
    !isFiniteNumber(startY) ||
    !isFiniteNumber(endX) ||
    !isFiniteNumber(endY)
  ) {
    reportInvalidGeometry({ context, shape, location })
    return
  }
  const start = convertEasyEdaPoint({ x: startX, y: startY })
  const end = convertEasyEdaPoint({ x: endX, y: endY })
  const stroke = readStrokeStyle({
    shape,
    startIndex: 5,
    fallbackColor: "#0000ff",
  })
  context.circuitJson.push({
    type: "schematic_line",
    schematic_line_id: reserveCircuitElementId({
      context,
      prefix: "schematic_line",
      shape,
      documentPath: location.documentPath,
    }),
    schematic_sheet_id: context.schematicSheetId,
    ...symbolFields(location),
    x1: start.x,
    y1: start.y,
    x2: end.x,
    y2: end.y,
    stroke_width: stroke.width,
    color: stroke.color,
    is_dashed: false,
  })
}

function convertLine({
  context,
  shape,
  location,
}: {
  context: SchematicConversionContext
  shape: EasyEdaLine
  location: ShapeConversionLocation
}) {
  const x1 = shape.x1
  const y1 = shape.y1
  const x2 = shape.x2
  const y2 = shape.y2
  if (
    !isFiniteNumber(x1) ||
    !isFiniteNumber(y1) ||
    !isFiniteNumber(x2) ||
    !isFiniteNumber(y2)
  ) {
    reportInvalidGeometry({ context, shape, location })
    return
  }
  const start = convertEasyEdaPoint({ x: x1, y: y1 })
  const end = convertEasyEdaPoint({ x: x2, y: y2 })
  const stroke = readStrokeStyle({
    shape,
    startIndex: 4,
    fallbackColor: "#880000",
  })
  context.circuitJson.push({
    type: "schematic_line",
    schematic_line_id: reserveCircuitElementId({
      context,
      prefix: "schematic_line",
      shape,
      documentPath: location.documentPath,
    }),
    schematic_sheet_id: context.schematicSheetId,
    ...symbolFields(location),
    x1: start.x,
    y1: start.y,
    x2: end.x,
    y2: end.y,
    stroke_width: stroke.width,
    color: stroke.color,
    is_dashed: false,
  })
}

function convertRectangle({
  context,
  shape,
  location,
}: {
  context: SchematicConversionContext
  shape: EasyEdaRectangle
  location: ShapeConversionLocation
}) {
  const x = shape.x
  const y = shape.y
  const width = shape.width
  const height = shape.height
  if (
    !isFiniteNumber(x) ||
    !isFiniteNumber(y) ||
    !isFiniteNumber(width) ||
    !isFiniteNumber(height)
  ) {
    reportInvalidGeometry({ context, shape, location })
    return
  }
  const center = convertEasyEdaPoint({
    x: x + width / 2,
    y: y + height / 2,
  })
  const stroke = readStrokeStyle({
    shape,
    startIndex: 6,
    fallbackColor: "#880000",
  })
  const fillColor = readFillColor(shape.fields[9])
  context.circuitJson.push({
    type: "schematic_rect",
    schematic_rect_id: reserveCircuitElementId({
      context,
      prefix: "schematic_rect",
      shape,
      documentPath: location.documentPath,
    }),
    schematic_sheet_id: context.schematicSheetId,
    ...symbolFields(location),
    center,
    width: convertEasyEdaLength(width),
    height: convertEasyEdaLength(height),
    rotation: 0,
    stroke_width: stroke.width,
    color: stroke.color,
    is_filled: fillColor !== undefined,
    ...(fillColor ? { fill_color: fillColor } : {}),
    is_dashed: false,
  })
}

function convertCircle({
  context,
  shape,
  location,
}: {
  context: SchematicConversionContext
  shape: EasyEdaCircle
  location: ShapeConversionLocation
}) {
  const x = shape.x
  const y = shape.y
  const radius = shape.radius
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(radius)) {
    reportInvalidGeometry({ context, shape, location })
    return
  }
  const stroke = readStrokeStyle({
    shape,
    startIndex: 3,
    fallbackColor: "#880000",
  })
  const fillColor = readFillColor(shape.fields[6])
  context.circuitJson.push({
    type: "schematic_circle",
    schematic_circle_id: reserveCircuitElementId({
      context,
      prefix: "schematic_circle",
      shape,
      documentPath: location.documentPath,
    }),
    schematic_sheet_id: context.schematicSheetId,
    ...symbolFields(location),
    center: convertEasyEdaPoint({ x, y }),
    radius: convertEasyEdaLength(radius),
    stroke_width: stroke.width,
    color: stroke.color,
    is_filled: fillColor !== undefined,
    ...(fillColor ? { fill_color: fillColor } : {}),
    is_dashed: false,
  })
}

function createEllipsePoints({
  centerX,
  centerY,
  radiusX,
  radiusY,
}: {
  centerX: number
  centerY: number
  radiusX: number
  radiusY: number
}) {
  const points: Point[] = []
  const segmentCount = 64
  for (let index = 0; index <= segmentCount; index += 1) {
    const angle = (index / segmentCount) * Math.PI * 2
    points.push(
      convertEasyEdaPoint({
        x: centerX + Math.cos(angle) * radiusX,
        y: centerY + Math.sin(angle) * radiusY,
      }),
    )
  }
  return points
}

function convertEllipse({
  context,
  shape,
  location,
}: {
  context: SchematicConversionContext
  shape: EasyEdaEllipse
  location: ShapeConversionLocation
}) {
  const x = shape.x
  const y = shape.y
  const radiusX = shape.radiusX
  const radiusY = shape.radiusY
  if (
    !isFiniteNumber(x) ||
    !isFiniteNumber(y) ||
    !isFiniteNumber(radiusX) ||
    !isFiniteNumber(radiusY)
  ) {
    reportInvalidGeometry({ context, shape, location })
    return
  }
  const stroke = readStrokeStyle({
    shape,
    startIndex: 4,
    fallbackColor: "#880000",
  })
  const fillColor = readFillColor(shape.fields[7])
  context.circuitJson.push({
    type: "schematic_path",
    schematic_path_id: reserveCircuitElementId({
      context,
      prefix: "schematic_path",
      shape,
      documentPath: location.documentPath,
    }),
    schematic_sheet_id: context.schematicSheetId,
    ...symbolFields(location),
    points: createEllipsePoints({
      centerX: x,
      centerY: y,
      radiusX,
      radiusY,
    }),
    stroke_color: stroke.color,
    stroke_width: stroke.width,
    is_filled: fillColor !== undefined,
    ...(fillColor ? { fill_color: fillColor } : {}),
    is_dashed: false,
  })
}

function convertPointPath({
  context,
  shape,
  location,
  points,
  closePath,
}: {
  context: SchematicConversionContext
  shape: EasyEdaShape
  location: ShapeConversionLocation
  points: Point[]
  closePath: boolean
}) {
  if (points.length < 2) {
    reportInvalidGeometry({ context, shape, location })
    return
  }
  const stroke = readStrokeStyle({
    shape,
    startIndex: 1,
    fallbackColor: "#880000",
  })
  const fillColor = closePath ? readFillColor(shape.fields[4]) : undefined
  const firstPoint = points[0]
  const circuitPoints =
    closePath && firstPoint ? [...points, firstPoint] : points
  context.circuitJson.push({
    type: "schematic_path",
    schematic_path_id: reserveCircuitElementId({
      context,
      prefix: "schematic_path",
      shape,
      documentPath: location.documentPath,
    }),
    schematic_sheet_id: context.schematicSheetId,
    ...symbolFields(location),
    points: circuitPoints,
    stroke_color: stroke.color,
    stroke_width: stroke.width,
    is_filled: fillColor !== undefined,
    ...(fillColor ? { fill_color: fillColor } : {}),
    is_dashed: false,
  })
}

function convertSvgPathShape({
  context,
  shape,
  location,
}: {
  context: SchematicConversionContext
  shape: EasyEdaPath | EasyEdaArc
  location: ShapeConversionLocation
}) {
  const pathData = shape.path
  if (!pathData) {
    reportInvalidGeometry({ context, shape, location })
    return
  }
  const parsed = parseEasyEdaSvgPath(pathData)
  convertPointPath({
    context,
    shape,
    location,
    points: parsed.points.map(convertEasyEdaPoint),
    closePath: parsed.closed,
  })
}

function convertText({
  context,
  shape,
  location,
}: {
  context: SchematicConversionContext
  shape: EasyEdaSchematicText
  location: ShapeConversionLocation
}) {
  const x = shape.x
  const y = shape.y
  const text = shape.text
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || text === undefined) {
    reportInvalidGeometry({ context, shape, location })
    return
  }
  const alignment = shape.fields[0]
  const anchor =
    alignment === "C"
      ? "bottom_center"
      : alignment === "R"
        ? "bottom_right"
        : "bottom_left"
  context.circuitJson.push({
    type: "schematic_text",
    schematic_text_id: reserveCircuitElementId({
      context,
      prefix: "schematic_text",
      shape,
      documentPath: location.documentPath,
    }),
    schematic_sheet_id: context.schematicSheetId,
    ...symbolFields(location),
    text,
    font_size: readEasyEdaFontSize({
      shape,
      fieldIndex: 6,
      fallbackSize: 9,
    }),
    position: convertEasyEdaPoint({ x, y }),
    rotation: Number(shape.fields[3]) || 0,
    anchor,
    color: shape.fields[4] || "#000080",
  })
}

function convertNetLabel({
  context,
  shape,
  location,
}: {
  context: SchematicConversionContext
  shape: EasyEdaNetLabel
  location: ShapeConversionLocation
}) {
  const x = shape.x
  const y = shape.y
  const name = shape.name
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !name) {
    reportInvalidGeometry({ context, shape, location })
    return
  }
  context.circuitJson.push({
    type: "schematic_net_label",
    schematic_net_label_id: reserveCircuitElementId({
      context,
      prefix: "schematic_net_label",
      shape,
      documentPath: location.documentPath,
    }),
    schematic_sheet_id: context.schematicSheetId,
    source_net_id: name,
    center: convertEasyEdaPoint({ x, y }),
    anchor_side: "left",
    text: name,
    is_movable: true,
  })
}

function convertNoConnect({
  context,
  shape,
  location,
}: {
  context: SchematicConversionContext
  shape: EasyEdaNoConnect
  location: ShapeConversionLocation
}) {
  const x = shape.x
  const y = shape.y
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
    reportInvalidGeometry({ context, shape, location })
    return
  }
  const center = convertEasyEdaPoint({ x, y })
  const armLength = convertEasyEdaLength(3)
  const baseId = reserveCircuitElementId({
    context,
    prefix: "schematic_line",
    shape,
    documentPath: location.documentPath,
  })
  const common = {
    type: "schematic_line" as const,
    schematic_sheet_id: context.schematicSheetId,
    ...symbolFields(location),
    stroke_width: convertEasyEdaLength(1),
    color: "#cc0000",
    is_dashed: false,
  }
  context.circuitJson.push(
    {
      ...common,
      schematic_line_id: `${baseId}_forward`,
      x1: center.x - armLength,
      y1: center.y - armLength,
      x2: center.x + armLength,
      y2: center.y + armLength,
    },
    {
      ...common,
      schematic_line_id: `${baseId}_back`,
      x1: center.x + armLength,
      y1: center.y - armLength,
      x2: center.x - armLength,
      y2: center.y + armLength,
    },
  )
}

function convertLibrary({
  context,
  shape,
  location,
}: {
  context: SchematicConversionContext
  shape: EasyEdaLibrary
  location: ShapeConversionLocation
}) {
  const schematicSymbolId = reserveCircuitElementId({
    context,
    prefix: "schematic_symbol",
    shape,
    documentPath: location.documentPath,
  })
  context.circuitJson.push({
    type: "schematic_symbol",
    schematic_symbol_id: schematicSymbolId,
    name:
      shape.customAttributes.get("package") ??
      shape.customAttributes.get("name") ??
      schematicSymbolId,
  })
  for (const [childIndex, child] of shape.children.entries()) {
    convertSchematicShape({
      context,
      shape: child,
      location: {
        documentPath: [...location.documentPath, "children", childIndex],
        schematicSymbolId,
      },
    })
  }
}

export function convertSchematicShape({
  context,
  shape,
  location,
}: {
  context: SchematicConversionContext
  shape: EasyEdaShape
  location: ShapeConversionLocation
}) {
  if (shape instanceof EasyEdaLibrary) {
    convertLibrary({ context, shape, location })
  } else if (shape instanceof EasyEdaWire) {
    convertWire({ context, shape, location })
  } else if (shape instanceof EasyEdaJunction) {
    return
  } else if (shape instanceof EasyEdaBus) {
    convertBus({ context, shape, location })
  } else if (shape instanceof EasyEdaBusEntry) {
    convertBusEntry({ context, shape, location })
  } else if (shape instanceof EasyEdaLine) {
    convertLine({ context, shape, location })
  } else if (shape instanceof EasyEdaRectangle) {
    convertRectangle({ context, shape, location })
  } else if (shape instanceof EasyEdaCircle) {
    convertCircle({ context, shape, location })
  } else if (shape instanceof EasyEdaEllipse) {
    convertEllipse({ context, shape, location })
  } else if (shape instanceof EasyEdaPolyline) {
    convertPointPath({
      context,
      shape,
      location,
      points: shape.points.map(convertEasyEdaPoint),
      closePath: false,
    })
  } else if (shape instanceof EasyEdaPolygon) {
    convertPointPath({
      context,
      shape,
      location,
      points: shape.points.map(convertEasyEdaPoint),
      closePath: true,
    })
  } else if (shape instanceof EasyEdaPath || shape instanceof EasyEdaArc) {
    convertSvgPathShape({ context, shape, location })
  } else if (shape instanceof EasyEdaSchematicText) {
    convertText({ context, shape, location })
  } else if (shape instanceof EasyEdaNetLabel) {
    convertNetLabel({ context, shape, location })
  } else if (shape instanceof EasyEdaNoConnect) {
    convertNoConnect({ context, shape, location })
  } else {
    reportShapeDiagnostic({
      context,
      shape,
      documentPath: location.documentPath,
      code: "unsupported-shape",
      message: `EasyEDA ${shape.token} conversion is not implemented yet`,
    })
  }
}
