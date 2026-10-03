import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'pharma-cleanroom:entries'
// 结构版本号：老用户浏览器里是未加版本的裸数据，读取时按迁移链一路升级并按旧记录回填。
const CURRENT_VERSION = 2

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

type StoredShape =
  | { version: number; data: Record<string, EntryRow[]> }
  | Record<string, EntryRow[]>

let migrators: ((data: Record<string, EntryRow[]>) => void)[] = []

/** 注册存量数据迁移步骤：版本从 1 开始，按顺序执行到当前版本。 */
export function registerMigrators(steps: ((data: Record<string, EntryRow[]>) => void)[]): void {
  migrators = steps
}

function isVersioned(raw: StoredShape): raw is { version: number; data: Record<string, EntryRow[]> } {
  return typeof raw === 'object' && raw !== null && 'version' in raw && 'data' in raw
}

function upgrade(raw: StoredShape): { version: number; data: Record<string, EntryRow[]> } {
  if (isVersioned(raw)) {
    let data = clone(raw.data)
    let version = raw.version
    while (version < CURRENT_VERSION) {
      migrators[version - 1]?.(data)
      version += 1
    }
    return { version, data }
  }
  // 无版本号的存量数据视为 v1：新模块缺失时先用最新种子补齐，再跑迁移链回填。
  let data = { ...clone(SEED_ROWS), ...clone(raw) }
  let version = 1
  while (version < CURRENT_VERSION) {
    migrators[version - 1]?.(data)
    version += 1
  }
  return { version, data }
}

function persist(versioned: { version: number; data: Record<string, EntryRow[]> }): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(versioned))
  }
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = { version: CURRENT_VERSION, data: clone(SEED_ROWS) }
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback.data
  }
  const rawText = window.localStorage.getItem(STORAGE_KEY)
  if (!rawText) {
    persist(fallback)
    return fallback.data
  }
  try {
    const versioned = upgrade(JSON.parse(rawText) as StoredShape)
    persist(versioned)
    return versioned.data
  } catch {
    persist(fallback)
    return fallback.data
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  persist({ version: CURRENT_VERSION, data: next })
}

/** 一次写多个模块（如成品检验判定后同步留样清单），保证两边同事务落库。 */
export function saveMany(patch: Record<string, EntryRow[]>): void {
  const next = { ...allRows(), ...patch }
  cache = next
  persist({ version: CURRENT_VERSION, data: next })
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
