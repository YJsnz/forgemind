import type { FactoryObject, Rotation } from './types'

const unit = (
  id: string,
  type: FactoryObject['type'],
  x: number,
  z: number,
  rotation: Rotation,
  binding: Pick<FactoryObject, 'recipeId' | 'itemId'> = {},
): FactoryObject => ({ id, type, pos: { x, z }, rotation, ...binding })

/**
 * Base A-01 follows a real one-way factory flow rather than a symmetrical game
 * board: west receiving and raw supermarket, a straight machining spine,
 * line-side component feeders around the assembly cell, then eastbound QA,
 * packaging, finished-goods buffers and dispatch.
 */
export const BASE_A01_OBJECTS: FactoryObject[] = [
  // 01 Receiving -> inbound AGV -> raw supermarket -> housing machining.
  unit('a01_infeed_steel', 'source', -23, 1, 0, { itemId: 'item_steel_blank' }),
  unit('a01_agv_inbound', 'agv', -20, 1, 0),
  unit('a01_raw_material_rack', 'oreMiner', -18, 1, 0),
  unit('a01_cv_main_01', 'conveyor', -16, 1, 0),
  unit('a01_cv_main_02', 'conveyor', -15, 1, 0),
  unit('a01_cv_main_03', 'conveyor', -14, 1, 0),
  unit('a01_cnc_housing', 'smelter', -13, 1, 0, { recipeId: 'recipe_machining' }),
  unit('a01_cv_main_04', 'conveyor', -10, 1, 0),
  unit('a01_cv_main_05', 'conveyor', -9, 1, 0),
  unit('a01_wash_deburr', 'washing', -8, 1, 0, { recipeId: 'recipe_wash' }),
  unit('a01_cv_main_06', 'conveyor', -6, 1, 0),
  unit('a01_cv_main_07', 'conveyor', -5, 1, 0),
  unit('a01_housing_wip_buffer', 'storage', -4, 1, 0),
  unit('a01_cv_main_08', 'conveyor', -2, 1, 0),
  unit('a01_cv_main_09', 'conveyor', -1, 1, 0),
  unit('a01_cv_main_10', 'conveyor', 0, 1, 0),
  unit('a01_cv_main_11', 'conveyor', 1, 1, 0),
  unit('a01_cv_main_12', 'conveyor', 2, 1, 0),
  unit('a01_cv_main_13', 'conveyor', 3, 1, 0),

  // 02 North forming island: sheet receiving and press feed the assembly cell.
  unit('a01_infeed_sheet', 'source', 5, 10, 270, { itemId: 'item_steel_sheet' }),
  unit('a01_cv_sheet_01', 'conveyor', 5, 9, 270),
  unit('a01_cv_sheet_02', 'conveyor', 5, 8, 270),
  unit('a01_hydraulic_press', 'press', 5, 6, 270, { recipeId: 'recipe_stamping' }),
  unit('a01_cv_stamp_01', 'conveyor', 5, 5, 270),
  unit('a01_cv_stamp_02', 'conveyor', 5, 4, 270),
  unit('a01_cv_stamp_03', 'conveyor', 5, 3, 270),

  // 03 South electrical island: copper receiving and coil winding.
  unit('a01_infeed_copper', 'source', 5, -10, 90, { itemId: 'item_copper_wire' }),
  unit('a01_cv_copper_01', 'conveyor', 5, -7, 90),
  unit('a01_cv_copper_02', 'conveyor', 5, -6, 90),
  unit('a01_coil_winding', 'machine', 5, -5, 90, { recipeId: 'recipe_coil' }),
  unit('a01_cv_coil_01', 'conveyor', 5, -4, 90),
  unit('a01_cv_coil_02', 'conveyor', 5, -3, 90),
  unit('a01_cv_coil_03', 'conveyor', 5, -2, 90),
  unit('a01_cv_coil_04', 'conveyor', 5, -1, 90),

  // 04 Line-side kitting island. Fasteners are batched in sets of four before
  // they enter a dedicated rear assembly dock, avoiding mixed-lane starvation.
  unit('a01_infeed_fasteners', 'source', -8, -5, 0, { itemId: 'item_fastener' }),
  unit('a01_cv_fastener_01', 'conveyor', -5, -5, 0),
  unit('a01_cv_fastener_02', 'conveyor', -4, -5, 0),
  unit('a01_fastener_kitting', 'machine', -3, -5, 0, { recipeId: 'recipe_fastener_kit' }),
  unit('a01_cv_kit_01', 'conveyor', -2, -5, 0),
  unit('a01_cv_kit_02', 'conveyor', -1, -5, 0),
  unit('a01_cv_kit_03', 'conveyor', 0, -5, 0),
  unit('a01_cv_kit_04', 'conveyor', 1, -5, 0),
  unit('a01_cv_kit_05', 'conveyor', 2, -5, 0),
  unit('a01_cv_kit_corner_01', 'conveyor', 3, -5, 90),
  unit('a01_cv_kit_06', 'conveyor', 3, -4, 90),
  unit('a01_cv_kit_07', 'conveyor', 3, -3, 90),
  unit('a01_cv_kit_08', 'conveyor', 3, -2, 90),
  unit('a01_cv_kit_09', 'conveyor', 3, -1, 90),
  unit('a01_cv_kit_corner_02', 'conveyor', 3, 0, 0),

  // 05 Robot assembly -> vision inspection -> packaging -> quality routing.
  unit('a01_robotic_assembly', 'assembler', 4, 0, 0, { recipeId: 'recipe_motor' }),
  unit('a01_cv_quality_01', 'conveyor', 7, 1, 0),
  unit('a01_vision_inspection', 'inspection', 8, 1, 0, { recipeId: 'recipe_inspection' }),
  unit('a01_cv_quality_02', 'conveyor', 10, 1, 0),
  unit('a01_packaging_cell', 'machine', 11, 1, 0, { recipeId: 'recipe_packaging' }),
  unit('a01_quality_splitter', 'splitter', 12, 1, 0),
  unit('a01_cv_finished', 'conveyor', 13, 1, 0),
  unit('a01_finished_buffer', 'storage', 14, 1, 0),
  unit('a01_agv_outbound', 'agv', 16, 1, 0),
  unit('a01_cv_rework', 'conveyor', 12, 2, 90),
  unit('a01_rework_buffer', 'storage', 12, 3, 90),
  unit('a01_cv_quarantine', 'conveyor', 12, 0, 270),
  unit('a01_quarantine_buffer', 'storage', 12, -2, 270),

  // 06 Vehicles parked on the marked logistics aisle; these are visible fleet
  // capacity, not decorative machines embedded in the conveyor backbone.
  unit('a01_agv_logistics_01', 'agv', -12, -14, 0),
  unit('a01_agv_logistics_02', 'agv', 6, -14, 180),
]

export function createBaseA01Layout(): FactoryObject[] {
  return BASE_A01_OBJECTS.map((object) => ({ ...object, pos: { ...object.pos } }))
}
