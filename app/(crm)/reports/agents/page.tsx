'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { logAudit } from '@/lib/audit'
import { notifyTelegram } from '@/lib/notify'
import type { Site } from '@/lib/types'

function fmt(d: Date) { return d.toISOString().split('T')[0] }

interface SiteCall { siteName: string; count: number; answered: number; notAnswered: number; returned: number; deposit: number }
interface DayDetail { date: string; count: number; answered: number; sms: number; promo: number; returned: number; deposit: number }
interface AgentStat {
  id: string; name: string; email: string
  total_calls: number; answered: number; sms_sent: number; promo_offered: number; returned: number; total_deposit: number
  siteCalls: SiteCall[]
  dailyDetails: DayDetail[]
}

export default function AgentsPage() {
  const [stats, setStats] = useState<AgentStat[]>([])
  const [sites, setSites] = useState<Site[]>([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null)
  const [siteFilter, setSiteFilter] = useState('')
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(1)
    return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
  })
  const [dateTo, setDateTo] = useState(() => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }))
  const [sortBy, setSortBy] = useState<'total_calls' | 'answered' | 'returned' | 'total_deposit'>('total_calls')
  const [bonusMap, setBonusMap] = useState<Record<string, number>>({})
  const [editingBonus, setEditingBonus] = useState<string | null>(null)
  const [bonusInput, setBonusInput] = useState('')
  const [bonusNote, setBonusNote] = useState('')
  const [bonusSaving, setBonusSaving] = useState(false)
  const [currentUserName, setCurrentUserName] = useState('')
  const [userRole, setUserRole] = useState('')
  const supabase = createClient()

  useEffect(() => { load(); loadBonuses(); loadCurrentUser() }, [dateFrom, dateTo, siteFilter])

  async function loadCurrentUser() {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: p } = await supabase.from('user_profiles').select('full_name, role').eq('id', user.id).single()
      setCurrentUserName(p?.full_name || user.email || '')
      const real = p?.role || user.user_metadata?.role || ''
      const saved = localStorage.getItem('impersonate_role')
      if (saved && (real === 'manager' || real === 'admin')) setUserRole(saved)
      else setUserRole(real)
    }
  }

  async function loadBonuses() {
    const { data } = await supabase.from('agent_bonuses').select('user_id, amount')
      .gte('period_start', dateFrom).lte('period_end', dateTo)
    const map: Record<string, number> = {}
    for (const b of data || []) map[b.user_id] = (map[b.user_id] || 0) + parseFloat(String(b.amount || 0))
    setBonusMap(map)
  }

  async function saveBonus(agentId: string, agentName: string) {
    const amount = parseFloat(bonusInput)
    if (isNaN(amount) || amount < 0) return
    setBonusSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const oldAmount = bonusMap[agentId] || 0
    await supabase.from('agent_bonuses').insert({
      user_id: agentId, amount, note: bonusNote || null,
      period_start: dateFrom, period_end: dateTo,
      created_by: user?.id || null,
    })
    logAudit({ action: 'bonus.update', entity: 'Agent', entityId: agentId, before: { bonus: oldAmount }, after: { bonus: oldAmount + amount, note: bonusNote } })
    notifyTelegram('bonus', { agent: agentName, oldAmount, newAmount: oldAmount + amount, note: bonusNote, by: currentUserName })
    setBonusMap(prev => ({ ...prev, [agentId]: (prev[agentId] || 0) + amount }))
    setEditingBonus(null)
    setBonusInput('')
    setBonusNote('')
    setBonusSaving(false)
  }

  async function load() {
    setLoading(true)
    const { data: siteList } = await supabase.from('sites').select('*').order('id')
    setSites(siteList || [])

    const { data: profiles } = await supabase.from('user_profiles').select('id, full_name')
    const authRes = await fetch('/api/users').then(r => r.json())
    const authUsers = authRes.users || []

    const filterSite = siteFilter ? (siteList || []).find(s => s.name === siteFilter) : null

    let allCusts: any[] = []
    for (let page = 0; ; page++) {
      const from = page * 1000
      let q = supabase.from('customers')
        .select('id, called_by, call_date, site_id, answered, not_answered, sms_sent, promo_type, sites(name)')
        .gte('call_date', dateFrom).lte('call_date', dateTo)
      if (filterSite) q = q.eq('site_id', filterSite.id)
      const { data } = await q.range(from, from + 999)
      if (!data || data.length === 0) break
      allCusts.push(...data)
      if (data.length < 1000) break
    }

    const custIds = allCusts.map(c => c.id)
    const depSet = new Set<number>()
    const depAmtByCust: Record<number, number> = {}
    for (let i = 0; i < custIds.length; i += 500) {
      const batch = custIds.slice(i, i + 500)
      const { data: depData } = await supabase.from('daily_deposits')
        .select('customer_id, day_number, deposit_amount')
        .in('customer_id', batch).gt('day_number', 0)
      for (const d of depData || []) {
        depSet.add(d.customer_id)
        depAmtByCust[d.customer_id] = (depAmtByCust[d.customer_id] || 0) + (parseFloat(d.deposit_amount) || 0)
      }
    }

    function buildAgentStat(id: string, name: string, email: string, custs: any[]): AgentStat {
      const siteMap: Record<string, SiteCall> = {}
      const dayMap: Record<string, DayDetail> = {}
      for (const c of custs) {
        const sn = c.sites?.name || 'ไม่ระบุ'
        if (!siteMap[sn]) siteMap[sn] = { siteName: sn, count: 0, answered: 0, notAnswered: 0, returned: 0, deposit: 0 }
        siteMap[sn].count++
        if (c.answered) siteMap[sn].answered++
        if (c.not_answered) siteMap[sn].notAnswered++
        if (depSet.has(c.id)) { siteMap[sn].returned++; siteMap[sn].deposit += depAmtByCust[c.id] || 0 }

        const dd = c.call_date || 'ไม่ระบุ'
        if (!dayMap[dd]) dayMap[dd] = { date: dd, count: 0, answered: 0, sms: 0, promo: 0, returned: 0, deposit: 0 }
        dayMap[dd].count++
        if (c.answered) dayMap[dd].answered++
        if (c.sms_sent) dayMap[dd].sms++
        if (c.promo_type) dayMap[dd].promo++
        if (depSet.has(c.id)) { dayMap[dd].returned++; dayMap[dd].deposit += depAmtByCust[c.id] || 0 }
      }
      return {
        id, name, email,
        total_calls: custs.length,
        answered: custs.filter(c => c.answered).length,
        sms_sent: custs.filter(c => c.sms_sent).length,
        promo_offered: custs.filter(c => !!c.promo_type).length,
        returned: custs.filter(c => depSet.has(c.id)).length,
        total_deposit: custs.reduce((s, c) => s + (depAmtByCust[c.id] || 0), 0),
        siteCalls: Object.values(siteMap).sort((a, b) => b.count - a.count),
        dailyDetails: Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date)),
      }
    }

    const result: AgentStat[] = []

    for (const p of profiles || []) {
      const au = authUsers.find((u: any) => u.id === p.id)
      const custs = allCusts.filter(c => c.called_by === p.id)
      if (custs.length === 0) continue
      result.push(buildAgentStat(p.id, p.full_name || au?.email || p.id, au?.email || '', custs))
    }

    const untracked = allCusts.filter(c => !c.called_by)
    if (untracked.length > 0) {
      result.push(buildAgentStat('unknown', 'ไม่ระบุผู้โทร (ข้อมูลนำเข้า)', '', untracked))
    }

    result.sort((a, b) => b[sortBy] - a[sortBy])
    setStats(result)
    setLoading(false)
  }

  useEffect(() => {
    setStats(prev => [...prev].sort((a, b) => b[sortBy] - a[sortBy]))
  }, [sortBy])

  const totals = stats.reduce((acc, s) => ({
    total_calls: acc.total_calls + s.total_calls,
    answered: acc.answered + s.answered,
    sms_sent: acc.sms_sent + s.sms_sent,
    promo_offered: acc.promo_offered + s.promo_offered,
    returned: acc.returned + s.returned,
    total_deposit: acc.total_deposit + s.total_deposit,
  }), { total_calls: 0, answered: 0, sms_sent: 0, promo_offered: 0, returned: 0, total_deposit: 0 })

  async function exportExcel() {
    setExporting(true)
    try {
      const res = await fetch('/api/export-agents', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dateFrom, dateTo, site: siteFilter || undefined, stats }),
      })
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `ผลงานพนักงาน_${dateFrom}_${dateTo}.xlsx`; a.click()
      URL.revokeObjectURL(url)
      logAudit({ action: 'report.export_agents', entity: 'Report', entityId: 'agents', after: { type: 'agents', dateFrom, dateTo, site: siteFilter || 'ทุกเว็บ' } })
    } catch { /* ignore */ }
    setExporting(false)
  }

  function quickDate(from: string, to: string) { setDateFrom(from); setDateTo(to) }
  const btnStyle: React.CSSProperties = { background: 'rgba(108,99,255,.15)', border: '1px solid var(--accent)', color: 'var(--accent)', padding: '5px 14px', borderRadius: '8px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '12px', fontWeight: 600 }

  return (
    <div>
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '13px 24px', position: 'sticky', top: 0, zIndex: 50 }}>
        <h2 style={{ fontSize: '15px', fontWeight: 600 }}>👤 ผลงานรายพนักงาน</h2>
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
            <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', padding: '7px 10px', borderRadius: '8px', fontSize: '12px' }}>
              <option value="total_calls">เรียงตามจำนวนโทร</option>
              <option value="answered">เรียงตามรับสาย</option>
              <option value="returned">เรียงตามกลับมาฝาก</option>
              <option value="total_deposit">เรียงตามยอดฝาก</option>
            </select>
            {userRole !== 'viewer' && <button className="btn-export" onClick={exportExcel} disabled={exporting}>
              {exporting ? 'กำลังสร้าง...' : '📥 ออกรายงาน'}
            </button>}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <button onClick={() => { const t = fmt(new Date()); quickDate(t, t) }} style={btnStyle}>วันนี้</button>
              <button onClick={() => { const n = new Date(); const d = n.getDay(); const mon = new Date(n); mon.setDate(n.getDate() - (d === 0 ? 6 : d - 1)); quickDate(fmt(mon), fmt(n)) }} style={btnStyle}>สัปดาห์นี้</button>
              <button onClick={() => { const n = new Date(); quickDate(fmt(new Date(n.getFullYear(), n.getMonth(), 1)), fmt(new Date(n.getFullYear(), n.getMonth() + 1, 0))) }} style={btnStyle}>เดือนนี้</button>
              <button onClick={() => { const n = new Date(); quickDate(fmt(new Date(n.getFullYear(), n.getMonth() - 1, 1)), fmt(new Date(n.getFullYear(), n.getMonth(), 0))) }} style={btnStyle}>เดือนที่แล้ว</button>
            </div>
          </div>
        </div>

        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', gap: '10px', color: 'var(--text3)' }}><div className="spinner" /> กำลังโหลด...</div>
        ) : stats.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text3)' }}>ไม่พบข้อมูลในช่วงวันที่นี้</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead className="dark">
                <tr>
                  <th>พนักงาน</th>
                  <th style={{ cursor: 'pointer' }} onClick={() => setSortBy('total_calls')}>โทรทั้งหมด {sortBy === 'total_calls' ? '▼' : ''}</th>
                  <th style={{ cursor: 'pointer' }} onClick={() => setSortBy('answered')}>รับสาย {sortBy === 'answered' ? '▼' : ''}</th>
                  <th>รับสาย %</th>
                  <th>ส่ง SMS</th>
                  <th>เสนอโปร</th>
                  <th style={{ cursor: 'pointer' }} onClick={() => setSortBy('returned')}>กลับมาฝาก {sortBy === 'returned' ? '▼' : ''}</th>
                  <th style={{ cursor: 'pointer' }} onClick={() => setSortBy('total_deposit')}>ยอดฝากรวม {sortBy === 'total_deposit' ? '▼' : ''}</th>
                  <th>โบนัส</th>
                </tr>
              </thead>
              <tbody>
                {stats.map(s => (
                  <>
                    <tr key={s.id} onClick={() => setExpandedAgent(expandedAgent === s.id ? null : s.id)} style={{ cursor: 'pointer' }}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{s.name}</div>
                        {s.email && <div style={{ fontSize: '11px', color: 'var(--text3)' }}>{s.email}</div>}
                      </td>
                      <td style={{ fontWeight: 700, color: '#000' }}>{s.total_calls.toLocaleString()}</td>
                      <td style={{ color: '#000', fontWeight: 700 }}>{s.answered.toLocaleString()}</td>
                      <td style={{ color: '#000' }}>{s.total_calls > 0 ? ((s.answered / s.total_calls) * 100).toFixed(1) + '%' : '-'}</td>
                      <td style={{ color: '#000' }}>{s.sms_sent.toLocaleString()}</td>
                      <td style={{ color: '#000', fontWeight: 600 }}>{s.promo_offered.toLocaleString()}</td>
                      <td style={{ color: '#000', fontWeight: 700 }}>{s.returned.toLocaleString()} ราย</td>
                      <td style={{ color: '#000', fontWeight: 700 }}>฿{s.total_deposit.toLocaleString('th-TH', { maximumFractionDigits: 0 })}</td>
                      <td onClick={e => e.stopPropagation()}>
                        {editingBonus === s.id && userRole !== 'viewer' ? (
                          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                            <input type="number" value={bonusInput} onChange={e => setBonusInput(e.target.value)} placeholder="จำนวน" style={{ width: '80px', padding: '4px 6px', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '12px' }} autoFocus />
                            <input value={bonusNote} onChange={e => setBonusNote(e.target.value)} placeholder="หมายเหตุ" style={{ width: '80px', padding: '4px 6px', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '12px' }} />
                            <button className="btn btn-primary btn-xs" disabled={bonusSaving} onClick={() => saveBonus(s.id, s.name)}>{bonusSaving ? '...' : '✓'}</button>
                            <button className="btn btn-outline btn-xs" onClick={() => setEditingBonus(null)}>✕</button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontWeight: 700, color: (bonusMap[s.id] || 0) > 0 ? '#d97706' : 'var(--text3)' }}>
                              {(bonusMap[s.id] || 0) > 0 ? `฿${(bonusMap[s.id] || 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })}` : '-'}
                            </span>
                            {userRole !== 'viewer' && <button className="btn btn-outline btn-xs" onClick={() => { setEditingBonus(s.id); setBonusInput(''); setBonusNote('') }} style={{ fontSize: '10px', padding: '2px 6px' }}>✏️</button>}
                          </div>
                        )}
                      </td>
                    </tr>
                    {expandedAgent === s.id && (
                      <tr key={`${s.id}-detail`}>
                        <td colSpan={8} style={{ padding: 0 }}>
                          <div style={{ background: 'rgba(108,99,255,.04)', padding: '12px 20px' }}>
                            <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '8px', color: 'var(--accent)' }}>📅 ผลงานรายวัน — {s.name}</div>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                              <thead>
                                <tr style={{ background: 'rgba(108,99,255,.08)' }}>
                                  <th style={{ padding: '6px 10px', fontSize: '11px', textAlign: 'left' }}>วันที่</th>
                                  <th style={{ padding: '6px 10px', fontSize: '11px', textAlign: 'center' }}>โทร</th>
                                  <th style={{ padding: '6px 10px', fontSize: '11px', textAlign: 'center' }}>รับสาย</th>
                                  <th style={{ padding: '6px 10px', fontSize: '11px', textAlign: 'center' }}>ส่ง SMS</th>
                                  <th style={{ padding: '6px 10px', fontSize: '11px', textAlign: 'center' }}>เสนอโปร</th>
                                  <th style={{ padding: '6px 10px', fontSize: '11px', textAlign: 'center' }}>กลับมาฝาก</th>
                                  <th style={{ padding: '6px 10px', fontSize: '11px', textAlign: 'right' }}>ยอดฝาก</th>
                                </tr>
                              </thead>
                              <tbody>
                                {s.dailyDetails.map(dd => (
                                  <tr key={dd.date} style={{ borderBottom: '1px solid var(--border)' }}>
                                    <td style={{ padding: '6px 10px', fontSize: '12px', fontWeight: 600 }}>{dd.date}</td>
                                    <td style={{ padding: '6px 10px', fontSize: '12px', textAlign: 'center', color: '#000' }}>{dd.count}</td>
                                    <td style={{ padding: '6px 10px', fontSize: '12px', textAlign: 'center', color: '#000' }}>{dd.answered}</td>
                                    <td style={{ padding: '6px 10px', fontSize: '12px', textAlign: 'center', color: '#000' }}>{dd.sms}</td>
                                    <td style={{ padding: '6px 10px', fontSize: '12px', textAlign: 'center', color: '#000' }}>{dd.promo}</td>
                                    <td style={{ padding: '6px 10px', fontSize: '12px', textAlign: 'center', color: '#000' }}>{dd.returned}</td>
                                    <td style={{ padding: '6px 10px', fontSize: '12px', textAlign: 'right', color: '#000' }}>฿{dd.deposit.toLocaleString('th-TH', { maximumFractionDigits: 0 })}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: 'rgba(108,99,255,.06)', fontWeight: 700 }}>
                  <td>รวมทั้งหมด</td>
                  <td style={{ color: '#000' }}>{totals.total_calls.toLocaleString()}</td>
                  <td style={{ color: '#000' }}>{totals.answered.toLocaleString()}</td>
                  <td style={{ color: '#000' }}>{totals.total_calls > 0 ? ((totals.answered / totals.total_calls) * 100).toFixed(1) + '%' : '-'}</td>
                  <td style={{ color: '#000' }}>{totals.sms_sent.toLocaleString()}</td>
                  <td style={{ color: '#000' }}>{totals.promo_offered.toLocaleString()}</td>
                  <td style={{ color: '#000' }}>{totals.returned.toLocaleString()} ราย</td>
                  <td style={{ color: '#000' }}>฿{totals.total_deposit.toLocaleString('th-TH', { maximumFractionDigits: 0 })}</td>
                  <td style={{ color: '#000' }}>฿{Object.values(bonusMap).reduce((s, v) => s + v, 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
