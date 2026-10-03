import { MODULE_BY_KEY } from '@/data/modules'
import { addInspectionItem, listInspectionItems } from '@/data/catalog'
import { allRows, listRows, nextId, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

/** 通用登记入口：成品检验走自己的领域服务做同源校验，其余模块在这里建记录。 */
export function createEntry(key: string, draft: Record<string, string>): ActionResult {
  const meta = moduleMeta(key)
  if (key === 'finishedqc') {
    return { ok: false, message: '成品检验请使用专用登记入口' }
  }
  const missing = meta.fields.filter((field) => field.endsWith('状态') === false && !String(draft[field] ?? '').trim())
  if (missing.length) {
    return { ok: false, message: `${missing.join('、')}不能为空` }
  }
  const rows = listRows(key)
  const firstStatus = meta.statuses[0]
  const row: EntryRow = {
    id: nextId(key),
    status: firstStatus,
    pending: true,
    abnormal: false,
  }
  for (const field of meta.fields) {
    row[field] = String(draft[field] ?? '').trim()
  }
  row[meta.fields[meta.fields.length - 1]] = firstStatus
  saveRows(key, [...rows, row])
  return { ok: true, message: `${meta.entity}已登记，当前状态「${firstStatus}」` }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  const from = meta.statuses.indexOf(current)
  const to = meta.statuses.indexOf(target)
  // 状态一段一段往下走：倒序与跳段一律拒收（成品检验在其领域服务里另有判定校验）。
  if (to <= from) {
    return { ok: false, message: `${meta.entity}状态只能顺序推进，不能从「${current}」倒序到「${target}」` }
  }
  if (to - from > 1) {
    return { ok: false, message: `不能从「${current}」跳段到「${target}」，请先完成中间环节` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}

// 检验项目目录与成品检验领域服务的统一出口，页面只从本服务读写。
export { listInspectionItems, addInspectionItem }
export {
  attachQcToRetainSamples,
  batchJudgeQc,
  blockedRows,
  createQcEntry,
  getQcRow,
  hasQcCheckpoint,
  listQcRows,
  runQcAction,
  saveQcEntry,
  validateQcDraft,
} from '@/api/finishedqc'
export type { QcDraft } from '@/api/finishedqc'
