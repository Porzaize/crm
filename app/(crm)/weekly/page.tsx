'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { logAudit } from '@/lib/audit'
import type { Site } from '@/lib/types'

function fmt(d: Date) { return d.toISOString().split('T')[0] }

export default function WeeklyPage() {
  const [data, setData] = useState<any[]>([])
  const [sites, setSites] = useState<Site[]>([])
  const [loading, setLoading] = useState(true)
  const [siteFilter, setSiteFilter] = useState('')
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - d.getDay() + (d.getDay() === 0 ? -6 : 1))
    return fmt(d)
  })
  const [dateTo, setDateTo] = useState(fmt(new Date()))
  const [exporting, setExporting] = useState(false)
  const [selType, setSelType] = useState('all')
  const [toast, setToast] = useState({ msg: '', type: '' })
  const [sortBy, setSortBy] = useState('')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [expFrom, setExpFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - d.getDay() + (d.getDay() === 0 ? -6 : 1)); return fmt(d)
  })
  const [expTo, setExpTo] = useState(fmt(new Date()))
  const [expSite, setExpSite] = useState('')
  const [userRole, setUserRole] = useState('')
  const supabase = createClient()

  useEffect(() => { load(); loadRole() }, [])

  async function loadRole() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const saved = localStorage.getItem('impersonate_role')
    const { data: profile } = await supabase.from('user_profiles').select('role').eq('id', user.id).single()
    const real = profile?.role || user.user_metadata?.role || ''
    if (saved && (real === 'manager' || real === 'admin')) setUserRole(saved)
    else setUserRole(real)
  }

  async function load(overrides?: { dateFrom?: string, dateTo?: string, siteFilter?: string }) {
    setLoading(true)
    const df = overrides?.dateFrom ?? dateFrom
    const dt = overrides?.dateTo ?? dateTo
    const sf = overrides?.siteFilter ?? siteFilter

    const { data: siteList } = await supabase.from('sites').select('*').order('id')
    setSites(siteList || [])

    let q = supabase.from('customers').select('*, sites(name)')
      .gte('call_date', df).lte('call_date', dt).order('site_id')
    if (sf) {
      const site = (siteList || []).find(s => s.name === sf)
      if (site) q = q.eq('site_id', site.id)
    }
    const { data: customers } = await q

    const { data: weekly } = await supabase.from('weekly_summary').select('*, sites(name)').order('site_id')
    const bonusBySite: Record<string, number> = {}
    for (const w of weekly || []) {
      const name = w.sites?.name || ''
      bonusBySite[name] = (bonusBySite[name] || 0) + parseFloat(String(w.bonus || 0))
    }

    const targetSites = sf ? (siteList || []).filter(s => s.name === sf) : (siteList || [])
    const siteMap: Record<string, any> = {}
    for (const s of targetSites) {
      siteMap[s.name] = { siteName: s.name, total_calls: 0, answered: 0, not_answered: 0, return_customers: 0, return_deposit: 0, bonus: bonusBySite[s.name] || 0 }
    }
    for (const c of customers || []) {
      const name = c.sites?.name || ''
      if (!siteMap[name]) siteMap[name] = { siteName: name, total_calls: 0, answered: 0, not_answered: 0, return_customers: 0, return_deposit: 0, bonus: bonusBySite[name] || 0 }
      siteMap[name].total_calls++
      if (c.answered) siteMap[name].answered++
      if (c.not_answered) siteMap[name].not_answered++
      const dep = parseFloat(String(c.total_deposit || 0))
      if (dep > 0) { siteMap[name].return_customers++; siteMap[name].return_deposit += dep }
    }

    setData(Object.values(siteMap))
    setLoading(false)
  }

  function quickDate(from: string, to: string) {
    setDateFrom(from); setDateTo(to)
    load({ dateFrom: from, dateTo: to })
  }
  function setToday() { const t = fmt(new Date()); quickDate(t, t) }
  function setYesterday() { const d = new Date(); d.setDate(d.getDate() - 1); const y = fmt(d); quickDate(y, y) }
  function setThisMonth() { const n = new Date(); quickDate(fmt(new Date(n.getFullYear(), n.getMonth(), 1)), fmt(new Date(n.getFullYear(), n.getMonth() + 1, 0))) }
  function setLastMonth() { const n = new Date(); quickDate(fmt(new Date(n.getFullYear(), n.getMonth() - 1, 1)), fmt(new Date(n.getFullYear(), n.getMonth(), 0))) }

  const total = {
    calls: data.reduce((s, w) => s + w.total_calls, 0),
    answered: data.reduce((s, w) => s + w.answered, 0),
    notAns: data.reduce((s, w) => s + w.not_answered, 0),
    returned: data.reduce((s, w) => s + w.return_customers, 0),
    deposit: data.reduce((s, w) => s + w.return_deposit, 0),
    bonus: data.reduce((s, w) => s + w.bonus, 0),
  }

  async function exportExcel() {
    setExporting(true)
    try {
      const res = await fetch('/api/export', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: selType, dateFrom: expFrom, dateTo: expTo, site: expSite || undefined }),
      })
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `CRM_Report_${expFrom}_${expTo}.xlsx`; a.click()
      URL.revokeObjectURL(url)
      logAudit({ action: 'report.export', entity: 'Report', entityId: selType, after: { type: selType, dateFrom: expFrom, dateTo: expTo, site: expSite || 'ทุกเว็บ' } })
      setToast({ msg: 'ดาวน์โหลดสำเร็จ!', type: 'success' })
    } catch {
      setToast({ msg: 'เกิดข้อผิดพลาดในการออกรายงาน', type: 'error' })
    }
    setExporting(false)
    setTimeout(() => setToast({ msg: '', type: '' }), 3000)
  }

  const reportTypes = [
    { key: 'all', label: 'รายงานครบชุด', desc: 'สรุปรวม + แยกเว็บ', icon: '📦' },
    { key: 'customers', label: 'รายชื่อลูกค้าทั้งหมด', desc: 'รายชื่อลูกค้าพร้อมสถานะและยอดฝาก', icon: '👥' },
    { key: 'returned', label: 'กลับมาฝากแล้ว', desc: 'เฉพาะลูกค้าที่กลับมาฝากพร้อมยอด', icon: '✅' },
    { key: 'not_returned', label: 'ยังไม่กลับมาฝาก', desc: 'เฉพาะลูกค้าที่ยังไม่กลับมาฝาก', icon: '⏳' },
  ]

  function toggleSort(col: string) {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(col); setSortDir('desc') }
  }

  function getValue(w: any, col: string): number {
    if (col === 'rate') return w.total_calls > 0 ? (w.answered / w.total_calls) * 100 : 0
    if (col === 'roi') {
      const dep = w.return_deposit
      return dep > 0 ? (w.bonus / dep) * 100 : 0
    }
    return w[col] ?? 0
  }

  const sortedData = sortBy
    ? [...data].sort((a, b) => {
        const va = getValue(a, sortBy)
        const vb = getValue(b, sortBy)
        return sortDir === 'asc' ? va - vb : vb - va
      })
    : data

  const sortIcon = (col: string) => sortBy === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''

  const thSortStyle: React.CSSProperties = { cursor: 'pointer', userSelect: 'none' }

  const btnStyle = (active?: boolean): React.CSSProperties => ({ background: active ? 'var(--accent)' : 'rgba(108,99,255,.15)', border: '1px solid var(--accent)', color: active ? '#fff' : 'var(--accent)', padding: '7px 16px', borderRadius: '8px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '12px', fontWeight: 600 })

  return (
    <div>
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '13px 24px', position: 'sticky', top: 0, zIndex: 50 }}>
        <h2 style={{ fontSize: '15px', fontWeight: 600 }}>📈 สรุปรายสัปดาห์/รายเดือน</h2>
      </div>
      <div style={{ padding: '20px' }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '14px', padding: '18px', marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', flexWrap: 'wrap' }}>
            <div className="form-group" style={{ flex: 'none' }}>
              <label>📅 จากวันที่</label>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ padding: '7px 10px' }} />
            </div>
            <div className="form-group" style={{ flex: 'none' }}>
              <label>📅 ถึงวันที่</label>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ padding: '7px 10px' }} />
            </div>
            <select value={siteFilter} onChange={e => setSiteFilter(e.target.value)} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', padding: '7px 10px', borderRadius: '8px', fontSize: '12px' }}>
              <option value="">ทุกเว็บ</option>
              {sites.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
            <button className="btn btn-success" onClick={() => load()}>🔍 ค้นหา</button>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <button onClick={setToday} style={btnStyle()}>วันนี้</button>
              <button onClick={setYesterday} style={btnStyle()}>เมื่อวาน</button>
              <button onClick={setThisMonth} style={btnStyle()}>เดือนนี้</button>
              <button onClick={setLastMonth} style={btnStyle()}>เดือนที่แล้ว</button>
            </div>
          </div>
        </div>

        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', gap: '10px', color: 'var(--text3)' }}><div className="spinner" /> กำลังโหลด...</div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '14px', marginBottom: '20px' }}>
              {[
                { label: 'โทรทั้งหมด', value: total.calls.toLocaleString(), sub: `รับสาย ${total.answered}`, color: 'blue' },
                { label: 'ไม่รับสาย', value: total.notAns.toLocaleString(), sub: `${total.calls > 0 ? ((total.notAns / total.calls) * 100).toFixed(1) : 0}%`, color: 'red' },
                { label: 'กลับมาฝาก', value: total.returned.toLocaleString(), sub: 'ราย', color: 'green' },
                { label: 'ยอดรวม', value: `฿${total.deposit.toLocaleString()}`, sub: `โบนัส ฿${total.bonus.toLocaleString()}`, color: 'yellow' },
              ].map(c => (
                <div key={c.label} className={`card ${c.color}`}>
                  <div className="card-label">{c.label}</div>
                  <div className="card-value">{c.value}</div>
                  <div className="card-sub">{c.sub}</div>
                </div>
              ))}
            </div>

            <div className="table-wrap">
              <table>
                <thead className="dark">
                  <tr>
                    <th>#</th><th>เว็บ</th>
                    <th style={thSortStyle} onClick={() => toggleSort('total_calls')}>โทรติดตาม{sortIcon('total_calls')}</th>
                    <th style={thSortStyle} onClick={() => toggleSort('answered')}>รับสาย{sortIcon('answered')}</th>
                    <th style={thSortStyle} onClick={() => toggleSort('rate')}>รับสาย%{sortIcon('rate')}</th>
                    <th style={thSortStyle} onClick={() => toggleSort('not_answered')}>ไม่รับสาย{sortIcon('not_answered')}</th>
                    <th style={thSortStyle} onClick={() => toggleSort('return_customers')}>กลับมาฝาก{sortIcon('return_customers')}</th>
                    <th style={thSortStyle} onClick={() => toggleSort('return_deposit')}>ยอดกลับมาฝาก{sortIcon('return_deposit')}</th>
                    <th style={thSortStyle} onClick={() => toggleSort('bonus')}>โบนัส{sortIcon('bonus')}</th>
                    <th style={thSortStyle} onClick={() => toggleSort('roi')}>ROI%{sortIcon('roi')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedData.length === 0 ? (
                    <tr><td colSpan={10} style={{ textAlign: 'center', padding: '30px', color: 'var(--text3)' }}>ไม่มีข้อมูลในช่วงวันที่ที่เลือก</td></tr>
                  ) : sortedData.map((w, i) => {
                    const dep = w.return_deposit
                    const bon = w.bonus
                    const rate = w.total_calls > 0 ? ((w.answered / w.total_calls) * 100).toFixed(1) : '0'
                    const roi = dep > 0 ? ((bon / dep) * 100).toFixed(1) : '0'
                    return (
                      <tr key={w.siteName}>
                        <td style={{ color: 'var(--text3)' }}>{i + 1}</td>
                        <td style={{ fontWeight: 600 }}>{w.siteName}</td>
                        <td>{w.total_calls}</td>
                        <td style={{ color: 'var(--green)' }}>{w.answered}</td>
                        <td>{rate}%</td>
                        <td style={{ color: 'var(--red)' }}>{w.not_answered}</td>
                        <td style={{ color: 'var(--accent)', fontWeight: 600 }}>{w.return_customers}</td>
                        <td style={{ fontWeight: 600 }}>฿{dep.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
                        <td>฿{bon.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
                        <td style={{ color: parseFloat(roi) > 5 ? 'var(--green)' : 'var(--text2)' }}>{roi}%</td>
                      </tr>
                    )
                  })}
                  {sortedData.length > 0 && (
                    <tr style={{ background: 'rgba(108,99,255,.06)', fontWeight: 700 }}>
                      <td colSpan={2}>รวมทั้งหมด</td>
                      <td>{total.calls}</td>
                      <td style={{ color: 'var(--green)' }}>{total.answered}</td>
                      <td>{total.calls > 0 ? ((total.answered / total.calls) * 100).toFixed(1) : 0}%</td>
                      <td style={{ color: 'var(--red)' }}>{total.notAns}</td>
                      <td style={{ color: 'var(--accent)' }}>{total.returned}</td>
                      <td>฿{total.deposit.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
                      <td>฿{total.bonus.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
                      <td>{total.deposit > 0 ? ((total.bonus / total.deposit) * 100).toFixed(1) : 0}%</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ─── Export Excel Section ─── */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '16px', padding: '28px', maxWidth: '800px', marginTop: '28px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '20px' }}>⬇️ ดาวน์โหลดสรุปการรายงาน</h3>

          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', flexWrap: 'wrap', marginBottom: '24px' }}>
            <div className="form-group" style={{ flex: 'none' }}>
              <label>📅 จากวันที่</label>
              <input type="date" value={expFrom} onChange={e => setExpFrom(e.target.value)} style={{ padding: '7px 10px' }} />
            </div>
            <div className="form-group" style={{ flex: 'none' }}>
              <label>📅 ถึงวันที่</label>
              <input type="date" value={expTo} onChange={e => setExpTo(e.target.value)} style={{ padding: '7px 10px' }} />
            </div>
            <select value={expSite} onChange={e => setExpSite(e.target.value)} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', padding: '7px 10px', borderRadius: '8px', fontSize: '12px' }}>
              <option value="">ทุกเว็บ</option>
              {sites.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <button onClick={() => { const t = fmt(new Date()); setExpFrom(t); setExpTo(t) }} style={btnStyle()}>วันนี้</button>
              <button onClick={() => { const n = new Date(); const d = n.getDay(); const mon = new Date(n); mon.setDate(n.getDate() - (d === 0 ? 6 : d - 1)); setExpFrom(fmt(mon)); setExpTo(fmt(n)) }} style={btnStyle()}>สัปดาห์นี้</button>
              <button onClick={() => { const n = new Date(); setExpFrom(fmt(new Date(n.getFullYear(), n.getMonth(), 1))); setExpTo(fmt(new Date(n.getFullYear(), n.getMonth() + 1, 0))) }} style={btnStyle()}>เดือนนี้</button>
              <button onClick={() => { const n = new Date(); setExpFrom(fmt(new Date(n.getFullYear(), n.getMonth() - 1, 1))); setExpTo(fmt(new Date(n.getFullYear(), n.getMonth(), 0))) }} style={btnStyle()}>เดือนที่แล้ว</button>
            </div>
          </div>
          {expFrom > expTo && (
            <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '8px', padding: '8px 14px', fontSize: '13px', color: '#b91c1c', fontWeight: 600, marginBottom: '16px' }}>
              วันเริ่มอยู่หลังวันจบ
            </div>
          )}

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
              <div>ช่วงวันที่: <span style={{ color: 'var(--text)' }}>{expFrom} → {expTo}</span></div>
              <div>เว็บ: <span style={{ color: 'var(--text)' }}>{expSite || 'ทุกเว็บ'}</span></div>
            </div>
          </div>

          {userRole !== 'viewer' ? (
            <button className="btn-export" onClick={exportExcel} disabled={exporting || expFrom > expTo} style={{ width: '100%', padding: '13px', fontSize: '15px', justifyContent: 'center' }}>
              {exporting ? <><span className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px', verticalAlign: 'middle', marginRight: '8px' }} />กำลังสร้างไฟล์...</> : '📥 ออกรายงาน'}
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
