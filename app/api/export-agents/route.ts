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

export async function POST(req: NextRequest) {
  if (!(await checkAdminRole())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }
  const { dateFrom, dateTo, site, stats } = await req.json()
  const dateLabel = `${dateFrom || '-'} ถึง ${dateTo || '-'}`
  const wb = XLSX.utils.book_new()

  const summaryRows = (stats || []).map((s: any) => [
    s.name, s.total_calls, s.answered,
    s.total_calls > 0 ? ((s.answered / s.total_calls) * 100).toFixed(1) + '%' : '0%',
    s.sms_sent, s.returned,
    s.total_deposit.toFixed(2),
    (s.siteCalls || []).map((sc: any) => `${sc.siteName}(${sc.count})`).join(', ')
  ])

  const gt = (stats || []).reduce((a: any, s: any) => ({
    total_calls: a.total_calls + s.total_calls,
    answered: a.answered + s.answered,
    sms_sent: a.sms_sent + s.sms_sent,
    returned: a.returned + s.returned,
    total_deposit: a.total_deposit + s.total_deposit,
  }), { total_calls: 0, answered: 0, sms_sent: 0, returned: 0, total_deposit: 0 })

  const wsData = [
    ['พนักงาน', 'โทรทั้งหมด', 'รับสาย', 'รับสาย%', 'ส่ง SMS', 'กลับมาฝาก', 'ยอดฝากรวม (฿)', 'เว็บที่โทร'],
    ...summaryRows,
    ['รวมทั้งหมด', gt.total_calls, gt.answered,
      gt.total_calls > 0 ? ((gt.answered / gt.total_calls) * 100).toFixed(1) + '%' : '0%',
      gt.sms_sent, gt.returned, gt.total_deposit.toFixed(2), '']
  ]
  const ws = XLSX.utils.aoa_to_sheet(wsData)
  XLSX.utils.sheet_add_aoa(ws, [['ช่วงวันที่'], [dateLabel], ['เว็บ'], [site || 'ทุกเว็บ']], { origin: { r: 0, c: 9 } })
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: summaryRows.length + 1, c: 7 } }) }
  ws['!cols'] = [{ wch: 24 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 18 }, { wch: 40 }, { wch: 0 }, { wch: 14 }]
  XLSX.utils.book_append_sheet(wb, ws, 'สรุปพนักงาน')

  for (const s of stats || []) {
    if (!s.siteCalls || s.siteCalls.length === 0) continue
    const sheetName = (s.name || 'unknown').substring(0, 28)
    const rows = s.siteCalls.map((sc: any) => [
      sc.siteName, sc.count, sc.answered, sc.notAnswered, sc.returned, sc.deposit.toFixed(2)
    ])
    const data = [
      ['เว็บ', 'โทร', 'รับสาย', 'ไม่รับ', 'กลับมาฝาก', 'ยอดฝาก (฿)'],
      ...rows
    ]
    const sws = XLSX.utils.aoa_to_sheet(data)
    sws['!cols'] = [{ wch: 14 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 16 }]
    XLSX.utils.book_append_sheet(wb, sws, sheetName)
  }

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''Agent_Report_${dateFrom}_${dateTo}.xlsx`,
    }
  })
}
