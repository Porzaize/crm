import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerSupabase } from '@/lib/supabase-server'
import { sendTelegram, getSetting } from '@/lib/telegram'
import * as XLSX from 'xlsx'

async function checkAdminRole(): Promise<{ ok: boolean; userName?: string }> {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false }
    const admin = createAdminClient()
    const { data: profile } = await admin.from('user_profiles').select('role, display_name').eq('id', user.id).single()
    const role = profile?.role || user.user_metadata?.role || ''
    const name = profile?.display_name || user.email || 'ไม่ทราบ'
    return { ok: role === 'admin' || role === 'manager', userName: name }
  } catch { return { ok: false } }
}

const reportLabel: Record<string, string> = {
  all: 'รายงานครบชุด',
  weekly: 'สรุปรายสัปดาห์',
  customers: 'รายชื่อลูกค้าทั้งหมด',
  returned: 'กลับมาฝากแล้ว',
  not_returned: 'ยังไม่กลับมาฝาก',
  per_site: 'รายชื่อแยกเว็บ',
  do_not_call: 'ห้ามโทร',
  call_schedule: 'ตารางนัดโทร',
}

function statusThai(c: Record<string, unknown>): string {
  if (c.answered) return 'รับสาย'
  if (c.not_answered) return 'ไม่รับสาย'
  return 'ยังไม่โทร'
}

function dncLabel(c: Record<string, unknown>): string {
  if (!c.do_not_call) return ''
  return c.do_not_call_reason ? `ห้ามโทร - ${c.do_not_call_reason}` : 'ห้ามโทร'
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

export async function POST(req: NextRequest) {
  const auth = await checkAdminRole()
  if (!auth.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }
  const { type, site, dateFrom, dateTo } = await req.json()
  const admin = createAdminClient()

  let siteId: number | null = null
  if (site) {
    const { data: siteRow } = await admin.from('sites').select('id').eq('name', site).single()
    siteId = siteRow?.id || null
  }

  let custQuery = admin.from('customers')
    .select('*, sites(name), daily_deposits(*)')
    .order('site_id').order('seq')

  if (siteId) custQuery = custQuery.eq('site_id', siteId)
  if (type !== 'returned') {
    if (dateFrom) custQuery = custQuery.gte('call_date', dateFrom)
    if (dateTo) custQuery = custQuery.lte('call_date', dateTo)
  }

  const { data: customers } = await custQuery

  let weeklyQuery = admin.from('weekly_summary').select('*, sites(name)').order('site_id')
  if (siteId) weeklyQuery = weeklyQuery.eq('site_id', siteId)
  const { data: weekly } = await weeklyQuery

  const { data: sites } = await admin.from('sites').select('*').order('id')

  const bonusBySite: Record<string, number> = {}
  for (const w of weekly || []) {
    const name = w.sites?.name || ''
    bonusBySite[name] = (bonusBySite[name] || 0) + parseFloat(String(w.bonus || 0))
  }

  const dateLabel = `${dateFrom || '-'} ถึง ${dateTo || '-'}`

  const wb = XLSX.utils.book_new()

  if (type === 'weekly' || type === 'all') {
    const targetSitesW = siteId ? (sites || []).filter(s => s.id === siteId) : (sites || [])
    const siteSummary = targetSitesW.map(s => {
      const sc = (customers || []).filter(c => c.site_id === s.id)
      const answered = sc.filter(c => c.answered).length
      const notAns = sc.filter(c => c.not_answered).length
      const returnCusts = sc.filter(c => parseFloat(String(c.total_deposit || 0)) > 0).length
      const returnDep = sc.reduce((sum: number, c: any) => sum + parseFloat(String(c.total_deposit || 0)), 0)
      const bonus = bonusBySite[s.name] || 0
      const dnc = sc.filter(c => c.do_not_call).length
      return { name: s.name, total: sc.length, answered, notAns, returnCusts, returnDep, bonus, dnc }
    })
    const gt = siteSummary.reduce((a, s) => ({ total: a.total + s.total, answered: a.answered + s.answered, notAns: a.notAns + s.notAns, returnCusts: a.returnCusts + s.returnCusts, returnDep: a.returnDep + s.returnDep, bonus: a.bonus + s.bonus, dnc: a.dnc + s.dnc }), { total: 0, answered: 0, notAns: 0, returnCusts: 0, returnDep: 0, bonus: 0, dnc: 0 })
    const pct = (n: number, d: number) => d > 0 ? ((n / d) * 100).toFixed(1) + '%' : '0%'
    const wsData = [
      ['เว็บ', 'โทรติดตาม', 'รับสาย', 'รับสาย%', 'ไม่รับสาย', 'ไม่รับสาย%', 'กลับมาฝาก', 'ยอดฝากหลังติดตามรวม (฿)', 'โบนัสรวม (฿)', 'ROI%', 'ห้ามโทร'],
      ...siteSummary.map(s => [
        s.name, s.total, s.answered, pct(s.answered, s.total),
        s.notAns, pct(s.notAns, s.total), s.returnCusts,
        s.returnDep.toFixed(2), s.bonus.toFixed(2),
        pct(s.bonus, s.returnDep), s.dnc
      ]),
      ['รวมทั้งหมด', gt.total, gt.answered, pct(gt.answered, gt.total),
        gt.notAns, pct(gt.notAns, gt.total), gt.returnCusts,
        gt.returnDep.toFixed(2), gt.bonus.toFixed(2),
        pct(gt.bonus, gt.returnDep), gt.dnc]
    ]
    const ws = XLSX.utils.aoa_to_sheet(wsData)
    XLSX.utils.sheet_add_aoa(ws, [['ช่วงวันที่'], [dateLabel]], { origin: { r: 0, c: 12 } })
    enableAutoFilter(ws, 0, 11, siteSummary.length + 1)
    ws['!cols'] = [{ wch: 16 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 24 }, { wch: 16 }, { wch: 10 }, { wch: 12 }, { wch: 4 }, { wch: 24 }]
    XLSX.utils.book_append_sheet(wb, ws, 'สรุปรวม')
  }

  if (type === 'per_site' || type === 'all') {
    const targetSites = siteId ? (sites || []).filter(s => s.id === siteId) : (sites || [])
    for (const s of targetSites) {
      const siteCusts = (customers || []).filter(c => c.sites?.name === s.name)
      const siteBonus = bonusBySite[s.name] || 0
      const rows = siteCusts.map(c => [
        phoneText(c.phone),
        statusThai(c),
        c.call_count || 1,
        parseFloat(c.total_deposit || 0),
        siteBonus,
        dncLabel(c),
        c.note || ''
      ])
      const sheetData = [
        ['เบอร์โทร', 'สถานะ', 'จำนวนครั้งที่โทร', 'ยอดฝากหลังติดตามรวม (฿)', 'โบนัสรวม (฿)', 'ห้ามโทร', 'หมายเหตุ'],
        ...rows
      ]
      const ws = XLSX.utils.aoa_to_sheet(sheetData)
      XLSX.utils.sheet_add_aoa(ws, [['ช่วงวันที่'], [dateLabel]], { origin: { r: 0, c: 8 } })
      setPhoneColAsText(ws, 0, 1, rows.length)
      enableAutoFilter(ws, 0, 7, rows.length)
      ws['!cols'] = [{ wch: 16 }, { wch: 14 }, { wch: 18 }, { wch: 24 }, { wch: 16 }, { wch: 20 }, { wch: 30 }, { wch: 4 }, { wch: 24 }]
      XLSX.utils.book_append_sheet(wb, ws, s.name.substring(0, 30))
    }
  }

  if (type === 'customers' || type === 'returned') {
    const filtered = type === 'returned'
      ? (customers || []).filter(c => parseFloat(String(c.total_deposit || 0)) > 0)
      : (customers || [])
    const rows = filtered.map((c: any) => [
      phoneText(c.phone),
      c.sites?.name || '',
      statusThai(c),
      c.call_count || 1,
      parseFloat(String(c.total_deposit || 0)),
      bonusBySite[c.sites?.name || ''] || 0,
      dncLabel(c),
    ])
    const headers = ['เบอร์โทร', 'เว็บ', 'สถานะ', 'จำนวนครั้งที่โทร', 'ยอดฝากหลังติดตามรวม (฿)', 'โบนัสรวม (฿)', 'ห้ามโทร']
    const sheetData = [headers, ...rows]
    const ws = XLSX.utils.aoa_to_sheet(sheetData)
    XLSX.utils.sheet_add_aoa(ws, [['ช่วงวันที่'], [dateLabel]], { origin: { r: 0, c: headers.length + 1 } })
    setPhoneColAsText(ws, 0, 1, rows.length)
    enableAutoFilter(ws, 0, headers.length, rows.length)
    ws['!cols'] = [{ wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 18 }, { wch: 24 }, { wch: 16 }, { wch: 20 }, { wch: 4 }, { wch: 24 }]
    XLSX.utils.book_append_sheet(wb, ws, type === 'returned' ? 'กลับมาฝากแล้ว' : 'รายชื่อลูกค้า')

    const targetSitesCR = siteId ? (sites || []).filter(s => s.id === siteId) : (sites || [])
    for (const s of targetSitesCR) {
      const siteCusts = filtered.filter((c: any) => c.sites?.name === s.name)
      const siteRows = siteCusts.map((c: any) => [
        phoneText(c.phone),
        statusThai(c),
        c.call_count || 1,
        parseFloat(String(c.total_deposit || 0)),
        bonusBySite[s.name] || 0,
        dncLabel(c),
      ])
      const siteHeaders = ['เบอร์โทร', 'สถานะ', 'จำนวนครั้งที่โทร', 'ยอดฝากหลังติดตามรวม (฿)', 'โบนัสรวม (฿)', 'ห้ามโทร']
      const sWs = XLSX.utils.aoa_to_sheet([siteHeaders, ...siteRows])
      XLSX.utils.sheet_add_aoa(sWs, [['ช่วงวันที่'], [dateLabel]], { origin: { r: 0, c: siteHeaders.length + 1 } })
      setPhoneColAsText(sWs, 0, 1, siteRows.length)
      enableAutoFilter(sWs, 0, siteHeaders.length, siteRows.length)
      sWs['!cols'] = [{ wch: 16 }, { wch: 14 }, { wch: 18 }, { wch: 24 }, { wch: 16 }, { wch: 20 }, { wch: 4 }, { wch: 24 }]
      XLSX.utils.book_append_sheet(wb, sWs, s.name.substring(0, 30))
    }
  }

  if (type === 'not_returned') {
    const filtered = (customers || []).filter(c => parseFloat(String(c.total_deposit || 0)) <= 0)
    const rows = filtered.map((c: any) => [
      phoneText(c.phone),
      c.sites?.name || '',
      statusThai(c),
      c.call_count || 1,
      dncLabel(c),
      c.note || '',
    ])
    const headers = ['เบอร์โทร', 'เว็บ', 'สถานะ', 'จำนวนครั้งที่โทร', 'ห้ามโทร', 'หมายเหตุ']
    const sheetData = [headers, ...rows]
    const ws = XLSX.utils.aoa_to_sheet(sheetData)
    XLSX.utils.sheet_add_aoa(ws, [['ช่วงวันที่'], [dateLabel]], { origin: { r: 0, c: headers.length + 1 } })
    setPhoneColAsText(ws, 0, 1, rows.length)
    enableAutoFilter(ws, 0, headers.length, rows.length)
    ws['!cols'] = [{ wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 18 }, { wch: 20 }, { wch: 30 }, { wch: 4 }, { wch: 24 }]
    XLSX.utils.book_append_sheet(wb, ws, 'ยังไม่กลับมาฝาก')

    const targetSitesNR = siteId ? (sites || []).filter(s => s.id === siteId) : (sites || [])
    for (const s of targetSitesNR) {
      const siteCusts = filtered.filter((c: any) => c.sites?.name === s.name)
      const siteRows = siteCusts.map((c: any) => [
        phoneText(c.phone),
        statusThai(c),
        c.call_count || 1,
        dncLabel(c),
        c.note || '',
      ])
      const siteHeaders = ['เบอร์โทร', 'สถานะ', 'จำนวนครั้งที่โทร', 'ห้ามโทร', 'หมายเหตุ']
      const sWs = XLSX.utils.aoa_to_sheet([siteHeaders, ...siteRows])
      XLSX.utils.sheet_add_aoa(sWs, [['ช่วงวันที่'], [dateLabel]], { origin: { r: 0, c: siteHeaders.length + 1 } })
      setPhoneColAsText(sWs, 0, 1, siteRows.length)
      enableAutoFilter(sWs, 0, siteHeaders.length, siteRows.length)
      sWs['!cols'] = [{ wch: 16 }, { wch: 14 }, { wch: 18 }, { wch: 20 }, { wch: 30 }, { wch: 4 }, { wch: 24 }]
      XLSX.utils.book_append_sheet(wb, sWs, s.name.substring(0, 30))
    }
  }

  if (type === 'do_not_call' || type === 'weekly' || type === 'all' || type === 'per_site' || type === 'customers' || type === 'returned' || type === 'call_schedule') {
    let dncQuery = admin.from('customers').select('*, sites(name)')
      .eq('do_not_call', true).order('site_id').order('seq')
    if (siteId) dncQuery = dncQuery.eq('site_id', siteId)
    const { data: dncCusts } = await dncQuery
    if ((dncCusts || []).length > 0) {
      const dncRows = (dncCusts || []).map(c => [
        phoneText(c.phone), c.sites?.name || '', c.do_not_call_reason || '', c.call_date || '', c.note || ''
      ])
      const dncData = [['เบอร์โทร', 'เว็บ', 'เหตุผล', 'วันที่โทร', 'หมายเหตุ'], ...dncRows]
      const dncWs = XLSX.utils.aoa_to_sheet(dncData)
      setPhoneColAsText(dncWs, 0, 1, dncRows.length)
      enableAutoFilter(dncWs, 0, 5, dncRows.length)
      dncWs['!cols'] = [{ wch: 15 }, { wch: 14 }, { wch: 20 }, { wch: 14 }, { wch: 30 }]
      XLSX.utils.book_append_sheet(wb, dncWs, 'ห้ามโทร')
    }
  }

  if (type === 'call_schedule') {
    let schedQuery = admin.from('customers').select('*, sites(name)')
      .eq('answered', false).eq('not_answered', false)
      .order('site_id').order('call_date').order('seq')
    if (siteId) schedQuery = schedQuery.eq('site_id', siteId)
    if (dateFrom) schedQuery = schedQuery.gte('call_date', dateFrom)
    if (dateTo) schedQuery = schedQuery.lte('call_date', dateTo)
    const { data: schedCusts } = await schedQuery

    const todayStr = new Date().toISOString().split('T')[0]
    const calcDaysLeft = (callDate: string) => {
      if (!callDate) return 0
      return Math.floor((new Date(callDate).getTime() - new Date(todayStr).getTime()) / 86400000)
    }
    const daysLeftLabel = (d: number) => d <= 0 ? 'วันนี้' : d === 1 ? 'พรุ่งนี้' : `${d} วัน`

    const allRows = (schedCusts || []).map(c => [
      phoneText(c.phone),
      c.sites?.name || '',
      c.call_date || '',
      daysLeftLabel(calcDaysLeft(c.call_date)),
      dncLabel(c),
      c.note || ''
    ])
    const headers = ['เบอร์โทร', 'เว็บ', 'วันนัดโทร', 'เหลืออีก', 'ห้ามโทร', 'หมายเหตุ']
    const wsAll = XLSX.utils.aoa_to_sheet([headers, ...allRows])
    XLSX.utils.sheet_add_aoa(wsAll, [['ช่วงวันที่'], [dateLabel]], { origin: { r: 0, c: 7 } })
    setPhoneColAsText(wsAll, 0, 1, allRows.length)
    enableAutoFilter(wsAll, 0, 6, allRows.length)
    wsAll['!cols'] = [{ wch: 15 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 20 }, { wch: 30 }, { wch: 0 }, { wch: 24 }]
    XLSX.utils.book_append_sheet(wb, wsAll, 'รวมทุกเว็บ')

    const targetSites = siteId ? (sites || []).filter(s => s.id === siteId) : (sites || [])
    for (const s of targetSites) {
      const siteCusts = (schedCusts || []).filter(c => c.sites?.name === s.name)
      const rows = siteCusts.map(c => [
        phoneText(c.phone),
        c.call_date || '',
        daysLeftLabel(calcDaysLeft(c.call_date)),
        dncLabel(c),
        c.note || ''
      ])
      const siteHeaders = ['เบอร์โทร', 'วันนัดโทร', 'เหลืออีก', 'ห้ามโทร', 'หมายเหตุ']
      const ws = XLSX.utils.aoa_to_sheet([siteHeaders, ...rows])
      XLSX.utils.sheet_add_aoa(ws, [['ช่วงวันที่'], [dateLabel]], { origin: { r: 0, c: 6 } })
      setPhoneColAsText(ws, 0, 1, rows.length)
      enableAutoFilter(ws, 0, 5, rows.length)
      ws['!cols'] = [{ wch: 15 }, { wch: 14 }, { wch: 10 }, { wch: 20 }, { wch: 30 }, { wch: 0 }, { wch: 24 }]
      XLSX.utils.book_append_sheet(wb, ws, s.name.substring(0, 30))
    }
  }

  try {
    const chatId = await getSetting('team_chat_id', '')
    if (chatId) {
      const label = reportLabel[type] || type
      const msg = [
        `📊 <b>ออกรายงาน Excel</b>`,
        ``,
        `📋 ${label}`,
        site ? `🌐 ${site}` : `🌐 ทุกเว็บ`,
        type !== 'returned' ? `📅 ${dateFrom || '-'} ถึง ${dateTo || '-'}` : '',
        `👤 ${auth.userName}`,
      ].filter(Boolean).join('\n')
      await sendTelegram(chatId, msg)
    }
  } catch {}

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  const now = new Date().toISOString().slice(0, 10)
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''CRM_Report_${now}.xlsx`,
    }
  })
}
