/**
 * 检验项目目录：成品检验、稳定性考察等所有出现「检验项目」的入口共用同一套。
 * 首次打开用内置目录播种，之后的新增持久化在 localStorage，各入口读出的选项一致。
 */

const CATALOG_KEY = 'pharma-cleanroom:inspection-items'
const CATALOG_VERSION = 1

// 内置目录：含量测定、有关物质等成品全检常用项目，定性、定量项目都有。
export const SEED_INSPECTION_ITEMS: string[] = [
  '性状',
  '鉴别',
  '水分',
  'pH值',
  '含量测定',
  '有关物质（总杂）',
  '溶出度',
  '装量差异',
  '微生物限度',
  '无菌',
]

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readItems(): string[] {
  const fallback = clone(SEED_INSPECTION_ITEMS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(CATALOG_KEY)
  if (!raw) {
    window.localStorage.setItem(CATALOG_KEY, JSON.stringify({ version: CATALOG_VERSION, items: fallback }))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as { items?: unknown }
    if (!Array.isArray(parsed.items) || parsed.items.some((item) => typeof item !== 'string')) {
      window.localStorage.setItem(CATALOG_KEY, JSON.stringify({ version: CATALOG_VERSION, items: fallback }))
      return fallback
    }
    return parsed.items as string[]
  } catch {
    return fallback
  }
}

let cache: string[] | null = null

export function listInspectionItems(): string[] {
  if (cache === null) {
    cache = readItems()
  }
  return cache
}

export function addInspectionItem(name: string): { ok: boolean; message: string } {
  const trimmed = name.trim()
  if (!trimmed) {
    return { ok: false, message: '检验项目名称不能为空' }
  }
  const items = listInspectionItems()
  if (items.includes(trimmed)) {
    return { ok: false, message: `检验项目「${trimmed}」已存在，各入口共用同一套目录` }
  }
  cache = [...items, trimmed]
  persist()
  return { ok: true, message: `已新增检验项目「${trimmed}」，各入口同步可选` }
}

function persist(): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(CATALOG_KEY, JSON.stringify({ version: CATALOG_VERSION, items: cache ?? [] }))
  }
}
