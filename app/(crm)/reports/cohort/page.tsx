'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { logAudit } from '@/lib/audit'

interface CohortRow {
  site_name: string
  total_called: number
  returned_3: number
  returned_7: number
  returned_14: number
  returned_31: number
  deposit_31: number
}

interface PromoRow {
  label: string
  total: number
  returned_7: number
  returned_31: number
  deposit: number
  avgDeposit: number
  bonus: number
  netDeposit: number
}

const SITE_COLORS: Record<string, { from: string; light: string; text: string }> = {
  'มรกต':      { from: '#0f7279', light: '#ccf5f7', text: '#0a5560' },
  'เป๋าตุง168': { from: '#4ab3d0', light: '#e0f4fa', text: '#1e6f8a' },
  'หวยพลัส':   { from: '#2d8c1e', light: '#dcfce7', text: '#166534' },
  'ตัวเต็ง168': { from: '#3d2a8a', light: '#ede9fe', text: '#3730a3' },
  'เมก้า168':   { from: '#2b52a8', light: '#dbeafe', text: '#1e3a8a' },
  'ออมสิน168':  { from: '#ec4899', light: '#fce7f3', text: '#9d174d' },
  'มณี159':    { from: '#1a6b3a', light: '#dcfce7', text: '#145228' },
  'ไพศาล':     { from: '#1e3a8a', light: '#dbeafe', text: '#1e3a8a' },
  'แสงเพชร':   { from: '#6b7280', light: '#f3f4f6', text: '#374151' },
}
const FALLBACK_SC = { from: '#6c63ff', light: '#ede9fe', text: '#4f46e5' }

export default function CohortPage() {
  const [rows, setRows] = useState<CohortRow[]>([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [siteList, setSiteList] = useState<{ id: number; name: string }[]>([])
  const [selSite, setSelSite] = useState('')
  const [expFrom, setExpFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }) })
  const [expTo, setExpTo] = useState(() => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }))
  const [promoRows, setPromoRows] = useState<PromoRow[]>([])
  const [summary, setSummary] = useState({ totalCalled: 0, returned: 0, totalDeposit: 0, pending: 0, dnc: 0, notAnswered: 0, smsSent: 0 })
  const [depForm, setDepForm] = useState({ phone: '', site_id: '', date: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }), deposit: '', promo: false, promo_type: '' })
  const [depSaving, setDepSaving] = useState(false)
  const [depToast, setDepToast] = useState('')
  const [recentDeps, setRecentDeps] = useState<any[]>([])
  const [depExporting, setDepExporting] = useState(false)
  const [cohortTab, setCohortTab] = useState<'dashboard' | 'record'>('dashboard')
  const [cSortBy, setCSortBy] = useState('')
  const [cSortDir, setCSortDir] = useState<'asc' | 'desc'>('desc')
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30)
    return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
  })
  const [dateTo, setDateTo] = useState(() => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }))
  const [userRole, setUserRole] = useState('')
  const supabase = createClient()

  useEffect(() => { load(); loadRole() }, [dateFrom, dateTo])

  async function loadRole() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const saved = localStorage.getItem('impersonate_role')
    const { data: profile } = await supabase.from('user_profiles').select('role').eq('id', user.id).single()
    const real = profile?.role || user.user_metadata?.role || ''
    if (saved && (real === 'manager' || real === 'admin')) setUserRole(saved)
    else setUserRole(real)
  }

  async function load() {
    setLoading(true)
    const { data: sites } = await supabase.from('sites').select('id, name').order('id')
    setSiteList(sites || [])

    let allCusts: any[] = []
    for (let page = 0; ; page++) {
      const from = page * 1000
      const { data } = await supabase
        .from('customers')
        .select('id, site_id, call_date, total_deposit, promo_type, answered, not_answered, sms_sent')
        .gte('call_date', dateFrom)
        .lte('call_date', dateTo)
        .not('call_date', 'is', null)
        .order('site_id').order('seq')
        .range(from, from + 999)
      if (!data || data.length === 0) break
      allCusts.push(...data)
      if (data.length < 1000) break
    }

    const custIds = allCusts.map(c => c.id)
    let deposits: { customer_id: number; day_number: number; deposit_amount: string }[] = []
    for (let i = 0; i < custIds.length; i += 500) {
      const batch = custIds.slice(i, i + 500)
      const { data: depData } = await supabase
        .from('daily_deposits')
        .select('customer_id, day_number, deposit_amount')
        .in('customer_id', batch)
        .gt('day_number', 0)
      if (depData) deposits.push(...depData)
    }

    const depByCust: Record<number, { minDay: number; days: Set<number>; depByDay: Record<number, number> }> = {}
    for (const d of deposits) {
      if (!depByCust[d.customer_id]) depByCust[d.customer_id] = { minDay: Infinity, days: new Set(), depByDay: {} }
      const entry = depByCust[d.customer_id]
      const day = d.day_number
      const amt = parseFloat(d.deposit_amount) || 0
      entry.days.add(day)
      entry.depByDay[day] = (entry.depByDay[day] || 0) + amt
      if (day < entry.minDay) entry.minDay = day
    }

    const custDeposit = (custId: number, withinDays: number) => {
      const e = depByCust[custId]
      if (!e) return { hasDeposit: false, amount: 0 }
      const hasDeposit = e.minDay <= withinDays
      let amount = 0
      for (const [day, amt] of Object.entries(e.depByDay)) {
        if (Number(day) <= withinDays) amount += amt
      }
      return { hasDeposit, amount }
    }

    const result: CohortRow[] = []
    for (const site of sites || []) {
      const custs = (allCusts || []).filter(c => c.site_id === site.id)
      if (custs.length === 0) continue
      let r3 = 0, r7 = 0, r14 = 0, r31 = 0, dep31 = 0
      for (const c of custs) {
        if (custDeposit(c.id, 3).hasDeposit) r3++
        if (custDeposit(c.id, 7).hasDeposit) r7++
        if (custDeposit(c.id, 14).hasDeposit) r14++
        const d31 = custDeposit(c.id, 31)
        if (d31.hasDeposit) { r31++; dep31 += d31.amount }
      }
      result.push({ site_name: site.name, total_called: custs.length, returned_3: r3, returned_7: r7, returned_14: r14, returned_31: r31, deposit_31: dep31 })
    }
    setRows(result)

    const { data: weeklyData } = await supabase.from('weekly_summary').select('site_id, bonus, sites(name)')
    const bonusBySite: Record<string, number> = {}
    for (const w of weeklyData || []) {
      const name = (w as any).sites?.name || ''
      bonusBySite[name] = (bonusBySite[name] || 0) + parseFloat(String((w as any).bonus || 0))
    }

    const promoGroup = { yes: { total: 0, r7: 0, r31: 0, deposit: 0, bonus: 0 }, no: { total: 0, r7: 0, r31: 0, deposit: 0, bonus: 0 } }
    for (const c of allCusts || []) {
      const hasPromo = !!c.promo_type && c.promo_type !== ''
      const g = hasPromo ? promoGroup.yes : promoGroup.no
      g.total++
      if (custDeposit(c.id, 7).hasDeposit) g.r7++
      const d31 = custDeposit(c.id, 31)
      if (d31.hasDeposit) { g.r31++; g.deposit += d31.amount }
    }
    const totalBonus = Object.values(bonusBySite).reduce((s, v) => s + v, 0)
    const totalWithPromo = promoGroup.yes.total + promoGroup.no.total
    if (totalWithPromo > 0) {
      promoGroup.yes.bonus = totalWithPromo > 0 ? totalBonus * (promoGroup.yes.total / totalWithPromo) : 0
      promoGroup.no.bonus = totalBonus - promoGroup.yes.bonus
    }

    const makePromoRow = (label: string, g: typeof promoGroup.yes): PromoRow => ({
      label,
      total: g.total,
      returned_7: g.r7,
      returned_31: g.r31,
      deposit: g.deposit,
      avgDeposit: g.r31 > 0 ? g.deposit / g.r31 : 0,
      bonus: g.bonus,
      netDeposit: g.deposit - g.bonus,
    })
    const promoResult: PromoRow[] = []
    promoResult.push(makePromoRow('รับโปรโมชั่น', promoGroup.yes))
    promoResult.push(makePromoRow('ไม่รับโปรโมชั่น', promoGroup.no))
    setPromoRows(promoResult)

    const allList = allCusts || []
    const totalCalled = allList.length
    const returned = allList.filter(c => custDeposit(c.id, 31).hasDeposit).length
    const totalDeposit = allList.reduce((s, c) => s + custDeposit(c.id, 31).amount, 0)

    const { count: pendingCount } = await supabase.from('customers').select('id', { count: 'exact', head: true })
      .eq('answered', false).eq('not_answered', false)
      .gte('call_date', dateFrom).lte('call_date', dateTo)
    const { count: dncCount } = await supabase.from('customers').select('id', { count: 'exact', head: true })
      .eq('do_not_call', true)
    const { count: smsCount } = await supabase.from('customers').select('id', { count: 'exact', head: true })
      .eq('sms_sent', true)
      .gte('call_date', dateFrom).lte('call_date', dateTo)

    setSummary({ totalCalled, returned, totalDeposit, pending: pendingCount || 0, dnc: dncCount || 0, notAnswered: 0, smsSent: smsCount || 0 })

    const { data: recentData } = await supabase.from('customers').select('*, sites(name)')
      .gt('total_deposit', 0)
      .order('created_at', { ascending: false })
      .limit(20)
    setRecentDeps((recentData || []).map((c: any) => ({ ...c, siteName: c.sites?.name || '' })))

    setLoading(false)
  }

  async function handleDeposit(e: React.FormEvent) {
    e.preventDefault()
    if (!depForm.phone || !depForm.site_id || !depForm.deposit) {
      setDepToast('กรุณากรอกเบอร์โทร เลือกเว็บ และยอดฝาก')
      setTimeout(() => setDepToast(''), 3000); return
    }
    setDepSaving(true)
    const phone = depForm.phone.replace(/^0/, '')
    const siteId = Number(depForm.site_id)
    const deposit = parseFloat(depForm.deposit) || 0

    const { data: existing } = await supabase.from('customers').select('id, total_deposit, promo_type, call_date').eq('phone', phone).eq('site_id', siteId).limit(1)
    const updates: Record<string, unknown> = {
      total_deposit: deposit,
      call_date: depForm.date,
    }
    if (depForm.promo) updates.promo_type = depForm.promo_type || 'สนใจโปรโมชั่น'

    if (existing && existing.length > 0) {
      const before = { total_deposit: existing[0].total_deposit, promo_type: existing[0].promo_type, call_date: existing[0].call_date }
      await supabase.from('customers').update(updates).eq('id', existing[0].id)
      logAudit({ action: 'customer.deposit', entity: 'Customer', entityId: existing[0].id, before, after: updates })
    } else {
      const { data: seqData } = await supabase.from('customers').select('seq').eq('site_id', siteId).order('seq', { ascending: false }).limit(1)
      const nextSeq = seqData && seqData.length > 0 ? (seqData[0].seq || 0) + 1 : 1
      const insertData = { site_id: siteId, phone, seq: nextSeq, call_count: 0, answered: true, not_answered: false, sms_sent: false, ...updates }
      const { data: newCust } = await supabase.from('customers').insert(insertData).select('id').single()
      if (newCust) logAudit({ action: 'customer.create', entity: 'Customer', entityId: newCust.id, after: insertData })
    }
    setDepToast('บันทึกสำเร็จ!')
    setDepForm({ phone: '', site_id: depForm.site_id, date: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }), deposit: '', promo: false, promo_type: '' })
    load()
    setDepSaving(false)
    setTimeout(() => setDepToast(''), 3000)
  }

  async function exportDeposits() {
    setDepExporting(true)
    const res = await fetch('/api/export', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'returned', dateFrom, dateTo }),
    })
    if (res.ok) {
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `กลับมาฝาก_${dateFrom}_${dateTo}.xlsx`; a.click()
      URL.revokeObjectURL(url)
      logAudit({ action: 'report.export', entity: 'Report', entityId: 'returned', after: { type: 'returned', dateFrom, dateTo } })
    }
    setDepExporting(false)
  }

  const totals = rows.reduce((acc, r) => ({
    total_called: acc.total_called + r.total_called,
    returned_3: acc.returned_3 + r.returned_3,
    returned_7: acc.returned_7 + r.returned_7,
    returned_14: acc.returned_14 + r.returned_14,
    returned_31: acc.returned_31 + r.returned_31,
    deposit_31: acc.deposit_31 + r.deposit_31,
  }), { total_called: 0, returned_3: 0, returned_7: 0, returned_14: 0, returned_31: 0, deposit_31: 0 })

  function heatColor(pct: number) {
    if (pct >= 30) return '#16a34a'
    if (pct >= 15) return '#65a30d'
    if (pct >= 5) return '#d97706'
    return '#6b7280'
  }

  function pct(n: number, total: number) {
    return total > 0 ? ((n / total) * 100).toFixed(1) + '%' : '-'
  }

  const daysLeft = Math.floor((new Date().getTime() - new Date(dateTo).getTime()) / 86400000)

  async function exportExcel() {
    setExporting(true)
    const res = await fetch('/api/export/cohort', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dateFrom: expFrom, dateTo: expTo, site: selSite || undefined }),
    })
    if (!res.ok) { setExporting(false); return }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Cohort_${dateFrom}_${dateTo}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
    logAudit({ action: 'report.export_cohort', entity: 'Report', entityId: 'cohort', after: { type: 'cohort', dateFrom: expFrom, dateTo: expTo, site: selSite || 'ทุกเว็บ' } })
    setExporting(false)
  }

  return (
    <div>
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '13px 24px', position: 'sticky', top: 0, zIndex: 50 }}>
        <h2 style={{ fontSize: '15px', fontWeight: 600 }}>📊 ติดตามการกลับมาฝาก</h2>
      </div>

      <div style={{ padding: '20px' }}>
        <div style={{ display: 'flex', gap: '0', marginBottom: '18px', borderBottom: '2px solid var(--border)' }}>
          <button onClick={() => setCohortTab('dashboard')} style={{ padding: '10px 20px', fontSize: '13px', fontWeight: 600, border: 'none', borderBottom: `2px solid ${cohortTab === 'dashboard' ? 'var(--accent)' : 'transparent'}`, color: cohortTab === 'dashboard' ? 'var(--accent)' : 'var(--text2)', background: 'transparent', cursor: 'pointer', marginBottom: '-2px' }}>
            📊 แดชบอร์ด
          </button>
          {userRole !== 'viewer' && <button onClick={() => setCohortTab('record')} style={{ padding: '10px 20px', fontSize: '13px', fontWeight: 600, border: 'none', borderBottom: `2px solid ${cohortTab === 'record' ? 'var(--accent)' : 'transparent'}`, color: cohortTab === 'record' ? 'var(--accent)' : 'var(--text2)', background: 'transparent', cursor: 'pointer', marginBottom: '-2px' }}>
            💰 บันทึกการฝาก
          </button>}
        </div>

        {cohortTab === 'record' ? (
          <>
            {/* ─── Deposit Form Tab ─── */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '14px', padding: '20px', marginBottom: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)' }}>💰 บันทึกการกลับมาฝาก</div>
                {userRole !== 'viewer' && <button className="btn-export" onClick={exportDeposits} disabled={depExporting}>
                  {depExporting ? 'กำลังสร้าง...' : '📥 ออกรายงาน'}
                </button>}
              </div>
              <form onSubmit={handleDeposit}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' }}>
                  <div className="form-group">
                    <label style={{ fontWeight: 700 }}>วันที่</label>
                    <input type="date" value={depForm.date} onChange={e => setDepForm({ ...depForm, date: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label style={{ fontWeight: 700 }}>เว็บ *</label>
                    <select value={depForm.site_id} onChange={e => setDepForm({ ...depForm, site_id: e.target.value })} required style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px 11px', borderRadius: '8px', fontSize: '13px', width: '100%' }}>
                      <option value="">-- เลือกเว็บ --</option>
                      {siteList.map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label style={{ fontWeight: 700 }}>เบอร์โทร *</label>
                    <input value={depForm.phone} onChange={e => setDepForm({ ...depForm, phone: e.target.value })} placeholder="0812345678" required />
                  </div>
                  <div className="form-group">
                    <label style={{ fontWeight: 700 }}>ยอดฝาก (฿) *</label>
                    <input type="number" value={depForm.deposit} onChange={e => setDepForm({ ...depForm, deposit: e.target.value })} placeholder="0" min="0" required />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: depForm.promo ? '1fr 2fr auto' : '1fr auto', gap: '14px', marginTop: '12px', alignItems: 'end' }}>
                  <div className="form-group">
                    <label style={{ fontWeight: 700 }}>โปรโมชั่น</label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px', marginTop: '6px' }}>
                      <input type="checkbox" checked={depForm.promo} onChange={e => setDepForm({ ...depForm, promo: e.target.checked })} style={{ accentColor: 'var(--accent)' }} />
                      รับโปรโมชั่น
                    </label>
                  </div>
                  {depForm.promo && (
                    <div className="form-group">
                      <label style={{ fontWeight: 700 }}>โปรโมชั่นที่รับ</label>
                      <input value={depForm.promo_type} onChange={e => setDepForm({ ...depForm, promo_type: e.target.value })} placeholder="เช่น โบนัส 100%" />
                    </div>
                  )}
                  <button type="submit" className="btn btn-primary" disabled={depSaving} style={{ padding: '8px 24px', whiteSpace: 'nowrap', height: '38px' }}>
                    {depSaving ? 'กำลังบันทึก...' : '💾 บันทึก'}
                  </button>
                </div>
                {depToast && <div style={{ marginTop: '10px', fontSize: '13px', color: depToast.includes('สำเร็จ') ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{depToast}</div>}
              </form>
            </div>

            <div style={{ marginBottom: '24px' }}>
              <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '12px' }}>📋 การกลับมาฝากล่าสุด (20 รายการ)</div>
              <div className="table-wrap">
                <table>
                  <thead className="dark">
                    <tr><th>#</th><th>เบอร์โทร</th><th>เว็บ</th><th>ยอดฝาก</th><th>โปรโมชั่น</th><th>วันที่</th></tr>
                  </thead>
                  <tbody>
                    {recentDeps.length === 0 ? (
                      <tr><td colSpan={6} style={{ textAlign: 'center', padding: '30px', color: 'var(--text3)' }}>ไม่มีข้อมูลการกลับมาฝาก</td></tr>
                    ) : recentDeps.map((c: any, i: number) => (
                      <tr key={c.id}>
                        <td style={{ color: 'var(--text3)' }}>{i + 1}</td>
                        <td style={{ fontFamily: 'monospace', fontSize: '13px' }}>0{c.phone}</td>
                        <td><span style={{ color: 'var(--accent)', fontSize: '12px' }}>{c.siteName}</span></td>
                        <td style={{ fontWeight: 700, color: 'var(--green)' }}>฿{parseFloat(String(c.total_deposit || 0)).toLocaleString()}</td>
                        <td style={{ fontSize: '12px' }}>
                          {c.promo_type
                            ? <span style={{ background: '#dbeafe', color: '#1d4ed8', padding: '2px 8px', borderRadius: '8px', fontSize: '11px', fontWeight: 600 }}>{c.promo_type}</span>
                            : <span style={{ color: 'var(--text3)' }}>-</span>}
                        </td>
                        <td style={{ fontSize: '12px', color: 'var(--text2)' }}>{c.call_date || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : (
          <>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', gap: '10px', color: 'var(--text3)' }}><div className="spinner" /> กำลังโหลด...</div>
        ) : rows.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text3)' }}>ไม่พบข้อมูลในช่วงวันที่นี้</div>
        ) : (
          <>
            {daysLeft < 31 && (
              <div style={{ background: 'linear-gradient(135deg, #fffbeb, #fef3c7)', border: '1px solid #fde68a', borderRadius: '10px', padding: '10px 16px', marginBottom: '14px', fontSize: '12px', color: '#92400e', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '16px' }}>⚠️</span>
                <span>Cohort ยังไม่ครบ 31 วัน — ตัวเลข 31 วันอาจต่ำกว่าจริง ({daysLeft} วันผ่านมา)</span>
              </div>
            )}

            {/* ─── Summary Cards ─── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '20px' }}>
              {[
                { label: 'โทรทั้งหมด', value: summary.totalCalled.toLocaleString(), sub: 'เบอร์ในช่วงนี้', color: '#6c63ff' },
                { label: 'กลับมาฝาก', value: summary.returned.toLocaleString(), sub: `${summary.totalCalled > 0 ? ((summary.returned / summary.totalCalled) * 100).toFixed(1) : '0'}%`, color: '#16a34a' },
                { label: 'ยอดฝากรวม', value: `฿${summary.totalDeposit.toLocaleString('th-TH', { maximumFractionDigits: 0 })}`, sub: '', color: '#0891b2' },
                { label: 'รอติดตาม', value: summary.pending.toLocaleString(), sub: 'ยังไม่โทร', color: '#d97706' },
              ].map(c => (
                <div key={c.label} style={{ background: 'var(--surface)', borderRadius: '10px', padding: '14px 16px', border: '1px solid var(--border)', borderLeft: `3px solid ${c.color}` }}>
                  <div style={{ fontSize: '11px', color: 'var(--text3)', fontWeight: 600 }}>{c.label}</div>
                  <div style={{ fontSize: '20px', fontWeight: 800, color: '#000', marginTop: '4px', lineHeight: 1 }}>{c.value}</div>
                  {c.sub && <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '4px' }}>{c.sub}</div>}
                </div>
              ))}
            </div>

            {/* ─── Cohort Table ─── */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,.04)', marginBottom: '18px' }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '14px' }}>📋</span>
                  <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)' }}>Cohort Analysis — กลับมาฝากรายเว็บ</span>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '5px 10px', borderRadius: '8px', fontSize: '12px' }} />
                  <span style={{ color: 'var(--text3)', fontSize: '12px' }}>ถึง</span>
                  <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '5px 10px', borderRadius: '8px', fontSize: '12px' }} />
                </div>
              </div>
              <table style={{ tableLayout: 'auto' }}>
                <thead>
                  <tr>
                    <th style={{ width: '110px' }}>เว็บ</th>
                    <th style={{ textAlign: 'right', cursor: 'pointer', userSelect: 'none' }} onClick={() => { if (cSortBy === 'total') setCSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setCSortBy('total'); setCSortDir('desc') } }}>โทรทั้งหมด{cSortBy === 'total' ? (cSortDir === 'asc' ? ' ▲' : ' ▼') : ''}</th>
                    <th style={{ textAlign: 'right', cursor: 'pointer', userSelect: 'none' }} onClick={() => { if (cSortBy === 'd3') setCSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setCSortBy('d3'); setCSortDir('desc') } }}>3 วัน{cSortBy === 'd3' ? (cSortDir === 'asc' ? ' ▲' : ' ▼') : ''}</th>
                    <th style={{ textAlign: 'right', cursor: 'pointer', userSelect: 'none' }} onClick={() => { if (cSortBy === 'd7') setCSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setCSortBy('d7'); setCSortDir('desc') } }}>7 วัน{cSortBy === 'd7' ? (cSortDir === 'asc' ? ' ▲' : ' ▼') : ''}</th>
                    <th style={{ textAlign: 'right', cursor: 'pointer', userSelect: 'none' }} onClick={() => { if (cSortBy === 'd14') setCSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setCSortBy('d14'); setCSortDir('desc') } }}>14 วัน{cSortBy === 'd14' ? (cSortDir === 'asc' ? ' ▲' : ' ▼') : ''}</th>
                    <th style={{ textAlign: 'right', cursor: 'pointer', userSelect: 'none' }} onClick={() => { if (cSortBy === 'd31') setCSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setCSortBy('d31'); setCSortDir('desc') } }}>31 วัน{cSortBy === 'd31' ? (cSortDir === 'asc' ? ' ▲' : ' ▼') : ''}</th>
                    <th style={{ textAlign: 'right', cursor: 'pointer', userSelect: 'none' }} onClick={() => { if (cSortBy === 'rate') setCSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setCSortBy('rate'); setCSortDir('desc') } }}>อัตรากลับ{cSortBy === 'rate' ? (cSortDir === 'asc' ? ' ▲' : ' ▼') : ''}</th>
                    <th style={{ textAlign: 'right', cursor: 'pointer', userSelect: 'none' }} onClick={() => { if (cSortBy === 'deposit') setCSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setCSortBy('deposit'); setCSortDir('desc') } }}>ยอดฝาก (฿){cSortBy === 'deposit' ? (cSortDir === 'asc' ? ' ▲' : ' ▼') : ''}</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const sortedRows = cSortBy ? [...rows].sort((a, b) => {
                      const getVal = (r: CohortRow) => {
                        if (cSortBy === 'total') return r.total_called
                        if (cSortBy === 'd3') return r.returned_3
                        if (cSortBy === 'd7') return r.returned_7
                        if (cSortBy === 'd14') return r.returned_14
                        if (cSortBy === 'd31') return r.returned_31
                        if (cSortBy === 'rate') return r.total_called > 0 ? r.returned_31 / r.total_called : 0
                        if (cSortBy === 'deposit') return r.deposit_31
                        return 0
                      }
                      const va = getVal(a), vb = getVal(b)
                      return cSortDir === 'asc' ? va - vb : vb - va
                    }) : rows
                    return sortedRows
                  })().map((r, idx) => {
                    const retPct = r.total_called > 0 ? (r.returned_31 / r.total_called) * 100 : 0
                    const p3 = r.total_called > 0 ? (r.returned_3 / r.total_called * 100) : 0
                    const p7 = r.total_called > 0 ? (r.returned_7 / r.total_called * 100) : 0
                    const p14 = r.total_called > 0 ? (r.returned_14 / r.total_called * 100) : 0
                    const sc = SITE_COLORS[r.site_name] || FALLBACK_SC
                    return (
                      <tr key={r.site_name} style={{ background: idx % 2 === 0 ? '#fff' : '#f8fafc' }}>
                        <td style={{ fontWeight: 600, fontSize: '13px', borderLeft: `3px solid ${sc.from}`, paddingLeft: '12px' }}>{r.site_name}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text)' }}>{r.total_called.toLocaleString()}</td>
                        <td style={{ textAlign: 'right', color: heatColor(p3), fontWeight: 700 }}>{r.returned_3} <span style={{ fontSize: '11px', fontWeight: 500, opacity: .7 }}>({p3.toFixed(1)}%)</span></td>
                        <td style={{ textAlign: 'right', color: heatColor(p7), fontWeight: 700 }}>{r.returned_7} <span style={{ fontSize: '11px', fontWeight: 500, opacity: .7 }}>({p7.toFixed(1)}%)</span></td>
                        <td style={{ textAlign: 'right', color: heatColor(p14), fontWeight: 700 }}>{r.returned_14} <span style={{ fontSize: '11px', fontWeight: 500, opacity: .7 }}>({p14.toFixed(1)}%)</span></td>
                        <td style={{ textAlign: 'right', color: heatColor(retPct), fontWeight: 700 }}>{r.returned_31} <span style={{ fontSize: '11px', fontWeight: 500, opacity: .7 }}>({retPct.toFixed(1)}%)</span></td>
                        <td style={{ textAlign: 'right' }}><span style={{ background: '#fef3e2', color: '#c2710c', padding: '2px 10px', borderRadius: '10px', fontSize: '12px', fontWeight: 700 }}>{retPct.toFixed(1)}%</span></td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: '#16a34a' }}>฿{r.deposit_31.toLocaleString('th-TH', { maximumFractionDigits: 0 })}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: '#eef2ff', fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                    <td style={{ paddingLeft: '15px' }}>รวมทั้งหมด</td>
                    <td style={{ textAlign: 'right' }}>{totals.total_called.toLocaleString()}</td>
                    <td style={{ textAlign: 'right' }}>{totals.returned_3} <span style={{ fontSize: '11px', fontWeight: 500, opacity: .7 }}>({pct(totals.returned_3, totals.total_called)})</span></td>
                    <td style={{ textAlign: 'right' }}>{totals.returned_7} <span style={{ fontSize: '11px', fontWeight: 500, opacity: .7 }}>({pct(totals.returned_7, totals.total_called)})</span></td>
                    <td style={{ textAlign: 'right' }}>{totals.returned_14} <span style={{ fontSize: '11px', fontWeight: 500, opacity: .7 }}>({pct(totals.returned_14, totals.total_called)})</span></td>
                    <td style={{ textAlign: 'right' }}>{totals.returned_31} <span style={{ fontSize: '11px', fontWeight: 500, opacity: .7 }}>({pct(totals.returned_31, totals.total_called)})</span></td>
                    <td style={{ textAlign: 'right' }}><span style={{ background: '#6c63ff', color: '#fff', padding: '2px 10px', borderRadius: '10px', fontSize: '12px', fontWeight: 700 }}>{pct(totals.returned_31, totals.total_called)}</span></td>
                    <td style={{ textAlign: 'right', color: '#16a34a' }}>฿{totals.deposit_31.toLocaleString('th-TH', { maximumFractionDigits: 0 })}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* ─── Promo Comparison ─── */}
            {promoRows.length > 0 && (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,.04)', marginBottom: '18px' }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '14px' }}>🎁</span>
                  <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)' }}>เปรียบเทียบกลุ่มโปรโมชั่น</span>
                </div>
                <table>
                  <thead>
                    <tr style={{ background: '#1e293b' }}>
                      <th style={{ color: '#e2e8f0', background: '#1e293b', borderBottom: 'none', fontSize: '12px' }}>กลุ่มโปรโมชั่น</th>
                      <th style={{ textAlign: 'right', color: '#e2e8f0', background: '#1e293b', borderBottom: 'none', fontSize: '12px' }}>จำนวนคน</th>
                      <th style={{ textAlign: 'right', color: '#e2e8f0', background: '#1e293b', borderBottom: 'none', fontSize: '12px' }}>กลับใน 7 วัน</th>
                      <th style={{ textAlign: 'right', color: '#e2e8f0', background: '#1e293b', borderBottom: 'none', fontSize: '12px' }}>กลับใน 31 วัน</th>
                      <th style={{ textAlign: 'right', color: '#e2e8f0', background: '#1e293b', borderBottom: 'none', fontSize: '12px' }}>ฝากเฉลี่ย/คน</th>
                      <th style={{ textAlign: 'right', color: '#e2e8f0', background: '#1e293b', borderBottom: 'none', fontSize: '12px' }}>โบนัสจ่าย</th>
                      <th style={{ textAlign: 'right', color: '#e2e8f0', background: '#1e293b', borderBottom: 'none', fontSize: '12px' }}>ยอดสุทธิ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {promoRows.map((r, idx) => {
                      const r7Pct = r.total > 0 ? (r.returned_7 / r.total * 100) : 0
                      const r31Pct = r.total > 0 ? (r.returned_31 / r.total * 100) : 0
                      const isPromo = r.label === 'รับโปรโมชั่น'
                      return (
                        <tr key={r.label} style={{ background: idx % 2 === 0 ? '#fff' : '#f8fafc' }}>
                          <td><span style={{ background: isPromo ? '#dbeafe' : '#f3f4f6', color: isPromo ? '#1d4ed8' : '#6b7280', padding: '3px 12px', borderRadius: '10px', fontSize: '12px', fontWeight: 700 }}>{r.label}</span></td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>{r.total.toLocaleString()}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700, color: heatColor(r7Pct) }}>{r.returned_7} ({r7Pct.toFixed(1)}%)</td>
                          <td style={{ textAlign: 'right', fontWeight: 700, color: heatColor(r31Pct) }}>{r.returned_31} ({r31Pct.toFixed(1)}%)</td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>฿{r.avgDeposit.toLocaleString('th-TH', { maximumFractionDigits: 0 })}</td>
                          <td style={{ textAlign: 'right', color: '#dc2626', fontWeight: 600 }}>฿{r.bonus.toLocaleString('th-TH', { maximumFractionDigits: 0 })}</td>
                          <td style={{ textAlign: 'right', color: r.netDeposit >= 0 ? '#16a34a' : '#dc2626', fontWeight: 700 }}>฿{r.netDeposit.toLocaleString('th-TH', { maximumFractionDigits: 0 })}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {promoRows.length === 2 && (() => {
                  const promo = promoRows[0]
                  const noPromo = promoRows[1]
                  const promoPct31 = promo.total > 0 ? (promo.returned_31 / promo.total * 100) : 0
                  const noPct31 = noPromo.total > 0 ? (noPromo.returned_31 / noPromo.total * 100) : 0
                  const diff = promoPct31 - noPct31
                  const isWorth = promo.netDeposit > 0
                  return (
                    <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', fontSize: '12px', color: 'var(--text2)', background: '#f8fafc' }}>
                      📌 กลุ่มรับโปรกลับมามากกว่า <strong style={{ color: diff >= 0 ? '#16a34a' : '#dc2626' }}>{Math.abs(diff).toFixed(1)} จุด</strong> ({diff >= 0 ? 'สูงกว่า' : 'ต่ำกว่า'}) — หักโบนัสแล้ว{isWorth ? <strong style={{ color: '#16a34a' }}> คุ้มค่า</strong> : <strong style={{ color: '#dc2626' }}> ไม่คุ้ม</strong>} (สุทธิ ฿{promo.netDeposit.toLocaleString('th-TH', { maximumFractionDigits: 0 })})
                    </div>
                  )
                })()}
              </div>
            )}

            {/* ─── Export ─── */}
            {userRole !== 'viewer' && <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,.04)', marginBottom: '24px' }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '14px' }}>📥</span>
                <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)' }}>ออกรายงานติดตามการกลับมาฝาก</span>
              </div>
              <div style={{ padding: '14px 16px' }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '12px' }}>
                  {[
                    { label: 'สัปดาห์นี้', fn: () => { const d = new Date(); const day = d.getDay() || 7; const mon = new Date(d); mon.setDate(d.getDate() - day + 1); setExpFrom(mon.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })); setExpTo(d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })) } },
                    { label: 'เดือนนี้', fn: () => { const d = new Date(); setExpFrom(new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })); setExpTo(d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })) } },
                  ].map(p => (
                    <button key={p.label} onClick={p.fn} style={{ padding: '5px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text2)', cursor: 'pointer', transition: 'all .15s' }}>{p.label}</button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <input type="date" value={expFrom} onChange={e => setExpFrom(e.target.value)} style={{ padding: '7px 10px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: '13px', height: '34px' }} />
                  <span style={{ color: 'var(--text3)', fontSize: '13px' }}>ถึง</span>
                  <input type="date" value={expTo} onChange={e => setExpTo(e.target.value)} style={{ padding: '7px 10px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: '13px', height: '34px' }} />
                  <select value={selSite} onChange={e => setSelSite(e.target.value)} style={{ padding: '7px 12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: '13px', height: '34px' }}>
                    <option value="">ทุกเว็บ</option>
                    {siteList.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                  </select>
                  <button className="btn-export" onClick={exportExcel} disabled={exporting}>
                    {exporting ? 'กำลังสร้าง...' : '📥 ออกรายงาน'}
                  </button>
                </div>
              </div>
            </div>}
          </>
        )}
          </>
        )}
      </div>
    </div>
  )
}
