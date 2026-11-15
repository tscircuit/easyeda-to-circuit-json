import type { Point } from "circuit-json"

const COMMAND_PARAMETER_COUNTS: Record<string, number> = {
  A: 7,
  C: 6,
  H: 1,
  L: 2,
  M: 2,
  Q: 4,
  S: 4,
  T: 2,
  V: 1,
  Z: 0,
}

export interface ParsedEasyEdaPath {
  points: Point[]
  closed: boolean
}

function tokenizeSvgPath(pathData: string): string[] {
  return (
    pathData.match(
      /[AaCcHhLlMmQqSsTtVvZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g,
    ) ?? []
  )
}

function sampleSvgArc({
  start,
  rx,
  ry,
  xAxisRotationDegrees,
  largeArc,
  sweep,
  end,
}: {
  start: Point
  rx: number
  ry: number
  xAxisRotationDegrees: number
  largeArc: boolean
  sweep: boolean
  end: Point
}): Point[] {
  let radiusX = Math.abs(rx)
  let radiusY = Math.abs(ry)
  if (radiusX === 0 || radiusY === 0) return [end]

  const phi = (xAxisRotationDegrees * Math.PI) / 180
  const cosPhi = Math.cos(phi)
  const sinPhi = Math.sin(phi)
  const dx = (start.x - end.x) / 2
  const dy = (start.y - end.y) / 2
  const x1p = cosPhi * dx + sinPhi * dy
  const y1p = -sinPhi * dx + cosPhi * dy

  const lambda =
    (x1p * x1p) / (radiusX * radiusX) + (y1p * y1p) / (radiusY * radiusY)
  if (lambda > 1) {
    const scale = Math.sqrt(lambda)
    radiusX *= scale
    radiusY *= scale
  }

  const rxSq = radiusX * radiusX
  const rySq = radiusY * radiusY
  const x1pSq = x1p * x1p
  const y1pSq = y1p * y1p
  const numerator = Math.max(0, rxSq * rySq - rxSq * y1pSq - rySq * x1pSq)
  const denominator = rxSq * y1pSq + rySq * x1pSq
  const coefficient =
    (largeArc === sweep ? -1 : 1) * Math.sqrt(numerator / denominator || 0)
  const cxp = (coefficient * (radiusX * y1p)) / radiusY
  const cyp = (coefficient * -(radiusY * x1p)) / radiusX
  const center = {
    x: cosPhi * cxp - sinPhi * cyp + (start.x + end.x) / 2,
    y: sinPhi * cxp + cosPhi * cyp + (start.y + end.y) / 2,
  }

  const startVector = {
    x: (x1p - cxp) / radiusX,
    y: (y1p - cyp) / radiusY,
  }
  const endVector = {
    x: (-x1p - cxp) / radiusX,
    y: (-y1p - cyp) / radiusY,
  }
  const startAngle = Math.atan2(startVector.y, startVector.x)
  let deltaAngle =
    Math.atan2(endVector.y, endVector.x) -
    Math.atan2(startVector.y, startVector.x)
  if (sweep && deltaAngle < 0) deltaAngle += Math.PI * 2
  if (!sweep && deltaAngle > 0) deltaAngle -= Math.PI * 2

  const segmentCount = Math.max(2, Math.ceil(Math.abs(deltaAngle) * 8))
  const points: Point[] = []
  for (let index = 1; index < segmentCount; index += 1) {
    const angle = startAngle + (deltaAngle * index) / segmentCount
    const x = radiusX * Math.cos(angle)
    const y = radiusY * Math.sin(angle)
    points.push({
      x: cosPhi * x - sinPhi * y + center.x,
      y: sinPhi * x + cosPhi * y + center.y,
    })
  }
  points.push(end)
  return points
}

/** Decode EasyEDA schematic SVG path data into polyline points. */
export function parseEasyEdaSvgPath(pathData: string): ParsedEasyEdaPath {
  const tokens = tokenizeSvgPath(pathData)
  const points: Point[] = []
  let closed = false
  let command = ""
  let tokenIndex = 0
  let current: Point = { x: 0, y: 0 }
  let subpathStart: Point = { x: 0, y: 0 }

  const pushPoint = (point: Point) => {
    const previous = points[points.length - 1]
    if (previous && previous.x === point.x && previous.y === point.y) return
    points.push(point)
    current = point
  }

  while (tokenIndex < tokens.length) {
    const token = tokens[tokenIndex]
    if (!token) break
    if (/^[A-Za-z]$/.test(token)) {
      command = token
      tokenIndex += 1
      if (command.toUpperCase() === "Z") {
        closed = true
        pushPoint({ ...subpathStart })
        continue
      }
    }
    if (!command) break

    const upper = command.toUpperCase()
    const parameterCount = COMMAND_PARAMETER_COUNTS[upper]
    if (parameterCount === undefined) break
    const values = tokens
      .slice(tokenIndex, tokenIndex + parameterCount)
      .map(Number)
    if (
      values.length < parameterCount ||
      values.some((value) => !Number.isFinite(value))
    ) {
      break
    }
    tokenIndex += parameterCount
    const relative = command === command.toLowerCase()

    if (upper === "M" || upper === "L") {
      const point = {
        x: relative ? current.x + values[0]! : values[0]!,
        y: relative ? current.y + values[1]! : values[1]!,
      }
      if (upper === "M" && points.length === 0) subpathStart = point
      if (upper === "M") subpathStart = point
      pushPoint(point)
      command = relative ? "l" : "L"
    } else if (upper === "H") {
      pushPoint({
        x: relative ? current.x + values[0]! : values[0]!,
        y: current.y,
      })
    } else if (upper === "V") {
      pushPoint({
        x: current.x,
        y: relative ? current.y + values[0]! : values[0]!,
      })
    } else if (upper === "A") {
      const end = {
        x: relative ? current.x + values[5]! : values[5]!,
        y: relative ? current.y + values[6]! : values[6]!,
      }
      for (const point of sampleSvgArc({
        start: current,
        rx: values[0]!,
        ry: values[1]!,
        xAxisRotationDegrees: values[2]!,
        largeArc: values[3] === 1,
        sweep: values[4] === 1,
        end,
      })) {
        pushPoint(point)
      }
    } else if (upper === "C") {
      pushPoint({
        x: relative ? current.x + values[4]! : values[4]!,
        y: relative ? current.y + values[5]! : values[5]!,
      })
    } else if (upper === "Q" || upper === "S") {
      pushPoint({
        x: relative ? current.x + values[2]! : values[2]!,
        y: relative ? current.y + values[3]! : values[3]!,
      })
    } else if (upper === "T") {
      pushPoint({
        x: relative ? current.x + values[0]! : values[0]!,
        y: relative ? current.y + values[1]! : values[1]!,
      })
    }
  }

  return { points, closed }
}
