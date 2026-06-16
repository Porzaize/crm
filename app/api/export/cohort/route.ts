import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerSupabase } from '@/lib/supabase-server'
import * as XLSX from 'xlsx'

async function checkAdminRole(): Promise<boolean> {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false
    const admin = createAdminClient()
    const { data: profile } = await admin.from('user_profiles').select('role').eq('id', user.id).single()
    const role = profile?.role || user.user_metadata?.role || ''
    return role === 'admin' || role === 'manager'
  } catch { return false }
}

function phoneText(phone: string): string {
  if (!phone) return ''
  const p = String(phone).trim()
  if (p.startsWith('0')) return p
  return '0' + p
}

function setPhoneColAsText(ws: XLSX.WorkSheet, colIdx: number, startRow: number, endRow: number) {
  for (let r = startRow; r <= endRow; r++) {
    const addr = XLSX.utils.encode_cell({ r, c: colIdx })
    if (ws[addr]) {
      ws[addr].t = 's'
      ws[addr].z = '@'
    }
  }
}

function enableAutoFilter(ws: XLSX.WorkSheet, headerRow: number, cols: number, dataRows: number) {
  ws['!autofilter'] = {
    ref: XLSX.utils.encode_range({ s: { r: headerRow, c: 0 }, e: { r: headerRow + dataRows, c: cols - 1 } })
  }
}

function statusThai(c: Record<string, unknown>): string {
  if (c.answered) return 'รับสาย'
  if (c.not_answered) return 'ไม่รับสาย'
  return 'ยังไม่โทร'
}

export async function POST(req: NextRequest) {
  if (!(await checkAdminRole())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }
  const { dateFrom, dateTo, site } = await req.json()
  const admin = createAdminClient()

  const { data: sites } = await admin.from('sites').select('id, name').order('id')

  let siteId: number | null = null
  if (site) {
    const found = (sites || []).find(s => s.name === site)
    siteId = found?.id || null
  }

  let custQuery = admin.from('customers')
    .select('id, phone, call_date, total_deposit, answered, not_answered, site_id, promo_type, sites(name)')
    .not('call_date', 'is', null)
    .order('site_id').order('seq')

  if (siteId) custQuery = custQuery.eq('site_id', siteId)
  if (dateFrom) custQuery = custQuery.gte('call_date', dateFrom)
  if (dateTo) custQuery = custQuery.lte('call_date', dateTo)

  let customers: any[] = []
  for (let page = 0; ; page++) {
    const from = page * 1000
    const { data } = await custQuery.range(from, from + 999)
    if (!data || data.length === 0) break
    customers.push(...data)
    if (data.length < 1000) break
  }

  const custIds = customers.map(c => c.id)
  let deposits: { customer_id: number; day_number: number; deposit_amount: string }[] = []
  for (let i = 0; i < custIds.length; i += 500) {
    const batch = custIds.slice(i, i + 500)
    const { data: depData } = await admin.from('daily_deposits').select('customer_id, day_number, deposit_amount').in('customer_id', batch).gt('day_number', 0)
    if (depData) deposits.push(...depData)
  }

  const depByCust: Record<number, Record<number, number>> = {}
  for (const d of deposits) {
    if (!depByCust[d.customer_id]) depByCust[d.customer_id] = {}
    depByCust[d.customer_id][d.day_number] = (depByCust[d.customer_id][d.day_number] || 0) + (parseFloat(d.deposit_amount) || 0)
  }

  const custHasDepositWithin = (id: number, days: number) => {
    const m = depByCust[id]
    if (!m) return false
    return Object.keys(m).some(k => Number(k) <= days)
  }
  const custDepositAmountWithin = (id: number, days: number) => {
    const m = depByCust[id]
    if (!m) return 0
    let sum = 0
    for (const [k, v] of Object.entries(m)) { if (Number(k) <= days) sum += v }
    return sum
  }

  const dateLabel = `${dateFrom || '-'} ถึง ${dateTo || '-'}`
  const wb = XLSX.utils.book_new()

  const targetSites = siteId ? (sites || []).filter(s => s.id === siteId) : (sites || [])

  const summaryHeaders = ['เว็บ', 'โทรทั้งหมด', 'กลับใน 3 วัน', 'กลับใน 3 วัน %', 'กลับใน 7 วัน', 'กลับใน 7 วัน %', 'กลับใน 14 วัน', 'กลับใน 14 วัน %', 'กลับใน 31 วัน', 'กลับใน 31 วัน %', 'ยอดฝากรวม 31 วัน (฿)']
  const summaryRows: (string | number)[][] = []
  let totalAll = 0, totalR3 = 0, totalR7 = 0, totalR14 = 0, totalR31 = 0, totalDep = 0

  for (const s of targetSites) {
    const custs = (customers || []).filter(c => c.site_id === s.id)
    let r3 = 0, r7 = 0, r14 = 0, r31 = 0, dep31 = 0
    for (const c of custs) {
      if (custHasDepositWithin(c.id, 3)) r3++
      if (custHasDepositWithin(c.id, 7)) r7++
      if (custHasDepositWithin(c.id, 14)) r14++
      if (custHasDepositWithin(c.id, 31)) { r31++; dep31 += custDepositAmountWithin(c.id, 31) }
    }
    const pctFn = (n: number, t: number) => t > 0 ? ((n / t) * 100).toFixed(1) + '%' : '0%'
    summaryRows.push([s.name, custs.length, r3, pctFn(r3, custs.length), r7, pctFn(r7, custs.length), r14, pctFn(r14, custs.length), r31, pctFn(r31, custs.length), dep31])
    totalAll += custs.length; totalR3 += r3; totalR7 += r7; totalR14 += r14; totalR31 += r31; totalDep += dep31
  }

  const pctT = (n: number) => totalAll > 0 ? ((n / totalAll) * 100).toFixed(1) + '%' : '0%'
  summaryRows.push(['รวมทุกเว็บ', totalAll, totalR3, pctT(totalR3), totalR7, pctT(totalR7), totalR14, pctT(totalR14), totalR31, pctT(totalR31), totalDep])

  const summarySheet = XLSX.utils.aoa_to_sheet([summaryHeaders, ...summaryRows])
  XLSX.utils.sheet_add_aoa(summarySheet, [['ช่วงวันที่'], [dateLabel]], { origin: { r: 0, c: summaryHeaders.length } })
  enableAutoFilter(summarySheet, 0, summaryHeaders.length, summaryRows.length)
  summarySheet['!cols'] = [{ wch: 16 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 22 }, { wch: 24 }]
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Cohort สรุป')

  for (const s of targetSites) {
    const siteCusts = (customers || []).filter((c: any) => c.site_id === s.id)
    const detailHeaders = ['เบอร์โทร', 'สถานะ', 'วันที่โทร', 'กลับใน 3 วัน', 'กลับใน 7 วัน', 'กลับใน 14 วัน', 'กลับใน 31 วัน', 'ยอดฝาก 31 วัน (฿)']
    const rows = siteCusts.map((c: any) => [
      phoneText(c.phone), statusThai(c), c.call_date || '',
      custHasDepositWithin(c.id, 3) ? '✓' : '',
      custHasDepositWithin(c.id, 7) ? '✓' : '',
      custHasDepositWithin(c.id, 14) ? '✓' : '',
      custHasDepositWithin(c.id, 31) ? '✓' : '',
      custDepositAmountWithin(c.id, 31),
    ])

    const ws = XLSX.utils.aoa_to_sheet([detailHeaders, ...rows])
    XLSX.utils.sheet_add_aoa(ws, [['ช่วงวันที่'], [dateLabel]], { origin: { r: 0, c: detailHeaders.length } })
    setPhoneColAsText(ws, 0, 1, rows.length)
    enableAutoFilter(ws, 0, detailHeaders.length, rows.length)
    ws['!cols'] = [{ wch: 15 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 24 }]
    XLSX.utils.book_append_sheet(wb, ws, s.name.substring(0, 30))
  }

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  const now = new Date().toISOString().slice(0, 10)
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''Cohort_${now}.xlsx`,
    }
  })
}
