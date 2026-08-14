/** Core grid and equipment definitions for the industrial build system. */

export type Rotation = 0 | 90 | 180 | 270

export interface GridPos {
  x: number
  z: number
}

export type BuildType =
  | 'source'
  | 'conveyor'
  | 'machine'
  | 'oreMiner'
  | 'smelter'
  | 'press'
  | 'assembler'
  | 'inspection'
  | 'washing'
  | 'agv'
  | 'storage'
  | 'splitter'
  | 'merger'

export type ObjectRole = 'source' | 'conveyor' | 'machine' | 'storage'
export type EquipmentCategory = '采集' | '加工' | '装配' | '物流'

export interface Footprint {
  w: number
  d: number
}

export interface ObjectDef {
  type: BuildType
  role: ObjectRole
  category: EquipmentCategory
  label: string
  subtitle: string
  function: string
  model: string
  assetPath?: string
  assetKind?: 'center-split' | 'detailed-process'
  footprint: Footprint
  color: string
  accent: string
  height: number
  throughput: string
  power: string
  inputs: string[]
  outputs: string[]
  /** Local machine ports. Front follows rotation direction; back is the inlet. */
  inputPort: PortSide | null
  outputPort: PortSide | null
}

export type PortSide = 'front' | 'back' | 'left' | 'right'

export interface FactoryObject {
  id: string
  type: BuildType
  pos: GridPos
  rotation: Rotation
  recipeId?: string
  itemId?: string
}

const equipment = (
  type: BuildType,
  role: ObjectRole,
  category: EquipmentCategory,
  label: string,
  subtitle: string,
  functionText: string,
  model: string,
  footprint: Footprint,
  color: string,
  accent: string,
  height: number,
  throughput: string,
  power: string,
  inputs: string[],
  outputs: string[],
): ObjectDef => ({
  type,
  role,
  category,
  label,
  subtitle,
  function: functionText,
  model,
  footprint,
  color,
  accent,
  height,
  throughput,
  power,
  inputs,
  outputs,
  inputPort: role === 'source' ? null : 'back',
  outputPort: 'front',
})

export const OBJECT_DEFS: Record<BuildType, ObjectDef> = {
  source: equipment('source', 'source', '采集', '原料来料站', 'MATERIAL INFEED Mk.I', '模拟供应商来料与收货口，将钢坯、铝坯和标准件送入工厂。', 'Incoming material bay', { w: 1, d: 1 }, '#d69e24', '#f2c94c', 0.9, '60 / min', '0.2 kW', ['供应商来料'], ['钢坯 / 铝坯']),
  oreMiner: equipment('oreMiner', 'storage', '采集', '原料仓储架', 'RAW MATERIAL RACK Mk.I', '按批次存放钢材、铝材和外购件，并向上线工位供料。', 'Pallet rack', { w: 2, d: 2 }, '#c68a21', '#f0b52c', 1.5, '90 / min', '1.2 kW', ['钢坯 / 铝坯'], ['待加工毛坯']),
  conveyor: equipment('conveyor', 'conveyor', '物流', '滚筒输送线', 'ROLLER CONVEYOR Mk.I', '以滚筒输送托盘和周转箱，连接工位、缓存区和检验区。', 'Industrial roller conveyor', { w: 1, d: 1 }, '#5b9b99', '#82d0c7', 0.35, '120 / min', '1.5 kW', ['托盘 / 周转箱'], ['托盘 / 周转箱']),
  splitter: equipment('splitter', 'conveyor', '物流', '三向分流器', 'FLOW SPLITTER Mk.I', '将一条上游线路拆分为三条可控物流支路。', 'Three-way hub', { w: 1, d: 1 }, '#4d8f8f', '#83d5cc', 0.52, '180 / min', '2.4 kW', ['物料批次'], ['物料批次 × 3']),
  merger: equipment('merger', 'conveyor', '物流', '汇流节点', 'FLOW MERGER Mk.I', '汇聚多条线路，为加工设备提供稳定进料。', 'Confluence hub', { w: 1, d: 1 }, '#4d8f8f', '#83d5cc', 0.52, '180 / min', '2.4 kW', ['物料批次 × 3'], ['物料批次']),
  machine: equipment('machine', 'machine', '加工', '通用工艺工作站', 'GENERAL PROCESS CELL Mk.I', '面向钻孔、攻丝、去毛刺等离散工艺的通用工作站。', 'High-detail imported process asset', { w: 1, d: 1 }, '#4b9ca4', '#72d4d2', 1.2, '30 / min', '8 kW', ['工艺输入'], ['工艺输出']),
  smelter: equipment('smelter', 'machine', '加工', '数控加工中心', 'CNC MACHINING CENTER Mk.I', '完成铣削、钻孔和攻丝，输出带有质量状态的机加工件。', 'Enclosed CNC cell', { w: 3, d: 2 }, '#657782', '#d2ad50', 1.9, '18 / min', '22 kW', ['钢坯 / 铝坯'], ['机加工壳体']),
  press: equipment('press', 'machine', '加工', '液压冲压机', 'HYDRAULIC PRESS Mk.I', '使用模具完成板材冲压和折弯，配置安全光栅与液压站。', 'Hydraulic forming press', { w: 2, d: 2 }, '#677e89', '#d2ad50', 1.6, '36 / min', '24 kW', ['板材'], ['冲压壳体']),
  assembler: equipment('assembler', 'machine', '装配', '机器人装配单元', 'ROBOTIC ASSEMBLY CELL Mk.I', '由六轴机器人、夹具和扭矩工具组成的自动装配单元。', 'ABB / IRB robotic cell', { w: 3, d: 3 }, '#5d7185', '#e4b52b', 1.85, '12 / min', '28 kW', ['机加工件', '标准件'], ['电机总成']),
  inspection: equipment('inspection', 'machine', '装配', '机器视觉检测站', 'VISION INSPECTION CELL Mk.I', '对尺寸、外观和装配缺陷进行在线检测，并将结果写入质量追溯。', 'Camera + light tunnel', { w: 2, d: 2 }, '#536f72', '#7ed4d1', 1.55, '20 / min', '6 kW', ['待检产品'], ['合格品 / 不合格品']),
  washing: equipment('washing', 'machine', '加工', '清洗去毛刺单元', 'DEBURR & WASH CELL Mk.I', '去除切削毛刺并清洗切削液，作为机加工后的标准工序。', 'Wash and deburr cell', { w: 2, d: 2 }, '#5c7477', '#71c8c0', 1.45, '18 / min', '16 kW', ['机加工件'], ['洁净零件']),
  agv: equipment('agv', 'storage', '物流', 'AGV 叉车搬运车', 'AGV FORKLIFT Mk.I', '在原料库、线边库和成品库之间执行托盘搬运任务。', 'Autonomous forklift', { w: 2, d: 2 }, '#6e7370', '#dfb842', 1.35, '8 trips / h', '5 kW', ['托盘任务'], ['托盘任务']),
  storage: equipment('storage', 'storage', '物流', '成品缓存仓', 'FINISHED GOODS BUFFER Mk.I', '按批次缓存已检验产品，等待入库或出货。', 'Pallet buffer rack', { w: 2, d: 2 }, '#6c7674', '#d7b44a', 1.35, '240 / min', '4 kW', ['合格品'], ['待出货托盘']),
}

// The material infeed is a compound station: an unloading buffer, robot arm,
// and a short belt are placed inside one 3 x 2 m build footprint.
OBJECT_DEFS.source.footprint = { w: 3, d: 2 }
OBJECT_DEFS.source.height = 1.35
OBJECT_DEFS.source.model = 'Robotic material infeed station'

/** Assets extracted from the centre reference cell and exposed in the build catalogue. */
export const BUILD_ASSET_PATHS: Partial<Record<BuildType, string>> = {
  machine: '/models/industrial/realvirtual_high_detail.glb',
  conveyor: '/models/industrial/roller_conveyor_segment.glb',
  smelter: '/models/industrial/cnc_machining_center.glb',
  assembler: '/models/panda/panda.urdf + robot_cell.glb / open cell, no fence',
  inspection: '/models/industrial/sensor_pack.glb + control_cabinet.glb',
  press: '/models/industrial/hydraulic_press_detail.glb',
  washing: '/models/industrial/wash_deburr_detail.glb',
  storage: '/models/industrial/pallet_buffer_detail.glb',
  splitter: '/models/industrial/flow_node_detail.glb',
  merger: '/models/industrial/flow_node_detail.glb',
}

const CENTER_SPLIT_TYPES = new Set<BuildType>(['machine', 'conveyor', 'smelter', 'assembler', 'inspection'])

for (const [type, assetPath] of Object.entries(BUILD_ASSET_PATHS)) {
  if (assetPath) {
    OBJECT_DEFS[type as BuildType].assetPath = assetPath
    OBJECT_DEFS[type as BuildType].assetKind = CENTER_SPLIT_TYPES.has(type as BuildType) ? 'center-split' : 'detailed-process'
  }
}

export const EQUIPMENT_ORDER: BuildType[] = [
  'source', 'oreMiner', 'smelter', 'press', 'washing', 'assembler', 'inspection', 'conveyor', 'splitter', 'merger', 'agv', 'storage', 'machine',
]

export const BUILD_BOUND = 24

export function objectRole(type: BuildType): ObjectRole {
  return OBJECT_DEFS[type].role
}

export function isMachineType(type: BuildType): boolean {
  return objectRole(type) === 'machine'
}

export function isTransportType(type: BuildType): boolean {
  const role = objectRole(type)
  return role === 'conveyor' || role === 'storage'
}
