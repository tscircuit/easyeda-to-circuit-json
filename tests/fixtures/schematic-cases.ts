export interface SchematicFixtureCase {
  name: string
  source: string
}

function createEasyEdaSchematicSource({
  shapes,
  bounds = { x: 0, y: 0, width: 150, height: 110 },
}: {
  shapes: string[]
  bounds?: { x: number; y: number; width: number; height: number }
}) {
  return JSON.stringify(
    {
      head: "1~1.11.3",
      canvas: "CA~240~180~#FFFFFF~yes~#CCCCCC~10~240~180~line~10~pixel~5",
      shape: shapes,
      BBox: bounds,
    },
    null,
    2,
  )
}

export const schematicFixtureCases: SchematicFixtureCase[] = [
  {
    name: "wires-and-junctions",
    source: createEasyEdaSchematicSource({
      shapes: [
        "W~20 25 75 25 75 85 130 85~#008800~1~0~none~gge-wire-a",
        "W~75 25 130 25 130 85~#008800~1~0~none~gge-wire-b",
        "J~75~25~2.5~#CC0000~gge-junction-a",
        "J~130~85~2.5~#CC0000~gge-junction-b",
      ],
    }),
  },
  {
    name: "text-and-net-labels",
    source: createEasyEdaSchematicSource({
      shapes: [
        "T~L~25~38~0~#0000FF~Arial~11pt~~~~comment~Sensor Hub~1~start~gge-text-left",
        "T~C~75~62~0~#880000~Arial~9pt~~~~comment~U1 / RP2040~1~middle~gge-text-center",
        "N~28~88~0~#000080~SDA~gge-net-sda~start~30~88~Verdana~7pt",
        "N~98~88~0~#000080~SCL~gge-net-scl~start~100~88~Verdana~7pt",
      ],
    }),
  },
  {
    name: "rectangles",
    source: createEasyEdaSchematicSource({
      shapes: [
        "R~18~18~0~0~48~34~#880000~1~0~none~gge-rect-outline",
        "R~82~18~0~0~48~34~#008080~2~0~#E8F4F4~gge-rect-filled",
        "R~40~68~0~0~68~24~#000080~1~0~none~gge-rect-wide",
      ],
    }),
  },
  {
    name: "circles-and-ellipses",
    source: createEasyEdaSchematicSource({
      shapes: [
        "C~42~52~24~#880000~1~0~none~gge-circle-outline",
        "C~104~52~18~#008080~2~0~#DFF6EC~gge-circle-filled",
        "E~75~88~42~12~#000080~1~0~none~gge-ellipse-wide",
      ],
    }),
  },
  {
    name: "lines-and-bus-entries",
    source: createEasyEdaSchematicSource({
      shapes: [
        "L~20~20~130~20~#880000~1~0~none~gge-line-horizontal",
        "L~20~36~130~96~#008080~2~0~none~gge-line-diagonal",
        "BE~entry~35~82~50~67~#0000FF~2~0~none~gge-bus-entry-a",
        "BE~entry~100~82~115~67~#0000FF~2~0~none~gge-bus-entry-b",
      ],
    }),
  },
  {
    name: "polylines",
    source: createEasyEdaSchematicSource({
      shapes: [
        "PL~18 86 38 42 58 86 78 42 98 86 128 42~#880000~2~0~none~gge-polyline-zigzag",
        "PL~20 20 42 30 64 20 86 30 108 20 130 30~#008080~1~0~none~gge-polyline-wave",
      ],
    }),
  },
  {
    name: "polygons",
    source: createEasyEdaSchematicSource({
      shapes: [
        "PG~22 88 48 30 74 88~#880000~2~0~#F6E4CF~gge-polygon-triangle",
        "PG~88 32 126 32 138 62 107 90 76 62~#008080~1~0~#DFF6EC~gge-polygon-pentagon",
      ],
    }),
  },
  {
    name: "buses-and-no-connects",
    source: createEasyEdaSchematicSource({
      shapes: [
        "B~18 26 50 26 50 84 130 84~#0000FF~2~0~none~gge-bus-main",
        "BE~entry~50~48~66~64~#0000FF~2~0~none~gge-bus-entry-main",
        "O~78~64~gge-no-connect-a",
        "O~112~46~gge-no-connect-b",
      ],
    }),
  },
  {
    name: "nested-library-graphics",
    source: createEasyEdaSchematicSource({
      shapes: [
        "LIB~75~55~package`SENSOR_BLOCK`name`Sensor Block`~~0~gge-library#@$R~38~28~0~0~74~54~#880000~2~0~#FFFACD~gge-library-body#@$C~56~55~10~#008080~1~0~none~gge-library-circle#@$PL~72 68 82 42 92 68~#880000~2~0~none~gge-library-mark#@$T~C~75~76~0~#000080~Arial~8pt~~~~comment~SENSOR~1~middle~gge-library-text",
      ],
    }),
  },
  {
    name: "combined-schematic-primitives",
    source: createEasyEdaSchematicSource({
      shapes: [
        "R~54~34~0~0~46~38~#880000~2~0~#FFFACD~gge-combined-body",
        "T~C~77~56~0~#000080~Arial~8pt~~~~comment~MCU~1~middle~gge-combined-label",
        "W~18 44 54 44~#008800~1~0~none~gge-combined-wire-left",
        "W~100 44 134 44 134 84 77 84 77 72~#008800~1~0~none~gge-combined-wire-right",
        "J~77~84~2.5~#CC0000~gge-combined-junction",
        "N~22~44~0~#000080~SDA~gge-combined-net~start~24~44~Verdana~7pt",
        "C~120~68~8~#880000~1~0~none~gge-combined-circle",
        "O~38~82~gge-combined-no-connect",
      ],
    }),
  },
]

export const unsupportedShapeSource = createEasyEdaSchematicSource({
  shapes: ["PI~M20,20 A10,10 0 0 1 40,20~#880000~1~0~none~gge-pie-unsupported"],
})

export const pathAndArcSource = createEasyEdaSchematicSource({
  shapes: [
    "PT~M20,20 L120,80~#880000~1~0~none~gge-path-line",
    "A~M40,60 A20,20 0 0 1 80,60~#880000~1~0~none~gge-path-arc",
  ],
})
