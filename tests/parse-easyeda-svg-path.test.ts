import { expect, test } from "bun:test"
import { parseEasyEdaSvgPath } from "lib/schematic/parse-easyeda-svg-path"

test("parses EasyEDA move/line paths", () => {
  expect(parseEasyEdaSvgPath("M20,20 L120,80")).toEqual({
    closed: false,
    points: [
      { x: 20, y: 20 },
      { x: 120, y: 80 },
    ],
  })
})

test("samples EasyEDA SVG arcs instead of dropping them", () => {
  const parsed = parseEasyEdaSvgPath("M40,60 A20,20 0 0 1 80,60")
  expect(parsed.closed).toBe(false)
  expect(parsed.points[0]).toEqual({ x: 40, y: 60 })
  expect(parsed.points.at(-1)).toEqual({ x: 80, y: 60 })
  expect(parsed.points.length).toBeGreaterThan(3)
})
