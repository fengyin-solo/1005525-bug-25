import { SEED_ROWS } from './seed'
import { isPlaceholderValue } from '@/api/qc-engine'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'pharma-cleanroom:entries'
const SCHEMA_KEY = 'pharma-cleanroom:schema-version'
// 批量判定断点：失败重试时按这里记下的 id 列表从断点续跑。
const QC_CHECKPOINT_KEY = 'pharma-cleanroom:finishedqc-checkpoint'
const CURRENT_SCHEMA = 1

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function text(value: unknown): string {
  return String(value ?? '').trim()
}

/**
 * 存量成品检验记录迁移到判定同源结构：
 * - 复核计数回填，结论字段清空，全部改由判定引擎按标准+实测推导；
 * - 标准规定缺失（含老占位值）的记录单独标出，列表里拦下提示补齐；
 * - 实测结果是零/负数（含占位值）的，退回「检验中」等重填，历史上被放行的结论作废。
 */
function migrateFinishedQcRows(rows: EntryRow[]): EntryRow[] {
  return rows.map((row) => {
    const next: EntryRow = { ...row, 复核次数: Number(row.复核次数 ?? 0) || 0 }
    const standardMissing = !text(next.标准规定) || isPlaceholderValue(next.标准规定)
    if (standardMissing) {
      next.标准规定 = ''
    }
    const measuredRaw = text(next.检验结果)
    const measuredIsPlaceholder = isPlaceholderValue(next.检验结果)
    const measuredNum = measuredRaw && !measuredIsPlaceholder ? Number(measuredRaw) : NaN
    const invalidMeasured =
      measuredIsPlaceholder || measuredRaw === '' || (Number.isFinite(measuredNum) && measuredNum <= 0)

    // 只回填「结论空缺或与现有状态自相矛盾」的记录；明确可信的历史结论保留。
    if (measuredIsPlaceholder) {
      next.检验结果 = ''
    }
    if (measuredIsPlaceholder || !text(next.判定结论)) {
      next.判定结论 = ''
    }
    if (standardMissing || invalidMeasured) {
      next.判定结论 = ''
      next.status = '检验中'
      next.pending = true
    }
    next.检验状态 = next.status
    return next
  })
}

function migrate(previous: Record<string, EntryRow[]>, schema: number): Record<string, EntryRow[]> {
  const data = clone(previous)
  if (schema < 1 && Array.isArray(data.finishedqc)) {
    data.finishedqc = migrateFinishedQcRows(data.finishedqc)
  }
  return data
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    window.localStorage.setItem(SCHEMA_KEY, String(CURRENT_SCHEMA))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    const previousSchema = Number(window.localStorage.getItem(SCHEMA_KEY) ?? 0) || 0
    // 老结构里还没有版本号，与新种子合并后仍要对成品检验旧记录做回填。
    const merged = { ...fallback, ...parsed }
    const data = previousSchema < CURRENT_SCHEMA ? migrate(merged, previousSchema) : merged
    if (previousSchema < CURRENT_SCHEMA) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
      window.localStorage.setItem(SCHEMA_KEY, String(CURRENT_SCHEMA))
    }
    return data
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    window.localStorage.setItem(SCHEMA_KEY, String(CURRENT_SCHEMA))
    return fallback
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
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  if (key === 'finishedqc') {
    clearQcCheckpoint()
  }
  return rows
}

export function nextId(key: string): number {
  const rows = listRows(key)
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

export function readQcCheckpoint(): number[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(QC_CHECKPOINT_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.map(Number).filter((id) => Number.isFinite(id)) : []
  } catch {
    return []
  }
}

export function writeQcCheckpoint(ids: number[]): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(QC_CHECKPOINT_KEY, JSON.stringify(ids))
  }
}

export function clearQcCheckpoint(): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.removeItem(QC_CHECKPOINT_KEY)
  }
}

export function storageKey(): string {
  return STORAGE_KEY
}
