'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase-client'
import { logAudit } from '@/lib/audit'
import type { Site, WeeklySummary, Customer } from '@/lib/types'
import { SITE_ORDER } from '@/lib/constants'

const SITE_COLORS: Record<string, { from: string; to: string; light: string; text: string }> = {
  'มรกต':      { from: '#0f7279', to: '#064e57', light: '#ccf5f7', text: '#0a5560' },
  'เป๋าตุง168': { from: '#4ab3d0', to: '#1a7a9e', light: '#e0f4fa', text: '#1e6f8a' },
  'หวยพลัส':   { from: '#2d8c1e', to: '#0f4a08', light: '#dcfce7', text: '#166534' },
  'ตัวเต็ง168': { from: '#3d2a8a', to: '#110a42', light: '#ede9fe', text: '#3730a3' },
  'เมก้า168':   { from: '#2b52a8', to: '#0f1f5a', light: '#dbeafe', text: '#1e3a8a' },
  'ออมสิน168':  { from: '#ec4899', to: '#9d1a5a', light: '#fce7f3', text: '#9d174d' },
  'มณี159':    { from: '#1a6b3a', to: '#0a3a1e', light: '#dcfce7', text: '#145228' },
  'ไพศาล':     { from: '#1e3a8a', to: '#0a1232', light: '#dbeafe', text: '#1e3a8a' },
  'แสงเพชร':   { from: '#6b7280', to: '#374151', light: '#f3f4f6', text: '#374151' },
}
const FALLBACK_COLOR = { from: '#6c63ff', to: '#4f46e5', light: '#ede9fe', text: '#4f46e5' }

const reportTypes = [
  { key: 'all', label: 'รายงานครบชุด', desc: 'สรุปรวม + แยกเว็บ', icon: '📦' },
  { key: 'customers', label: 'รายชื่อลูกค้าทั้งหมด', desc: 'รายชื่อลูกค้าพร้อมสถานะและยอดฝาก', icon: '👥' },
  { key: 'returned', label: 'กลับมาฝากแล้ว', desc: 'เฉพาะลูกค้าที่กลับมาฝากพร้อมยอด', icon: '✅' },
  { key: 'not_returned', label: 'ยังไม่กลับมาฝาก', desc: 'เฉพาะลูกค้าที่ยังไม่กลับมาฝาก', icon: '⏳' },
]

function getQuickRange(key: string): { from: string; to: string } {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const d = now.getDay()
  const fmt = (dt: Date) => dt.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })

  if (key === 'thisWeek') {
    const mon = new Date(now); mon.setDate(now.getDate() - (d === 0 ? 6 : d - 1))
    return { from: fmt(mon), to: fmt(now) }
  }
  if (key === 'lastWeek') {
    const mon = new Date(now); mon.setDate(now.getDate() - (d === 0 ? 13 : d + 6))
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
    return { from: fmt(mon), to: fmt(sun) }
  }
  if (key === 'thisMonth') {
    return { from: `${y}-${String(m + 1).padStart(2, '0')}-01`, to: fmt(now) }
  }
  if (key === 'lastMonth') {
    const pm = m === 0 ? 11 : m - 1
    const py = m === 0 ? y - 1 : y
    const lastDay = new Date(py, pm + 1, 0)
    return { from: `${py}-${String(pm + 1).padStart(2, '0')}-01`, to: fmt(lastDay) }
  }
  return { from: '', to: '' }
}

interface SiteSummary {
  name: string
  total_calls: number
  answered: number
  not_answered: number
  return_customers: number
  return_deposit: number
  bonus: number
}

export default function ReportsPage() {
  const [sites, setSites] = useState<Site[]>([])
  const [selType, setSelType] = useState('all')
  const [selSite, setSelSite] = useState('')
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(1)
    return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
  })
  const [dateTo, setDateTo] = useState(() => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }))
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState({ msg: '', type: '' })
  const [summaryData, setSummaryData] = useState<SiteSummary[]>([])
  const [loadingTable, setLoadingTable] = useState(false)
  const [sortBy, setSortBy] = useState<string>('')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [userRole, setUserRole] = useState('')
  const supabase = createClient()

  useEffect(() => {
    supabase.from('sites').select('*').order('id').then(({ data }) => setSites(data || []))
    loadRole()
  }, [])

  async function loadRole() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const saved = localStorage.getItem('impersonate_role')
    const { data: profile } = await supabase.from('user_profiles').select('role').eq('id', user.id).single()
    const real = profile?.role || user.user_metadata?.role || ''
    if (saved && (real === 'manager' || real === 'admin')) setUserRole(saved)
    else setUserRole(real)
  }

  useEffect(() => { loadSummary() }, [dateFrom, dateTo])

  async function loadSummary() {
    if (!dateFrom || !dateTo) return
    if (dateFrom > dateTo) return
    setLoadingTable(true)

    const { data: allSites } = await supabase.from('sites').select('id, name')
    const { data: custs } = await supabase
      .from('customers')
      .select('site_id, answered, not_answered, total_deposit')
      .gte('call_date', dateFrom)
      .lte('call_date', dateTo)

    const { data: weekly } = await supabase
      .from('weekly_summary')
      .select('site_id, bonus')
      .gte('week_start', dateFrom)
      .lte('week_end', dateTo)

    const result: SiteSummary[] = []
    for (const s of allSites || []) {
      const siteCusts = (custs || []).filter(c => c.site_id === s.id)
      const siteWeekly = (weekly || []).filter(w => w.site_id === s.id)
      result.push({
        name: s.name,
        total_calls: siteCusts.length,
        answered: siteCusts.filter(c => c.answered).length,
        not_answered: siteCusts.filter(c => c.not_answered).length,
        return_customers: siteCusts.filter(c => parseFloat(String(c.total_deposit || 0)) > 0).length,
        return_deposit: siteCusts.reduce((sum, c) => sum + parseFloat(String(c.total_deposit || 0)), 0),
        bonus: siteWeekly.reduce((sum, w) => sum + parseFloat(String(w.bonus || 0)), 0),
      })
    }

    result.sort((a, b) => {
      const ai = SITE_ORDER.indexOf(a.name)
      const bi = SITE_ORDER.indexOf(b.name)
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
    })

    setSummaryData(result)
    setLoadingTable(false)
  }

  const totals = summaryData.reduce((acc, s) => ({
    total_calls: acc.total_calls + s.total_calls,
    answered: acc.answered + s.answered,
    not_answered: acc.not_answered + s.not_answered,
    return_customers: acc.return_customers + s.return_customers,
    return_deposit: acc.return_deposit + s.return_deposit,
    bonus: acc.bonus + s.bonus,
  }), { total_calls: 0, answered: 0, not_answered: 0, return_customers: 0, return_deposit: 0, bonus: 0 })

  function handleSort(col: string) {
    if (sortBy === col) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(col)
      setSortDir('asc')
    }
  }

  function getSortIndicator(col: string) {
    if (sortBy !== col) return ''
    return sortDir === 'asc' ? ' ▲' : ' ▼'
  }

  const sortedData = (() => {
    if (!sortBy) return summaryData
    return [...summaryData].sort((a, b) => {
      let av: number | string
      let bv: number | string
      if (sortBy === 'name') {
        av = a.name
        bv = b.name
      } else if (sortBy === 'answer_rate') {
        av = a.total_calls > 0 ? a.answered / a.total_calls : 0
        bv = b.total_calls > 0 ? b.answered / b.total_calls : 0
      } else {
        av = a[sortBy as keyof SiteSummary] as number
        bv = b[sortBy as keyof SiteSummary] as number
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  })()

  async function handleExport() {
    setLoading(true)
    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: selType, site: selSite || undefined, dateFrom, dateTo }),
      })
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `CRM_Report_${dateFrom}_${dateTo}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      logAudit({ action: 'report.export', entity: 'Report', entityId: selType, after: { type: selType, dateFrom, dateTo, site: selSite || 'ทุกเว็บ' } })
      setToast({ msg: 'ดาวน์โหลดสำเร็จ!', type: 'success' })
    } catch {
      setToast({ msg: 'เกิดข้อผิดพลาดในการออกรายงาน', type: 'error' })
    }
    setLoading(false)
    setTimeout(() => setToast({ msg: '', type: '' }), 3000)
  }

  function applyQuickRange(key: string) {
    const { from, to } = getQuickRange(key)
    setDateFrom(from)
    setDateTo(to)
  }

  return (
    <div>
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '13px 24px', position: 'sticky', top: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
        <h2 style={{ fontSize: '15px', fontWeight: 600 }}>📥 รายงาน & Export Excel</h2>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {[
            { key: 'thisWeek', label: 'สัปดาห์นี้' },
            { key: 'lastWeek', label: 'สัปดาห์ก่อน' },
            { key: 'thisMonth', label: 'เดือนนี้' },
            { key: 'lastMonth', label: 'เดือนก่อน' },
          ].map(b => (
            <button key={b.key} onClick={() => applyQuickRange(b.key)} className="filter-btn" style={{ fontSize: '12px' }}>{b.label}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: '20px' }}>
        {/* ─── Summary Table ─── */}
        <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '12px', color: 'var(--text)' }}>📊 สรุปรายเว็บ ({dateFrom} → {dateTo})</h3>

        {loadingTable ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '160px', gap: '10px', color: 'var(--text3)' }}><div className="spinner" /> กำลังโหลด...</div>
        ) : summaryData.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text3)', background: 'var(--surface)', borderRadius: '14px', border: '1px solid var(--border)', marginBottom: '28px' }}>ไม่พบข้อมูลในช่วงวันที่นี้</div>
        ) : (
          <div style={{ borderRadius: '14px', overflow: 'hidden', border: '1px solid var(--border)', marginBottom: '28px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid var(--border)' }}>
                  <th onClick={() => handleSort('name')} style={{ padding: '10px 18px', color: 'var(--text2)', fontSize: '13px', fontWeight: 700, textAlign: 'left', cursor: 'pointer', userSelect: 'none' }}>เว็บ{getSortIndicator('name')}</th>
                  <th onClick={() => handleSort('total_calls')} style={{ padding: '10px 18px', color: 'var(--text2)', fontSize: '13px', fontWeight: 700, textAlign: 'center', cursor: 'pointer', userSelect: 'none' }}>โทรติดตาม{getSortIndicator('total_calls')}</th>
                  <th onClick={() => handleSort('answered')} style={{ padding: '10px 18px', color: 'var(--text2)', fontSize: '13px', fontWeight: 700, textAlign: 'center', cursor: 'pointer', userSelect: 'none' }}>รับสาย{getSortIndicator('answered')}</th>
                  <th onClick={() => handleSort('answer_rate')} style={{ padding: '10px 18px', color: 'var(--text2)', fontSize: '13px', fontWeight: 700, textAlign: 'center', cursor: 'pointer', userSelect: 'none' }}>รับสาย %{getSortIndicator('answer_rate')}</th>
                  <th onClick={() => handleSort('not_answered')} style={{ padding: '10px 18px', color: 'var(--text2)', fontSize: '13px', fontWeight: 700, textAlign: 'center', cursor: 'pointer', userSelect: 'none' }}>ไม่รับสาย{getSortIndicator('not_answered')}</th>
                  <th onClick={() => handleSort('return_customers')} style={{ padding: '10px 18px', color: 'var(--text2)', fontSize: '13px', fontWeight: 700, textAlign: 'center', cursor: 'pointer', userSelect: 'none' }}>กลับมาฝาก{getSortIndicator('return_customers')}</th>
                  <th onClick={() => handleSort('return_deposit')} style={{ padding: '10px 18px', color: 'var(--text2)', fontSize: '13px', fontWeight: 700, textAlign: 'right', cursor: 'pointer', userSelect: 'none' }}>ยอดฝาก (฿){getSortIndicator('return_deposit')}</th>
                </tr>
              </thead>
              <tbody>
                {sortedData.map((s, i) => {
                  const c = SITE_COLORS[s.name] || FALLBACK_COLOR
                  const ar = s.total_calls > 0 ? ((s.answered / s.total_calls) * 100).toFixed(1) : '0.0'
                  return (
                    <tr key={s.name} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? '#fff' : '#f8fafc' }}>
                      <td style={{ padding: '10px 18px', fontSize: '13px', color: 'var(--text)' }}>
                        <span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '3px', background: `linear-gradient(135deg, ${c.from}, ${c.to})`, marginRight: '10px', verticalAlign: 'middle' }} />
                        {s.name}
                      </td>
                      <td style={{ padding: '10px 18px', textAlign: 'center', fontSize: '13px', color: 'var(--text)' }}>{s.total_calls.toLocaleString()}</td>
                      <td style={{ padding: '10px 18px', textAlign: 'center', fontSize: '13px', color: '#16a34a' }}>{s.answered.toLocaleString()}</td>
                      <td style={{ padding: '10px 18px', textAlign: 'center', fontSize: '13px', color: 'var(--text)' }}>{ar}%</td>
                      <td style={{ padding: '10px 18px', textAlign: 'center', fontSize: '13px', color: '#dc2626' }}>{s.not_answered.toLocaleString()}</td>
                      <td style={{ padding: '10px 18px', textAlign: 'center', fontSize: '13px', color: 'var(--text)' }}>{s.return_customers}</td>
                      <td style={{ padding: '10px 18px', textAlign: 'right', fontSize: '13px', color: '#16a34a' }}>฿{s.return_deposit.toLocaleString('th-TH', { maximumFractionDigits: 0 })}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: '#f1f5f9', borderTop: '2px solid var(--border)' }}>
                  <td style={{ padding: '10px 18px', fontWeight: 700, fontSize: '13px', color: 'var(--text)' }}>รวมทั้งหมด</td>
                  <td style={{ padding: '10px 18px', textAlign: 'center', fontSize: '13px', fontWeight: 700 }}>{totals.total_calls.toLocaleString()}</td>
                  <td style={{ padding: '10px 18px', textAlign: 'center', fontSize: '13px', fontWeight: 700, color: '#16a34a' }}>{totals.answered.toLocaleString()}</td>
                  <td style={{ padding: '10px 18px', textAlign: 'center', fontSize: '13px', fontWeight: 700, color: 'var(--text2)' }}>{totals.total_calls > 0 ? ((totals.answered / totals.total_calls) * 100).toFixed(1) : '0.0'}%</td>
                  <td style={{ padding: '10px 18px', textAlign: 'center', fontSize: '13px', fontWeight: 700, color: '#dc2626' }}>{totals.not_answered.toLocaleString()}</td>
                  <td style={{ padding: '10px 18px', textAlign: 'center', fontSize: '13px', fontWeight: 700, color: 'var(--accent)' }}>{totals.return_customers}</td>
                  <td style={{ padding: '10px 18px', textAlign: 'right', fontSize: '13px', fontWeight: 700, color: '#16a34a' }}>฿{totals.return_deposit.toLocaleString('th-TH', { maximumFractionDigits: 0 })}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* ─── Date Range + Site Filter ─── */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '16px', padding: '28px', maxWidth: '800px', marginBottom: '22px' }}>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1, minWidth: '180px' }}>
              <label style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text)' }}>เว็บไซต์</label>
              <select value={selSite} onChange={e => setSelSite(e.target.value)} style={{ padding: '12px 16px', borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: '15px', fontWeight: 600, width: '100%', height: '48px', boxSizing: 'border-box', WebkitAppearance: 'none', appearance: 'none' }}>
                <option value="">ทุกเว็บ</option>
                {sites.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1, minWidth: '180px' }}>
              <label style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text)' }}>วันที่เริ่ม</label>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ padding: '12px 16px', borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: '15px', fontWeight: 600, width: '100%', height: '48px' }} />
            </div>
            <span style={{ color: 'var(--text3)', fontSize: '15px', fontWeight: 600, paddingBottom: '14px' }}>ถึง</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1, minWidth: '180px' }}>
              <label style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text)' }}>วันที่จบ</label>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ padding: '12px 16px', borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: '15px', fontWeight: 600, width: '100%', height: '48px' }} />
            </div>
          </div>
          {dateFrom > dateTo && (
            <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '8px', padding: '8px 14px', fontSize: '13px', color: '#b91c1c', fontWeight: 600, marginTop: '14px' }}>
              วันเริ่มอยู่หลังวันจบ
            </div>
          )}
        </div>

        {/* ─── Export Settings ─── */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '16px', padding: '28px', maxWidth: '800px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '20px' }}>⬇️ ดาวน์โหลด Excel</h3>

          <div style={{ marginBottom: '24px' }}>
            <label style={{ fontSize: '11px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.4px', display: 'block', marginBottom: '12px' }}>ประเภทรายงาน</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {reportTypes.map(r => (
                <label key={r.key} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', background: selType === r.key ? 'rgba(108,99,255,.12)' : 'var(--surface2)', border: `1px solid ${selType === r.key ? 'var(--accent)' : 'var(--border)'}`, borderRadius: '10px', cursor: 'pointer', transition: 'all .15s' }}>
                  <input type="radio" name="type" value={r.key} checked={selType === r.key} onChange={() => setSelType(r.key)} style={{ accentColor: 'var(--accent)' }} />
                  <span style={{ fontSize: '20px' }}>{r.icon}</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '14px' }}>{r.label}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text2)', marginTop: '2px' }}>{r.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '10px', padding: '14px 16px', marginBottom: '24px', fontSize: '13px' }}>
            <div style={{ fontWeight: 600, marginBottom: '8px' }}>📋 สรุปการตั้งค่า</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', color: 'var(--text2)' }}>
              <div>ประเภท: <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{reportTypes.find(r => r.key === selType)?.label}</span></div>
              <div>ช่วงวันที่: <span style={{ color: 'var(--text)' }}>{dateFrom} → {dateTo}</span></div>
              <div>เว็บ: <span style={{ color: 'var(--text)' }}>{selSite || 'ทุกเว็บ'}</span></div>
            </div>
          </div>

          {userRole !== 'viewer' ? (
            <button className="btn-export" onClick={handleExport} disabled={loading || dateFrom > dateTo} style={{ width: '100%', padding: '13px', fontSize: '15px', justifyContent: 'center' }}>
              {loading ? <><span className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px', verticalAlign: 'middle', marginRight: '8px' }} />กำลังสร้างไฟล์...</> : '📥 ออกรายงาน'}
            </button>
          ) : (
            <div style={{ width: '100%', padding: '13px', fontSize: '14px', textAlign: 'center', color: 'var(--text3)', background: 'var(--surface2)', borderRadius: '8px', border: '1px solid var(--border)' }}>🔒 ไม่มีสิทธิ์ออกรายงาน (Viewer)</div>
          )}
        </div>

        {toast.msg && (
          <div className={`toast ${toast.type}`} style={{ position: 'fixed', bottom: '24px', right: '24px' }}>{toast.msg}</div>
        )}
      </div>
    </div>
  )
}
