/**
 * 检验项目统一目录：成品检验的登记、复检、批量判定以及稳定性考察等所有入口，
 * 都从这一份目录读取，任何页面不得各自维护项目清单。
 * 默认标准规定随项目一起带出，保证「检验项目—标准规定」也是同源关系。
 */

export type InspectionItem = {
  name: string
  defaultSpec: string
  unit?: string
}

export const INSPECTION_ITEMS: InspectionItem[] = [
  { name: '性状', defaultSpec: '符合规定' },
  { name: '鉴别', defaultSpec: '符合规定' },
  { name: '装量差异', defaultSpec: '<=5', unit: '%' },
  { name: 'pH值', defaultSpec: '5.0~7.0' },
  { name: '含量测定', defaultSpec: '>=95', unit: '%' },
  { name: '有关物质', defaultSpec: '<=1.0', unit: '%' },
  { name: '溶出度', defaultSpec: '>=80', unit: '%' },
  { name: '水分', defaultSpec: '<=3.0', unit: '%' },
  { name: '细菌内毒素', defaultSpec: '<=0.5', unit: 'EU/ml' },
  { name: '微生物限度', defaultSpec: '符合规定' },
  { name: '重量差异', defaultSpec: '<=7.5', unit: '%' },
  { name: '不溶性微粒', defaultSpec: '<=6000', unit: '粒/瓶' },
]

const ITEM_BY_NAME = new Map(INSPECTION_ITEMS.map((item) => [item.name, item]))

export function inspectionItemNames(): string[] {
  return INSPECTION_ITEMS.map((item) => item.name)
}

export function defaultSpecOf(itemName: string): string {
  return ITEM_BY_NAME.get(String(itemName ?? '').trim())?.defaultSpec ?? ''
}

export function isKnownItem(itemName: string): boolean {
  return ITEM_BY_NAME.has(String(itemName ?? '').trim())
}
