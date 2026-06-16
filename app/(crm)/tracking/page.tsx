'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { logAudit } from '@/lib/audit'
import { notifyTelegram } from '@/lib/notify'
import type { Customer, Site } from '@/lib/types'

function getWeekRange(date: Date) {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  const mon = new Date(d.setDate(diff))
  const sun = new Date(mon)
  sun.setDate(mon.getDate() + 6)
  return { mon, sun }
}

function fmt(d: Date) { return d.toISOString().split('T')[0] }
function fmtDT(d: Date) { return d.toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 16).replace(' ', 'T') }

function daysBetween(d1: string, d2: string) {
  return Math.floor((new Date(d2).getTime() - new Date(d1).getTime()) / 86400000)
}

export default function TrackingPage() {
  const [weekOffset, setWeekOffset] = useState(0)
  const [customers, setCustomers] = useState<(Customer & { siteName: string })[]>([])
  const [sites, setSites] = useState<Site[]>([])
  const [siteFilter, setSiteFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [phoneSearch, setPhoneSearch] = useState('')
  const [callResultFilter, setCallResultFilter] = useState('')
  const [callCountFilter, setCallCountFilter] = useState('')
  const [tab, setTab] = useState<'week' | 'callback' | 'log' | 'dnc'>('week')
  const [callbacks, setCallbacks] = useState<(Customer & { siteName: string })[]>([])
  const [callLogs, setCallLogs] = useState<(Customer & { siteName: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [cbForm, setCbForm] = useState({ phone: '', site_id: '', call_date: fmt(new Date()), note: '' })
  const [cbSaving, setCbSaving] = useState(false)
  const [cbToast, setCbToast] = useState('')
  const [cbDateFrom, setCbDateFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 7); return fmt(d) })
  const [cbDateTo, setCbDateTo] = useState(fmt(new Date()))
  const [cbSiteFilter, setCbSiteFilter] = useState('')
  const [cbExporting, setCbExporting] = useState(false)
  const [schedExporting, setSchedExporting] = useState(false)
  const [callStats, setCallStats] = useState({ today: 0, week: 0, twoWeeks: 0, month: 0 })
  const [urgentCalls, setUrgentCalls] = useState<(Customer & { siteName: string })[]>([])
  const [logForm, setLogForm] = useState({ phone: '', site_id: '', call_date: fmt(new Date()), result: '' as '' | 'answered' | 'not_answered', deposit: '', promo: false, promo_type: '', next_call: fmtDT(new Date()), note: '' })
  const [logSaving, setLogSaving] = useState(false)
  const [logToast, setLogToast] = useState('')
  const [showLogForm, setShowLogForm] = useState(false)
  const [currentUserId, setCurrentUserId] = useState('')
  const [dncList, setDncList] = useState<(Customer & { siteName: string })[]>([])
  const [dncSiteFilter, setDncSiteFilter] = useState('')
  const [dncPhoneSearch, setDncPhoneSearch] = useState('')
  const [dncExporting, setDncExporting] = useState(false)
  const [logPhoneInfo, setLogPhoneInfo] = useState<{ nextCallAt?: string; isDnc?: boolean; dncReason?: string } | null>(null)
  const [userRole, setUserRole] = useState('')
  const supabase = createClient()

  const now = new Date()
  now.setDate(now.getDate() + weekOffset * 7)
  const { mon, sun } = getWeekRange(now)
  const weekStart = fmt(mon)
  const weekEnd = fmt(sun)

  useEffect(() => { load(); loadUser() }, [weekOffset])

  async function loadUser() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setCurrentUserId(user.id)
    const saved = localStorage.getItem('impersonate_role')
    const { data: profile } = await supabase.from('user_profiles').select('role').eq('id', user.id).single()
    const real = profile?.role || user.user_metadata?.role || ''
    if (saved && (real === 'manager' || real === 'admin')) setUserRole(saved)
    else setUserRole(real)
  }

  async function load() {
    setLoading(true)
    const { data: siteList } = await supabase.from('sites').select('*').order('id')
    setSites(siteList || [])
    const { data } = await supabase.from('customers').select('*, sites(name)')
      .gte('call_date', weekStart).lte('call_date', weekEnd).order('site_id').order('seq')
    setCustomers((data || []).map(c => ({ ...c, siteName: c.sites?.name || '' })))
    const todayEnd = new Date()
    todayEnd.setHours(23, 59, 59, 999)
    const { data: cbData } = await supabase.from('customers').select('*, sites(name)')
      .not('next_call_at', 'is', null)
      .lte('next_call_at', todayEnd.toISOString())
      .order('next_call_at')
    setCallbacks((cbData || []).map(c => ({ ...c, siteName: c.sites?.name || '' })))
    const { data: logData } = await supabase.from('customers').select('*, sites(name)')
      .or('answered.eq.true,not_answered.eq.true')
      .order('call_date', { ascending: false }).order('call_time', { ascending: false }).limit(20)
    setCallLogs((logData || []).map(c => ({ ...c, siteName: c.sites?.name || '' })))
    const { data: dncData } = await supabase.from('customers').select('*, sites(name)')
      .eq('do_not_call', true).order('site_id').order('seq')
    setDncList((dncData || []).map(c => ({ ...c, siteName: c.sites?.name || '' })))

    const todayStr = fmt(new Date())
    const weekEndDate = new Date(); weekEndDate.setDate(weekEndDate.getDate() + (7 - weekEndDate.getDay()))
    const twoWeekEnd = new Date(); twoWeekEnd.setDate(twoWeekEnd.getDate() + (14 - twoWeekEnd.getDay()))
    const monthEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0)
    const filterSite = siteFilter ? (siteList || []).find(s => s.name === siteFilter) : null
    let qToday = supabase.from('customers').select('id', { count: 'exact', head: true }).eq('call_date', todayStr).eq('answered', false).eq('not_answered', false)
    let qWeek = supabase.from('customers').select('id', { count: 'exact', head: true }).gte('call_date', todayStr).lte('call_date', fmt(weekEndDate)).eq('answered', false).eq('not_answered', false)
    let qTwoWeeks = supabase.from('customers').select('id', { count: 'exact', head: true }).gte('call_date', todayStr).lte('call_date', fmt(twoWeekEnd)).eq('answered', false).eq('not_answered', false)
    let qMonth = supabase.from('customers').select('id', { count: 'exact', head: true }).gte('call_date', todayStr).lte('call_date', fmt(monthEnd)).eq('answered', false).eq('not_answered', false)
    if (filterSite) { qToday = qToday.eq('site_id', filterSite.id); qWeek = qWeek.eq('site_id', filterSite.id); qTwoWeeks = qTwoWeeks.eq('site_id', filterSite.id); qMonth = qMonth.eq('site_id', filterSite.id) }
    const { count: cToday } = await qToday
    const { count: cWeek } = await qWeek
    const { count: cTwoWeeks } = await qTwoWeeks
    const { count: cMonth } = await qMonth
    setCallStats({ today: cToday || 0, week: cWeek || 0, twoWeeks: cTwoWeeks || 0, month: cMonth || 0 })
    let qUrgent = supabase.from('customers').select('*, sites(name)')
      .eq('answered', false).eq('not_answered', false)
      .gte('call_date', todayStr)
      .order('call_date', { ascending: true }).order('seq', { ascending: true }).limit(20)
    if (filterSite) qUrgent = qUrgent.eq('site_id', filterSite.id)
    const { data: urgentData } = await qUrgent
    setUrgentCalls((urgentData || []).map(c => ({ ...c, siteName: c.sites?.name || '' })))
    setLoading(false)
  }

  async function loadFilteredLogs() {
    let q = supabase.from('customers').select('*, sites(name)')
      .or('answered.eq.true,not_answered.eq.true')
      .gte('call_date', cbDateFrom).lte('call_date', cbDateTo)
      .order('call_date', { ascending: false }).order('call_time', { ascending: false })
    if (cbSiteFilter) {
      const site = sites.find(s => s.name === cbSiteFilter)
      if (site) q = q.eq('site_id', site.id)
    }
    const { data } = await q
    setCallLogs((data || []).map((c: any) => ({ ...c, siteName: c.sites?.name || '' })))
  }

  async function handleAddCall(e: React.FormEvent) {
    e.preventDefault()
    if (!cbForm.phone || !cbForm.site_id) { setCbToast('กรุณากรอกเบอร์โทรและเลือกเว็บ'); setTimeout(() => setCbToast(''), 3000); return }
    setCbSaving(true)
    const { data: seqData } = await supabase.from('customers').select('seq').eq('site_id', Number(cbForm.site_id)).order('seq', { ascending: false }).limit(1)
    const nextSeq = seqData && seqData.length > 0 ? (seqData[0].seq || 0) + 1 : 1
    const insertData = {
      site_id: Number(cbForm.site_id), phone: cbForm.phone.replace(/^0/, ''), call_date: cbForm.call_date || fmt(new Date()),
      seq: nextSeq, note: cbForm.note || null, answered: false, not_answered: false, sms_sent: false, total_deposit: 0, call_count: 0,
    }
    const { data: newCust, error } = await supabase.from('customers').insert(insertData).select('id').single()
    if (error) { setCbToast('เกิดข้อผิดพลาด: ' + error.message) }
    else { if (newCust) logAudit({ action: 'customer.create', entity: 'Customer', entityId: newCust.id, after: insertData }); setCbToast('บันทึกสำเร็จ!'); setCbForm({ phone: '', site_id: cbForm.site_id, call_date: fmt(new Date()), note: '' }); load() }
    setCbSaving(false)
    setTimeout(() => setCbToast(''), 3000)
  }

  async function exportCallLogs() {
    setCbExporting(true)
    const res = await fetch('/api/export', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'per_site', dateFrom: cbDateFrom, dateTo: cbDateTo, site: cbSiteFilter || undefined }),
    })
    if (res.ok) {
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `CallLog_${cbDateFrom}_${cbDateTo}.xlsx`; a.click()
      URL.revokeObjectURL(url)
      logAudit({ action: 'report.export', entity: 'Report', entityId: 'call_log', after: { type: 'per_site', dateFrom: cbDateFrom, dateTo: cbDateTo, site: cbSiteFilter || 'ทุกเว็บ' } })
    }
    setCbExporting(false)
  }

  async function lookupPhone(phone: string) {
    const p = phone.replace(/^0/, '').replace(/\D/g, '')
    if (p.length < 9) { setLogPhoneInfo(null); return }
    const { data } = await supabase.from('customers').select('next_call_at, do_not_call, do_not_call_reason').eq('phone', p).limit(1)
    if (data && data.length > 0) {
      const c = data[0]
      if (c.next_call_at || c.do_not_call) {
        setLogPhoneInfo({ nextCallAt: c.next_call_at || undefined, isDnc: c.do_not_call || false, dncReason: c.do_not_call_reason || undefined })
        return
      }
    }
    setLogPhoneInfo(null)
  }

  async function exportDnc() {
    setDncExporting(true)
    const res = await fetch('/api/export', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'do_not_call', site: dncSiteFilter || undefined }),
    })
    if (res.ok) {
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `ห้ามโทร_${fmt(new Date())}.xlsx`; a.click()
      URL.revokeObjectURL(url)
      logAudit({ action: 'report.export', entity: 'Report', entityId: 'do_not_call', after: { type: 'do_not_call', site: dncSiteFilter || 'ทุกเว็บ' } })
    }
    setDncExporting(false)
  }

  async function exportSchedule() {
    setSchedExporting(true)
    const res = await fetch('/api/export', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'call_schedule', dateFrom: weekStart, dateTo: weekEnd, site: siteFilter || undefined }),
    })
    if (res.ok) {
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `รายการโทร_${weekStart}_${weekEnd}.xlsx`; a.click()
      URL.revokeObjectURL(url)
      logAudit({ action: 'report.export', entity: 'Report', entityId: 'call_schedule', after: { type: 'call_schedule', dateFrom: weekStart, dateTo: weekEnd, site: siteFilter || 'ทุกเว็บ' } })
    }
    setSchedExporting(false)
  }

  async function handleLogCall(e: React.FormEvent) {
    e.preventDefault()
    if (!logForm.phone || !logForm.site_id || !logForm.result) {
      setLogToast('กรุณากรอกเบอร์โทร เลือกเว็บ และผลสาย')
      setTimeout(() => setLogToast(''), 3000); return
    }
    setLogSaving(true)
    const phone = logForm.phone.replace(/^0/, '')
    const siteId = Number(logForm.site_id)

    const { data: existing } = await supabase.from('customers').select('id, call_count').eq('phone', phone).eq('site_id', siteId).limit(1)
    const updates: Record<string, unknown> = {
      answered: logForm.result === 'answered',
      not_answered: logForm.result === 'not_answered',
      called_by: currentUserId || null,
      call_date: logForm.call_date,
      note: logForm.note || null,
      next_call_at: logForm.next_call ? new Date(logForm.next_call).toISOString() : null,
    }
    if (logForm.result === 'answered' && logForm.deposit) updates.total_deposit = parseFloat(logForm.deposit) || 0
    if (logForm.promo) updates.promo_type = logForm.promo_type || 'สนใจโปรโมชั่น'

    if (existing && existing.length > 0) {
      const before = { answered: false, not_answered: false, call_count: existing[0].call_count || 0 }
      updates.call_count = (existing[0].call_count || 0) + 1
      await supabase.from('customers').update(updates).eq('id', existing[0].id)
      logAudit({ action: 'customer.call_log', entity: 'Customer', entityId: existing[0].id, before, after: updates })
    } else {
      const { data: seqData } = await supabase.from('customers').select('seq').eq('site_id', siteId).order('seq', { ascending: false }).limit(1)
      const nextSeq = seqData && seqData.length > 0 ? (seqData[0].seq || 0) + 1 : 1
      const insertData = {
        site_id: siteId, phone, seq: nextSeq, call_count: 1,
        sms_sent: false, total_deposit: parseFloat(logForm.deposit) || 0,
        ...updates,
      }
      const { data: newCust } = await supabase.from('customers').insert(insertData).select('id').single()
      if (newCust) logAudit({ action: 'customer.create', entity: 'Customer', entityId: newCust.id, after: { phone, site_id: siteId, ...updates } })
    }

    if (logForm.deposit && parseFloat(logForm.deposit) > 0) {
      const site = sites.find(s => String(s.id) === logForm.site_id)
      notifyTelegram('big_deposit', { site: site?.name || '', phone, deposit: parseFloat(logForm.deposit) })
    }
    setLogToast('บันทึกสำเร็จ!')
    setLogForm({ phone: '', site_id: logForm.site_id, call_date: fmt(new Date()), result: '', deposit: '', promo: false, promo_type: '', next_call: fmtDT(new Date()), note: '' })
    load()
    setLogSaving(false)
    setTimeout(() => setLogToast(''), 3000)
  }

  const today = fmt(new Date())

  function getStatus(c: Customer & { siteName: string }) {
    const dep = parseFloat(String(c.total_deposit || 0))
    if (dep > 0) return 'returned'
    const days = c.call_date ? daysBetween(c.call_date, today) : 999
    if (days > 7) return 'churned'
    return 'tracking'
  }

  const filtered = customers.filter(c => {
    if (c.do_not_call) return false
    if (siteFilter && c.siteName !== siteFilter) return false
    if (statusFilter && getStatus(c) !== statusFilter) return false
    if (phoneSearch) {
      const search = phoneSearch.replace(/\D/g, '')
      const phone = String(c.phone || '')
      if (!phone.includes(search) && !('0' + phone).includes(search)) return false
    }
    if (callResultFilter === 'answered' && !c.answered) return false
    if (callResultFilter === 'not_answered' && !c.not_answered) return false
    if (callResultFilter === 'no_call' && (c.answered || c.not_answered)) return false
    const cc = (c as any).call_count || 0
    if (callCountFilter === '0' && cc !== 0) return false
    if (callCountFilter === '1' && cc !== 1) return false
    if (callCountFilter === '2' && cc !== 2) return false
    if (callCountFilter === '3+' && cc < 3) return false
    return true
  })

  const stats = {
    total: customers.length,
    answered: customers.filter(c => c.answered).length,
    returned: customers.filter(c => parseFloat(String(c.total_deposit || 0)) > 0).length,
    deposit: customers.reduce((s, c) => s + parseFloat(String(c.total_deposit || 0)), 0),
  }

  const gapDist = [0, 1, 2, 3, 4, 5, 6].map(g => ({
    label: g === 0 ? 'วันนี้' : `${g} วัน`,
    count: customers.filter(c => c.call_date && daysBetween(c.call_date, today) === g).length
  }))

  const statusBadge = (c: Customer & { siteName: string }) => {
    const s = getStatus(c)
    if (s === 'returned') return <span className="st st-returned"><span className="dot" />กลับมาแล้ว</span>
    if (s === 'churned') return <span className="st st-notans"><span className="dot" />หายไปอีก</span>
    return <span className="st st-tracking"><span className="dot" />กำลังติดตาม</span>
  }

  return (
    <div>
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '13px 24px', position: 'sticky', top: 0, zIndex: 50 }}>
        <h2 style={{ fontSize: '15px', fontWeight: 600 }}>📞 การโทรติดตาม</h2>
      </div>
      <div style={{ padding: '20px' }}>
        <div style={{ display: 'flex', gap: '0', marginBottom: '18px', borderBottom: '2px solid var(--border)' }}>
          <button onClick={() => setTab('week')} style={{ padding: '10px 20px', fontSize: '13px', fontWeight: 600, border: 'none', borderBottom: `2px solid ${tab === 'week' ? 'var(--accent)' : 'transparent'}`, color: tab === 'week' ? 'var(--accent)' : 'var(--text2)', background: 'transparent', cursor: 'pointer', marginBottom: '-2px' }}>
            🔔 รายการที่ต้องโทร
          </button>
          <button onClick={() => setTab('callback')} style={{ padding: '10px 20px', fontSize: '13px', fontWeight: 600, border: 'none', borderBottom: `2px solid ${tab === 'callback' ? 'var(--accent)' : 'transparent'}`, color: tab === 'callback' ? 'var(--accent)' : 'var(--text2)', background: 'transparent', cursor: 'pointer', marginBottom: '-2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            📞 นัดหมายการโทร
            {callbacks.filter(c => c.called_by === currentUserId).length > 0 && <span style={{ background: '#dc2626', color: '#fff', fontSize: '10px', padding: '1px 7px', borderRadius: '10px', fontWeight: 700 }}>{callbacks.filter(c => c.called_by === currentUserId).length}</span>}
          </button>
          {userRole !== 'viewer' && <button onClick={() => setTab('log')} style={{ padding: '10px 20px', fontSize: '13px', fontWeight: 600, border: 'none', borderBottom: `2px solid ${tab === 'log' ? 'var(--accent)' : 'transparent'}`, color: tab === 'log' ? 'var(--accent)' : 'var(--text2)', background: 'transparent', cursor: 'pointer', marginBottom: '-2px' }}>
            📝 บันทึกการโทร
          </button>}
          <button onClick={() => setTab('dnc')} style={{ padding: '10px 20px', fontSize: '13px', fontWeight: 600, border: 'none', borderBottom: `2px solid ${tab === 'dnc' ? 'var(--accent)' : 'transparent'}`, color: tab === 'dnc' ? 'var(--accent)' : 'var(--text2)', background: 'transparent', cursor: 'pointer', marginBottom: '-2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            🚫 ห้ามโทร
            {dncList.length > 0 && <span style={{ background: '#dc2626', color: '#fff', fontSize: '10px', padding: '1px 7px', borderRadius: '10px', fontWeight: 700 }}>{dncList.length}</span>}
          </button>
        </div>

        {tab === 'callback' && (
          <>
            {/* ─── Add Call Form ─── */}
            {userRole !== 'viewer' && <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '14px', padding: '20px', marginBottom: '20px' }}>
              <div style={{ fontSize: '14px', fontWeight: 700, marginBottom: '14px', color: 'var(--text)' }}>📞 บันทึกการโทรติดตาม</div>
              <form onSubmit={handleAddCall} style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div className="form-group" style={{ flex: 1, minWidth: '140px' }}>
                  <label style={{ color: '#1a1a1a', fontWeight: 700 }}>เบอร์โทร</label>
                  <input value={cbForm.phone} onChange={e => setCbForm({ ...cbForm, phone: e.target.value })} placeholder="0812345678" required />
                </div>
                <div className="form-group" style={{ flex: 1, minWidth: '140px' }}>
                  <label style={{ color: '#1a1a1a', fontWeight: 700 }}>เว็บ</label>
                  <select value={cbForm.site_id} onChange={e => setCbForm({ ...cbForm, site_id: e.target.value })} required style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '7px 10px', borderRadius: '8px', fontSize: '13px' }}>
                    <option value="">-- เลือกเว็บ --</option>
                    {sites.map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
                  </select>
                </div>
                <div className="form-group" style={{ flex: 1, minWidth: '140px' }}>
                  <label style={{ color: '#1a1a1a', fontWeight: 700 }}>วันที่ต้องโทร</label>
                  <input type="date" value={cbForm.call_date} onChange={e => setCbForm({ ...cbForm, call_date: e.target.value })} />
                </div>
                <div className="form-group" style={{ flex: 1, minWidth: '140px' }}>
                  <label style={{ color: '#1a1a1a', fontWeight: 700 }}>หมายเหตุ (ไม่บังคับ)</label>
                  <input value={cbForm.note} onChange={e => setCbForm({ ...cbForm, note: e.target.value })} placeholder="เช่น โทรติดตามรอบ 2" />
                </div>
                <button type="submit" className="btn btn-primary" disabled={cbSaving} style={{ padding: '8px 20px', whiteSpace: 'nowrap', height: '38px' }}>
                  {cbSaving ? 'กำลังบันทึก...' : '+ บันทึก'}
                </button>
              </form>
              {cbToast && <div style={{ marginTop: '10px', fontSize: '13px', color: cbToast.includes('สำเร็จ') ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{cbToast}</div>}
            </div>}

            {/* ─── Callbacks Due ─── */}
            {(() => { const myCallbacks = callbacks.filter(c => c.called_by === currentUserId); return myCallbacks.length > 0 ? (
              <div style={{ marginBottom: '20px' }}>
                <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '10px' }}>📞 นัดโทรที่ถึงกำหนด ({myCallbacks.length} รายการ)</div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr><th>#</th><th>เบอร์โทร</th><th>เว็บ</th><th>เวลานัด</th><th>สถานะนัด</th><th>ยอดฝาก</th></tr>
                    </thead>
                    <tbody>
                      {myCallbacks.map((c, i) => {
                        const isOverdue = new Date(c.next_call_at!) < new Date()
                        const dep = parseFloat(String(c.total_deposit || 0))
                        return (
                          <tr key={c.id}>
                            <td style={{ color: 'var(--text3)' }}>{i + 1}</td>
                            <td style={{ fontSize: '13px' }}>0{c.phone}</td>
                            <td><a href={`/sites/${encodeURIComponent(c.siteName)}`} style={{ color: 'var(--accent)', fontSize: '12px' }}>{c.siteName}</a></td>
                            <td style={{ fontSize: '12px' }}>{new Date(c.next_call_at!).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' })}</td>
                            <td>
                              {isOverdue
                                ? <span style={{ background: '#fee2e2', color: '#dc2626', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700 }}>เลยนัด</span>
                                : <span style={{ background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700 }}>นัดวันนี้</span>}
                            </td>
                            <td style={{ fontWeight: dep > 0 ? 700 : 400, color: dep > 0 ? 'var(--green)' : 'var(--text3)' }}>{dep > 0 ? `฿${dep.toLocaleString()}` : '-'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null })()}

            {/* ─── Call Logs with Filter ─── */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '14px', padding: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)' }}>📋 ประวัติการบันทึก ({(cbSiteFilter ? callLogs.filter(c => c.siteName === cbSiteFilter) : callLogs).length} รายการ)</div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <input type="date" value={cbDateFrom} onChange={e => setCbDateFrom(e.target.value)} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '5px 10px', borderRadius: '8px', fontSize: '12px' }} />
                  <span style={{ color: 'var(--text3)', fontSize: '12px' }}>ถึง</span>
                  <input type="date" value={cbDateTo} onChange={e => setCbDateTo(e.target.value)} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '5px 10px', borderRadius: '8px', fontSize: '12px' }} />
                  <select value={cbSiteFilter} onChange={e => setCbSiteFilter(e.target.value)} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', padding: '5px 10px', borderRadius: '8px', fontSize: '12px' }}>
                    <option value="">ทุกเว็บ</option>
                    {sites.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                  </select>
                  <button className="btn btn-success" onClick={loadFilteredLogs}>🔍 ค้นหา</button>
                  {userRole !== 'viewer' && <button className="btn-export" onClick={exportCallLogs} disabled={cbExporting}>
                    {cbExporting ? 'กำลังสร้าง...' : '📥 ออกรายงาน'}
                  </button>}
                </div>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>#</th><th>เบอร์โทร</th><th>เว็บ</th><th>วันที่โทร</th><th>เวลา</th><th>หมายเหตุ</th></tr>
                  </thead>
                  <tbody>
                    {(() => { const displayLogs = cbSiteFilter ? callLogs.filter(c => c.siteName === cbSiteFilter) : callLogs; return displayLogs.length === 0 ? (
                      <tr><td colSpan={6} style={{ textAlign: 'center', padding: '30px', color: 'var(--text3)' }}>ไม่มีประวัติการโทร</td></tr>
                    ) : displayLogs.map((c, i) => {
                      return (
                        <tr key={c.id}>
                          <td style={{ color: 'var(--text3)' }}>{i + 1}</td>
                          <td style={{ fontSize: '13px' }}>0{c.phone}</td>
                          <td><a href={`/sites/${encodeURIComponent(c.siteName)}`} style={{ color: 'var(--accent)', fontSize: '12px' }}>{c.siteName}</a></td>
                          <td style={{ fontSize: '12px' }}>{c.call_date || '-'}</td>
                          <td style={{ fontSize: '12px', color: 'var(--text2)' }}>{c.call_time || '-'}</td>
                          <td style={{ fontSize: '12px', color: 'var(--text2)', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.note || '-'}</td>
                        </tr>
                      )
                    }) })()}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {tab === 'week' && <>

        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', gap: '10px', color: 'var(--text3)' }}><div className="spinner" /> กำลังโหลด...</div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
              <div className="form-group" style={{ flex: 'none' }}>
                <label>วันที่เริ่มต้น</label>
                <input type="date" value={weekStart} onChange={e => { const d = new Date(e.target.value); const diff = Math.round((d.getTime() - new Date(fmt(new Date())).getTime()) / (7 * 86400000)); setWeekOffset(diff) }} style={{ padding: '6px 10px' }} />
              </div>
              <div className="form-group" style={{ flex: 'none' }}>
                <label>วันที่สิ้นสุด</label>
                <input type="date" value={weekEnd} onChange={e => { const d = new Date(e.target.value); const diff = Math.round((d.getTime() - new Date(fmt(new Date())).getTime()) / (7 * 86400000)); setWeekOffset(diff) }} style={{ padding: '6px 10px' }} />
              </div>
              <input value={phoneSearch} onChange={e => setPhoneSearch(e.target.value)} placeholder="ค้นหาเบอร์..." style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 10px', borderRadius: '8px', fontSize: '12px', width: '130px' }} />
              <select value={siteFilter} onChange={e => setSiteFilter(e.target.value)} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', padding: '6px 10px', borderRadius: '8px', fontSize: '12px' }}>
                <option value="">ทุกเว็บ</option>
                {sites.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
              <button className="btn btn-success" onClick={() => load()}>🔍 ค้นหา</button>
              {userRole !== 'viewer' && <button className="btn-export" onClick={exportSchedule} disabled={schedExporting}>
                {schedExporting ? 'กำลังสร้าง...' : '📥 ออกรายงาน'}
              </button>}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '14px', marginBottom: '16px' }}>
              <div className="card blue"><div className="card-label">ต้องโทรวันนี้</div><div className="card-value">{callStats.today}</div><div className="card-sub">เบอร์</div></div>
              <div className="card green"><div className="card-label">สัปดาห์นี้</div><div className="card-value">{callStats.week}</div><div className="card-sub">เบอร์</div></div>
              <div className="card yellow"><div className="card-label">2 สัปดาห์นี้</div><div className="card-value">{callStats.twoWeeks}</div><div className="card-sub">เบอร์</div></div>
              <div className="card red"><div className="card-label">เดือนนี้</div><div className="card-value">{callStats.month}</div><div className="card-sub">เบอร์</div></div>
            </div>

            <div style={{ marginBottom: '14px' }}>
              <span style={{ fontSize: '15px', fontWeight: 600 }}>📅 นัดหมายจะถึงเร็วๆนี้</span>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th><th>เบอร์โทร</th><th>เว็บ</th><th>วันนัดโทร</th>
                    <th>เหลืออีก</th><th>หมายเหตุ</th>
                  </tr>
                </thead>
                <tbody>
                  {urgentCalls.length === 0 ? (
                    <tr><td colSpan={6} style={{ textAlign: 'center', padding: '30px', color: 'var(--text3)' }}>ไม่มีรายการที่ต้องโทร</td></tr>
                  ) : urgentCalls.map((c, i) => {
                    const daysLeft = c.call_date ? daysBetween(today, c.call_date) : 0
                    return (
                      <tr key={c.id} style={daysLeft <= 0 ? { background: 'rgba(220,38,38,.04)' } : daysLeft <= 1 ? { background: 'rgba(234,179,8,.04)' } : {}}>
                        <td style={{ color: 'var(--text3)' }}>{i + 1}</td>
                        <td style={{ fontSize: '13px' }}>0{c.phone}</td>
                        <td><a href={`/sites/${encodeURIComponent(c.siteName)}`} style={{ color: 'var(--accent)', fontSize: '12px' }}>{c.siteName}</a></td>
                        <td style={{ fontSize: '12px' }}>{c.call_date || '-'}</td>
                        <td>
                          <span style={{ padding: '2px 10px', borderRadius: '10px', fontSize: '11px', fontWeight: 700, background: daysLeft <= 0 ? '#fee2e2' : daysLeft <= 1 ? '#fef3c7' : '#dcfce7', color: daysLeft <= 0 ? '#b91c1c' : daysLeft <= 1 ? '#b45309' : '#15803d' }}>
                            {daysLeft <= 0 ? 'วันนี้!' : daysLeft === 1 ? 'พรุ่งนี้' : `${daysLeft} วัน`}
                          </span>
                        </td>
                        <td style={{ fontSize: '12px', color: 'var(--text3)' }}>{c.note || '-'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

          </>
        )}
        </>}

        {tab === 'log' && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '14px', padding: '20px' }}>
            <div style={{ fontSize: '14px', fontWeight: 700, marginBottom: '16px', color: 'var(--text)' }}>📝 บันทึกผลการโทร</div>
            {logPhoneInfo?.nextCallAt && (
              <div style={{ background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: '10px', padding: '10px 14px', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '16px' }}>⏰</span>
                <span style={{ fontSize: '13px', color: '#92400e', fontWeight: 600 }}>นัดโทร: {new Date(logPhoneInfo.nextCallAt).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' })}</span>
                <span style={{ fontSize: '11px', color: '#b45309' }}>(บันทึกผลสายใหม่จะล้างนัดนี้)</span>
              </div>
            )}
            {logPhoneInfo?.isDnc && (
              <div style={{ background: '#fee2e2', border: '1px solid #dc2626', borderRadius: '10px', padding: '10px 14px', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '16px' }}>🚫</span>
                <span style={{ fontSize: '13px', color: '#991b1b', fontWeight: 600 }}>เบอร์นี้อยู่ในรายการห้ามโทร{logPhoneInfo.dncReason ? ` — ${logPhoneInfo.dncReason}` : ''}</span>
              </div>
            )}
            <form onSubmit={handleLogCall}>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <div className="form-group" style={{ flex: 1, minWidth: '140px' }}>
                  <label style={{ fontWeight: 700 }}>เบอร์โทร *</label>
                  <input value={logForm.phone} onChange={e => { setLogForm({ ...logForm, phone: e.target.value }); lookupPhone(e.target.value) }} placeholder="0812345678" required />
                </div>
                <div className="form-group" style={{ flex: 1, minWidth: '140px' }}>
                  <label style={{ fontWeight: 700 }}>เว็บ *</label>
                  <select value={logForm.site_id} onChange={e => setLogForm({ ...logForm, site_id: e.target.value })} required style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '7px 10px', borderRadius: '8px', fontSize: '13px', width: '100%' }}>
                    <option value="">-- เลือกเว็บ --</option>
                    {sites.map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
                  </select>
                </div>
                <div className="form-group" style={{ flex: 1, minWidth: '120px' }}>
                  <label style={{ fontWeight: 700 }}>วันที่</label>
                  <input type="date" value={logForm.call_date} onChange={e => setLogForm({ ...logForm, call_date: e.target.value })} />
                </div>
                <div className="form-group" style={{ flex: 1, minWidth: '140px' }}>
                  <label style={{ fontWeight: 700 }}>ผลสาย *</label>
                  <select value={logForm.result} onChange={e => setLogForm({ ...logForm, result: e.target.value as any })} required style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '7px 10px', borderRadius: '8px', fontSize: '13px', width: '100%' }}>
                    <option value="">-- เลือกผลสาย --</option>
                    <option value="answered">✅ รับสาย</option>
                    <option value="not_answered">❌ ไม่รับสาย</option>
                  </select>
                </div>
              </div>

              {logForm.result === 'answered' && (
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '10px' }}>
                  <div className="form-group" style={{ flex: 1, minWidth: '140px' }}>
                    <label style={{ fontWeight: 700 }}>ยอดฝาก (฿)</label>
                    <input type="number" value={logForm.deposit} onChange={e => setLogForm({ ...logForm, deposit: e.target.value })} placeholder="0" min="0" />
                  </div>
                  <div className="form-group" style={{ flex: 1, minWidth: '140px' }}>
                    <label style={{ fontWeight: 700 }}>โปรโมชั่น</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px' }}>
                        <input type="checkbox" checked={logForm.promo} onChange={e => setLogForm({ ...logForm, promo: e.target.checked })} style={{ accentColor: 'var(--accent)' }} />
                        สนใจโปรโมชั่น
                      </label>
                    </div>
                  </div>
                  {logForm.promo && (
                    <div className="form-group" style={{ flex: 1, minWidth: '140px' }}>
                      <label style={{ fontWeight: 700 }}>ประเภทโปร</label>
                      <input value={logForm.promo_type} onChange={e => setLogForm({ ...logForm, promo_type: e.target.value })} placeholder="เช่น รับโบนัส 50%" />
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '10px' }}>
                <div className="form-group" style={{ flex: 1, minWidth: '140px' }}>
                  <label style={{ fontWeight: 700 }}>นัดโทรครั้งต่อไป</label>
                  <input type="datetime-local" value={logForm.next_call} onChange={e => setLogForm({ ...logForm, next_call: e.target.value })} />
                </div>
                <div className="form-group" style={{ flex: 2, minWidth: '200px' }}>
                  <label style={{ fontWeight: 700 }}>หมายเหตุ</label>
                  <input value={logForm.note} onChange={e => setLogForm({ ...logForm, note: e.target.value })} placeholder="รายละเอียดเพิ่มเติม..." />
                </div>
                <button type="submit" className="btn btn-primary" disabled={logSaving} style={{ padding: '8px 24px', whiteSpace: 'nowrap', alignSelf: 'flex-end', height: '38px' }}>
                  {logSaving ? 'กำลังบันทึก...' : '💾 บันทึก'}
                </button>
              </div>
              {logToast && <div style={{ marginTop: '10px', fontSize: '13px', color: logToast.includes('สำเร็จ') ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{logToast}</div>}
            </form>
          </div>
        )}

        {tab === 'dnc' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ fontSize: '15px', fontWeight: 600 }}>🚫 รายการเบอร์ห้ามโทร ({(() => { let list = dncList; if (dncSiteFilter) list = list.filter(c => c.siteName === dncSiteFilter); if (dncPhoneSearch) { const s = dncPhoneSearch.replace(/\D/g, ''); list = list.filter(c => { const p = String(c.phone || ''); return p.includes(s) || ('0' + p).includes(s) }) } return list.length })()} รายการ)</div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <input value={dncPhoneSearch} onChange={e => setDncPhoneSearch(e.target.value)} placeholder="ค้นหาเบอร์..." style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 10px', borderRadius: '8px', fontSize: '12px', width: '130px' }} />
                <select value={dncSiteFilter} onChange={e => setDncSiteFilter(e.target.value)} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', padding: '6px 10px', borderRadius: '8px', fontSize: '12px' }}>
                  <option value="">ทุกเว็บ</option>
                  {sites.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
                {userRole !== 'viewer' && <button className="btn-export" onClick={exportDnc} disabled={dncExporting}>
                  {dncExporting ? 'กำลังสร้าง...' : '📥 ออกรายงาน'}
                </button>}
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead className="dark">
                  <tr><th>#</th><th>เบอร์โทร</th><th>เว็บ</th><th>เหตุผล</th><th>วันที่โทร</th><th>หมายเหตุ</th></tr>
                </thead>
                <tbody>
                  {(() => {
                    let list = dncList
                    if (dncSiteFilter) list = list.filter(c => c.siteName === dncSiteFilter)
                    if (dncPhoneSearch) { const s = dncPhoneSearch.replace(/\D/g, ''); list = list.filter(c => { const p = String(c.phone || ''); return p.includes(s) || ('0' + p).includes(s) }) }
                    return list.length === 0 ? (
                      <tr><td colSpan={6} style={{ textAlign: 'center', padding: '30px', color: 'var(--text3)' }}>ไม่มีเบอร์ห้ามโทร</td></tr>
                    ) : list.map((c, i) => (
                      <tr key={c.id}>
                        <td style={{ color: 'var(--text3)' }}>{i + 1}</td>
                        <td style={{ fontSize: '13px' }}>0{c.phone}</td>
                        <td><a href={`/sites/${encodeURIComponent(c.siteName)}`} style={{ color: 'var(--accent)', fontSize: '12px' }}>{c.siteName}</a></td>
                        <td style={{ fontSize: '12px', color: '#dc2626', fontWeight: 600 }}>{c.do_not_call_reason || '-'}</td>
                        <td style={{ fontSize: '12px' }}>{c.call_date || '-'}</td>
                        <td style={{ fontSize: '12px', color: 'var(--text2)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.note || '-'}</td>
                      </tr>
                    ))
                  })()}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
