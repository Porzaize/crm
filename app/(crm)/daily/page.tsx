'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase-client'
import { logAudit } from '@/lib/audit'

function fmt(d: Date) { return d.toISOString().split('T')[0] }

interface SiteSummary {
  siteName: string
  calls: number
  answered: number
  notAnswered: number
  deposits: number
  returned: number
}

interface AgentSummary {
  agentId: string
  agentName: string
  calls: number
  answered: number
  deposits: number
}

export default function DailyPage() {
  const [dateFrom, setDateFrom] = useState(() => fmt(new Date()))
  const [dateTo, setDateTo] = useState(() => fmt(new Date()))
  const [activePreset, setActivePreset] = useState('today')
  const [loading, setLoading] = useState(true)
  const [siteData, setSiteData] = useState<SiteSummary[]>([])
  const [agentData, setAgentData] = useState<AgentSummary[]>([])
  const [totalCalls, setTotalCalls] = useState(0)
  const [totalAnswered, setTotalAnswered] = useState(0)
  const [totalNotAnswered, setTotalNotAnswered] = useState(0)
  const [totalDeposits, setTotalDeposits] = useState(0)
  const [totalReturned, setTotalReturned] = useState(0)
  const [userRole, setUserRole] = useState('')
  const [countdown, setCountdown] = useState(60)
  const [exporting, setExporting] = useState(false)
  const [toast, setToast] = useState({ msg: '', type: '' })
  const [siteSortBy, setSiteSortBy] = useState<string>('calls')
  const [siteSortDir, setSiteSortDir] = useState<'asc' | 'desc'>('desc')
  const [agentSortBy, setAgentSortBy] = useState<string>('calls')
  const [agentSortDir, setAgentSortDir] = useState<'asc' | 'desc'>('desc')
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const supabase = createClient()

  const isEditor = userRole === 'editor'
  const isViewer = userRole === 'viewer'

  async function loadRole() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const saved = localStorage.getItem('impersonate_role')
    const { data: profile } = await supabase.from('user_profiles').select('role').eq('id', user.id).single()
    const real = profile?.role || user.user_metadata?.role || ''
    if (saved && (real === 'manager' || real === 'admin')) setUserRole(saved)
    else setUserRole(real)
  }

  const loadData = useCallback(async (from?: string, to?: string) => {
    setLoading(true)
    const f = from ?? dateFrom
    const t = to ?? dateTo

    // Fetch customers for the selected date range with site info
    let q = supabase.from('customers').select('*, sites(name)').gte('call_date', f).lte('call_date', t)
    const { data: customers } = await q

    // Fetch all user profiles for agent names
    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('id, full_name')

    const profileMap: Record<string, string> = {}
    for (const p of profiles || []) {
      profileMap[p.id] = p.full_name
    }

    // Build site summary
    const siteMap: Record<string, SiteSummary> = {}
    const agentMap: Record<string, AgentSummary> = {}
    let calls = 0, ans = 0, notAns = 0, deps = 0, ret = 0

    for (const c of customers || []) {
      const siteName = c.sites?.name || 'ไม่ระบุ'
      const dep = parseFloat(String(c.total_deposit || 0))
      const isAnswered = !!c.answered
      const isNotAnswered = !!c.not_answered

      // Totals
      calls++
      if (isAnswered) ans++
      if (isNotAnswered) notAns++
      if (dep > 0) { ret++; deps += dep }

      // Per site
      if (!siteMap[siteName]) {
        siteMap[siteName] = { siteName, calls: 0, answered: 0, notAnswered: 0, deposits: 0, returned: 0 }
      }
      siteMap[siteName].calls++
      if (isAnswered) siteMap[siteName].answered++
      if (isNotAnswered) siteMap[siteName].notAnswered++
      if (dep > 0) { siteMap[siteName].returned++; siteMap[siteName].deposits += dep }

      // Per agent
      const agentId = c.called_by || '_unknown'
      if (!agentMap[agentId]) {
        agentMap[agentId] = {
          agentId,
          agentName: agentId === '_unknown' ? 'ไม่ระบุ' : (profileMap[agentId] || agentId),
          calls: 0,
          answered: 0,
          deposits: 0,
        }
      }
      agentMap[agentId].calls++
      if (isAnswered) agentMap[agentId].answered++
      if (dep > 0) agentMap[agentId].deposits += dep
    }

    setTotalCalls(calls)
    setTotalAnswered(ans)
    setTotalNotAnswered(notAns)
    setTotalDeposits(deps)
    setTotalReturned(ret)
    setSiteData(Object.values(siteMap).sort((a, b) => b.calls - a.calls))
    setAgentData(Object.values(agentMap).sort((a, b) => b.calls - a.calls))
    setLoading(false)
  }, [dateFrom, dateTo])

  // Initial load
  useEffect(() => {
    loadRole()
    loadData()
  }, [])

  // Auto-refresh every 60 seconds
  useEffect(() => {
    setCountdown(60)
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          loadData()
          return 60
        }
        return prev - 1
      })
    }, 1000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [dateFrom, dateTo, loadData])

  function handleDateRange(from: string, to: string, preset: string) {
    setDateFrom(from)
    setDateTo(to)
    setActivePreset(preset)
    loadData(from, to)
  }

  function getPresets() {
    const today = new Date()
    const todayStr = fmt(today)

    const day = today.getDay()
    const monday = new Date(today)
    monday.setDate(today.getDate() - (day === 0 ? 6 : day - 1))
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)



    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0)

    const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1)
    const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0)

    return [
      { key: 'today', label: 'วันนี้', from: todayStr, to: todayStr },
      { key: 'yesterday', label: 'เมื่อวาน', from: fmt(new Date(today.getTime() - 86400000)), to: fmt(new Date(today.getTime() - 86400000)) },
      { key: 'week', label: 'สัปดาห์นี้', from: fmt(monday), to: fmt(sunday) },

      { key: 'month', label: 'เดือนนี้', from: fmt(monthStart), to: fmt(monthEnd) },
      { key: 'lastmonth', label: 'เดือนที่แล้ว', from: fmt(lastMonthStart), to: fmt(lastMonthEnd) },
    ]
  }

  function toggleSiteSort(col: string) {
    if (siteSortBy === col) {
      setSiteSortDir(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSiteSortBy(col)
      setSiteSortDir('desc')
    }
  }

  function toggleAgentSort(col: string) {
    if (agentSortBy === col) {
      setAgentSortDir(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setAgentSortBy(col)
      setAgentSortDir('desc')
    }
  }

  function sortIndicator(activeCol: string, col: string, dir: 'asc' | 'desc') {
    if (activeCol !== col) return ''
    return dir === 'asc' ? ' ▲' : ' ▼'
  }

  const sortedSiteData = [...siteData].sort((a, b) => {
    let aVal: number | string
    let bVal: number | string
    if (siteSortBy === 'siteName') {
      aVal = a.siteName
      bVal = b.siteName
    } else if (siteSortBy === 'rate') {
      aVal = a.calls > 0 ? a.answered / a.calls : 0
      bVal = b.calls > 0 ? b.answered / b.calls : 0
    } else {
      aVal = a[siteSortBy as keyof SiteSummary] as number
      bVal = b[siteSortBy as keyof SiteSummary] as number
    }
    if (aVal < bVal) return siteSortDir === 'asc' ? -1 : 1
    if (aVal > bVal) return siteSortDir === 'asc' ? 1 : -1
    return 0
  })

  const sortedAgentData = [...agentData].sort((a, b) => {
    let aVal: number | string
    let bVal: number | string
    if (agentSortBy === 'agentName') {
      aVal = a.agentName
      bVal = b.agentName
    } else {
      aVal = a[agentSortBy as keyof AgentSummary] as number
      bVal = b[agentSortBy as keyof AgentSummary] as number
    }
    if (aVal < bVal) return agentSortDir === 'asc' ? -1 : 1
    if (aVal > bVal) return agentSortDir === 'asc' ? 1 : -1
    return 0
  })

  const thSortStyle: React.CSSProperties = { cursor: 'pointer', userSelect: 'none' }

  const answerRate = totalCalls > 0 ? ((totalAnswered / totalCalls) * 100).toFixed(1) : '0.0'

  async function exportReport() {
    setExporting(true)
    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'all', dateFrom, dateTo }),
      })
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Daily_Report_${dateFrom}_${dateTo}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      logAudit({ action: 'report.export', entity: 'DailyReport', entityId: dateFrom, after: { dateFrom, dateTo } })
      setToast({ msg: 'ดาวน์โหลดสำเร็จ!', type: 'success' })
    } catch {
      setToast({ msg: 'เกิดข้อผิดพลาดในการออกรายงาน', type: 'error' })
    }
    setExporting(false)
    setTimeout(() => setToast({ msg: '', type: '' }), 3000)
  }

  const summaryCards = [
    { key: 'calls', label: 'โทรวันนี้', value: totalCalls.toLocaleString(), color: '#6366f1', hide: false },
    { key: 'answered', label: 'รับสาย', value: totalAnswered.toLocaleString(), color: '#22c55e', hide: false },
    { key: 'notAnswered', label: 'ไม่รับสาย', value: totalNotAnswered.toLocaleString(), color: '#ef4444', hide: false },
    { key: 'rate', label: 'อัตรารับสาย', value: `${answerRate}%`, color: '#3b82f6', hide: false },
    { key: 'deposits', label: 'ยอดฝากวันนี้', value: `฿${totalDeposits.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`, color: '#f59e0b', hide: isEditor },
    { key: 'returned', label: 'ลูกค้ากลับมาฝาก', value: totalReturned.toLocaleString(), color: '#06b6d4', hide: false },
  ]

  return (
    <div>
      {/* ─── Topbar ─── */}
      <div style={{
        background: '#fff',
        borderBottom: '1px solid var(--border)',
        padding: '13px 24px',
        position: 'sticky',
        top: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div>
          <h2 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text)' }}>
            📋 รายงานประจำวัน
          </h2>
          <div style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
            สรุปผลการทำงานรายวัน - อัปเดตอัตโนมัติทุก 60 วินาที
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            fontSize: '11px',
            color: 'var(--text3)',
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            borderRadius: '20px',
            padding: '4px 12px',
            fontWeight: 600,
            fontVariantNumeric: 'tabular-nums',
          }}>
            🔄 รีเฟรชใน {countdown} วินาที
          </div>
        </div>
      </div>

      <div style={{ padding: '20px' }}>
        {/* ─── Date Range Picker ─── */}
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          padding: '16px 20px',
          marginBottom: '20px',
          boxShadow: '0 1px 3px rgba(0,0,0,.06)',
        }}>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '14px' }}>
            {getPresets().map(p => (
              <button
                key={p.key}
                onClick={() => handleDateRange(p.from, p.to, p.key)}
                style={{
                  background: activePreset === p.key ? 'var(--accent)' : 'var(--surface2)',
                  border: `1px solid ${activePreset === p.key ? 'var(--accent)' : 'var(--border)'}`,
                  color: activePreset === p.key ? '#fff' : 'var(--text2)',
                  padding: '7px 16px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: '12px',
                  fontWeight: 600,
                  transition: 'all .2s',
                }}
              >{p.label}</button>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <div className="form-group" style={{ flex: 'none' }}>
              <label>จากวันที่</label>
              <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setActivePreset('custom'); loadData(e.target.value, dateTo) }} style={{ padding: '7px 10px' }} />
            </div>
            <div className="form-group" style={{ flex: 'none' }}>
              <label>ถึงวันที่</label>
              <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setActivePreset('custom'); loadData(dateFrom, e.target.value) }} style={{ padding: '7px 10px' }} />
            </div>
            {!isViewer && (
              <div style={{ marginLeft: 'auto' }}>
                <button className="btn-export" onClick={exportReport} disabled={exporting}>
                  {exporting ? (
                    <><span className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px', verticalAlign: 'middle', marginRight: '6px' }} />กำลังสร้างไฟล์...</>
                  ) : (
                    '📥 ออกรายงาน'
                  )}
                </button>
              </div>
            )}
          </div>
        </div>

        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', gap: '10px', color: 'var(--text3)' }}>
            <div className="spinner" /> กำลังโหลด...
          </div>
        ) : (
          <>
            {/* ─── Summary Cards ─── */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '14px',
              marginBottom: '24px',
            }}>
              {summaryCards.filter(c => !c.hide).map(c => (
                <div key={c.key} style={{
                  background: 'var(--surface)',
                  borderRadius: '12px',
                  padding: '18px 20px',
                  border: '1px solid var(--border)',
                  borderTop: `3px solid ${c.color}`,
                  boxShadow: '0 1px 3px rgba(0,0,0,.06)',
                }}>
                  <div style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '8px', fontWeight: 500 }}>
                    {c.label}
                  </div>
                  <div style={{ fontSize: '26px', fontWeight: 700, lineHeight: 1, color: 'var(--text)' }}>
                    {c.value}
                  </div>
                </div>
              ))}
            </div>

            {/* ─── Site Breakdown Table ─── */}
            <div style={{ marginBottom: '24px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)', marginBottom: '12px' }}>
                🌐 สรุปแยกตามเว็บ
              </h3>
              <div className="table-wrap">
                <table>
                  <thead className="dark">
                    <tr>
                      <th>#</th>
                      <th style={thSortStyle} onClick={() => toggleSiteSort('siteName')}>เว็บ{sortIndicator(siteSortBy, 'siteName', siteSortDir)}</th>
                      <th style={thSortStyle} onClick={() => toggleSiteSort('calls')}>โทรทั้งหมด{sortIndicator(siteSortBy, 'calls', siteSortDir)}</th>
                      <th style={thSortStyle} onClick={() => toggleSiteSort('answered')}>รับสาย{sortIndicator(siteSortBy, 'answered', siteSortDir)}</th>
                      <th style={thSortStyle} onClick={() => toggleSiteSort('notAnswered')}>ไม่รับสาย{sortIndicator(siteSortBy, 'notAnswered', siteSortDir)}</th>
                      <th style={thSortStyle} onClick={() => toggleSiteSort('rate')}>อัตรารับสาย{sortIndicator(siteSortBy, 'rate', siteSortDir)}</th>
                      {!isEditor && <th style={thSortStyle} onClick={() => toggleSiteSort('deposits')}>ยอดฝาก{sortIndicator(siteSortBy, 'deposits', siteSortDir)}</th>}
                      <th style={thSortStyle} onClick={() => toggleSiteSort('returned')}>ลูกค้ากลับมาฝาก{sortIndicator(siteSortBy, 'returned', siteSortDir)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedSiteData.length === 0 ? (
                      <tr>
                        <td colSpan={isEditor ? 7 : 8} style={{ textAlign: 'center', padding: '30px', color: 'var(--text3)' }}>
                          ไม่มีข้อมูลสำหรับวันที่เลือก
                        </td>
                      </tr>
                    ) : (
                      <>
                        {sortedSiteData.map((s, i) => {
                          const rate = s.calls > 0 ? ((s.answered / s.calls) * 100).toFixed(1) : '0.0'
                          return (
                            <tr key={s.siteName}>
                              <td style={{ color: 'var(--text3)' }}>{i + 1}</td>
                              <td style={{ fontWeight: 600 }}>{s.siteName}</td>
                              <td>{s.calls}</td>
                              <td style={{ color: 'var(--green)' }}>{s.answered}</td>
                              <td style={{ color: 'var(--red)' }}>{s.notAnswered}</td>
                              <td>{rate}%</td>
                              {!isEditor && (
                                <td style={{ fontWeight: 600 }}>
                                  ฿{s.deposits.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                                </td>
                              )}
                              <td style={{ color: 'var(--accent)', fontWeight: 600 }}>{s.returned}</td>
                            </tr>
                          )
                        })}
                        <tr style={{ background: 'rgba(108,99,255,.06)', fontWeight: 700 }}>
                          <td colSpan={2}>รวมทั้งหมด</td>
                          <td>{totalCalls}</td>
                          <td style={{ color: 'var(--green)' }}>{totalAnswered}</td>
                          <td style={{ color: 'var(--red)' }}>{totalNotAnswered}</td>
                          <td>{answerRate}%</td>
                          {!isEditor && (
                            <td>฿{totalDeposits.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
                          )}
                          <td style={{ color: 'var(--accent)' }}>{totalReturned}</td>
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ─── Agent Breakdown Table ─── */}
            <div style={{ marginBottom: '24px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)', marginBottom: '12px' }}>
                👤 สรุปแยกตามเจ้าหน้าที่
              </h3>
              <div className="table-wrap">
                <table>
                  <thead className="dark">
                    <tr>
                      <th>#</th>
                      <th style={thSortStyle} onClick={() => toggleAgentSort('agentName')}>ชื่อเจ้าหน้าที่{sortIndicator(agentSortBy, 'agentName', agentSortDir)}</th>
                      <th style={thSortStyle} onClick={() => toggleAgentSort('calls')}>โทรทั้งหมด{sortIndicator(agentSortBy, 'calls', agentSortDir)}</th>
                      <th style={thSortStyle} onClick={() => toggleAgentSort('answered')}>รับสาย{sortIndicator(agentSortBy, 'answered', agentSortDir)}</th>
                      {!isEditor && <th style={thSortStyle} onClick={() => toggleAgentSort('deposits')}>ยอดฝาก{sortIndicator(agentSortBy, 'deposits', agentSortDir)}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedAgentData.length === 0 ? (
                      <tr>
                        <td colSpan={isEditor ? 4 : 5} style={{ textAlign: 'center', padding: '30px', color: 'var(--text3)' }}>
                          ไม่มีข้อมูลสำหรับวันที่เลือก
                        </td>
                      </tr>
                    ) : (
                      <>
                        {sortedAgentData.map((a, i) => (
                          <tr key={a.agentId}>
                            <td style={{ color: 'var(--text3)' }}>{i + 1}</td>
                            <td style={{ fontWeight: 600 }}>{a.agentName}</td>
                            <td>{a.calls}</td>
                            <td style={{ color: 'var(--green)' }}>{a.answered}</td>
                            {!isEditor && (
                              <td style={{ fontWeight: 600 }}>
                                ฿{a.deposits.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                              </td>
                            )}
                          </tr>
                        ))}
                        <tr style={{ background: 'rgba(108,99,255,.06)', fontWeight: 700 }}>
                          <td colSpan={2}>รวมทั้งหมด</td>
                          <td>{totalCalls}</td>
                          <td style={{ color: 'var(--green)' }}>{totalAnswered}</td>
                          {!isEditor && (
                            <td>฿{totalDeposits.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
                          )}
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ─── Toast ─── */}
      {toast.msg && (
        <div className={`toast ${toast.type}`} style={{ position: 'fixed', bottom: '24px', right: '24px' }}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
