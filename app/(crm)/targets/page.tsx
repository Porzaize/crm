'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase-client'

function fmt(d: Date) { return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }) }

function getWeekRange(date: Date) {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  const mon = new Date(d); mon.setDate(diff)
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
  return { mon, sun }
}

function getMonthRange(date: Date) {
  const y = date.getFullYear(), m = date.getMonth()
  return { first: new Date(y, m, 1), last: new Date(y, m + 1, 0) }
}

type Period = 'daily' | 'weekly' | 'monthly'

interface Agent { id: string; full_name: string; role: string }
interface Site { id: number; name: string }

interface TargetRow {
  id?: string
  agent_id: string
  site_id: number | null
  period: string
  period_key: string
  target_calls: number
  target_answered: number
  target_deposit: number
  target_calls_out: number
  target_connected: number
  target_appointments: number
  target_interested: number
  target_sales: number
  target_fcr: number
}

function periodKey(period: Period, date: Date): string {
  if (period === 'daily') return fmt(date)
  if (period === 'weekly') return `w-${fmt(getWeekRange(date).mon)}`
  return `m-${fmt(getMonthRange(date).first)}`
}

function pctColor(pct: number) {
  if (pct >= 80) return 'var(--green)'
  if (pct >= 50) return 'var(--yellow)'
  return 'var(--red)'
}
function pctBg(pct: number) {
  if (pct >= 80) return '#dcfce7'
  if (pct >= 50) return '#fef3c7'
  return '#fee2e2'
}
function calcPct(actual: number, target: number) {
  if (target <= 0) return 0
  return Math.min(Math.round((actual / target) * 100), 100)
}

const emptyTarget = (): Omit<TargetRow, 'agent_id' | 'site_id' | 'period' | 'period_key'> => ({
  target_calls: 0, target_answered: 0, target_deposit: 0,
  target_calls_out: 0, target_connected: 0,
  target_appointments: 0, target_interested: 0, target_sales: 0, target_fcr: 0,
})

export default function TargetsPage() {
  const [loading, setLoading] = useState(true)
  const [userRole, setUserRole] = useState('')
  const [period, setPeriod] = useState<Period>('daily')
  const [agents, setAgents] = useState<Agent[]>([])
  const [sites, setSites] = useState<Site[]>([])
  const [targets, setTargets] = useState<TargetRow[]>([])
  const [actuals, setActuals] = useState<Record<string, { calls: number; answered: number; deposit: number }>>({})
  const [toast, setToast] = useState('')
  const [tgtSortBy, setTgtSortBy] = useState('')
  const [tgtSortDir, setTgtSortDir] = useState<'asc' | 'desc'>('desc')
  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<TargetRow & { agentName?: string }>({
    agent_id: '', site_id: null, period: 'daily', period_key: '',
    ...emptyTarget(),
  })
  const supabase = createClient()

  const today = new Date()
  const pKey = periodKey(period, today)
  const canEdit = userRole === 'admin' || userRole === 'manager'
  const isEditor = userRole === 'editor'

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  const periodLabel = period === 'daily' ? 'วันนี้' : period === 'weekly' ? 'สัปดาห์นี้' : 'เดือนนี้'
  const roleLabel = (r: string) => ({ admin: 'แอดมิน', manager: 'ผู้จัดการ', editor: 'เจ้าหน้าที่', viewer: 'ผู้ดู' }[r] || r)

  const loadRole = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const saved = localStorage.getItem('impersonate_role')
    const { data: profile } = await supabase.from('user_profiles').select('role').eq('id', user.id).single()
    const real = profile?.role || user.user_metadata?.role || ''
    if (saved && (real === 'manager' || real === 'admin')) setUserRole(saved)
    else setUserRole(real)
  }, [])

  const loadAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/users')
      const json = await res.json()
      const users = json.users || []
      setAgents(users.map((a: any) => ({ id: a.id, full_name: a.full_name || 'ไม่ระบุชื่อ', role: a.role || '' })))
    } catch {}
  }, [])

  const loadSites = useCallback(async () => {
    const { data } = await supabase.from('sites').select('id, name').order('name')
    setSites(data || [])
  }, [])

  const loadTargets = useCallback(async () => {
    const { data } = await supabase
      .from('agent_targets')
      .select('*')
      .eq('period', period)
      .eq('period_key', pKey)
    setTargets(data || [])
  }, [period, pKey])

  const loadActuals = useCallback(async () => {
    let dateFrom: string, dateTo: string
    if (period === 'daily') { dateFrom = fmt(today); dateTo = fmt(today) }
    else if (period === 'weekly') { const { mon, sun } = getWeekRange(today); dateFrom = fmt(mon); dateTo = fmt(sun) }
    else { const { first, last } = getMonthRange(today); dateFrom = fmt(first); dateTo = fmt(last) }

    const result: Record<string, { calls: number; answered: number; deposit: number }> = {}
    for (const agent of agents) {
      let allCusts: any[] = []
      for (let page = 0; ; page++) {
        const from = page * 1000
        const { data } = await supabase.from('customers').select('id, answered, total_deposit')
          .eq('called_by', agent.id).gte('call_date', dateFrom).lte('call_date', dateTo).range(from, from + 999)
        if (!data || data.length === 0) break
        allCusts.push(...data)
        if (data.length < 1000) break
      }
      result[agent.id] = {
        calls: allCusts.length,
        answered: allCusts.filter(c => c.answered).length,
        deposit: allCusts.reduce((s, c) => s + parseFloat(String(c.total_deposit || 0)), 0),
      }
    }
    setActuals(result)
  }, [agents, period])

  useEffect(() => { loadRole(); loadAgents(); loadSites() }, [])
  useEffect(() => { loadTargets() }, [period, pKey])
  useEffect(() => {
    if (agents.length > 0) { setLoading(true); loadActuals().finally(() => setLoading(false)) }
    else setLoading(false)
  }, [agents, period])

  function getAgentTarget(agentId: string) {
    const rows = targets.filter(t => t.agent_id === agentId)
    const merged = { ...emptyTarget() }
    for (const r of rows) {
      merged.target_calls += r.target_calls || 0
      merged.target_answered += r.target_answered || 0
      merged.target_deposit += parseFloat(String(r.target_deposit || 0))
      merged.target_calls_out += r.target_calls_out || 0
      merged.target_connected += r.target_connected || 0
      merged.target_appointments += r.target_appointments || 0
      merged.target_interested += r.target_interested || 0
      merged.target_sales += r.target_sales || 0
      merged.target_fcr += r.target_fcr || 0
    }
    return merged
  }

  function openAddModal(agent?: Agent) {
    setTargetDate(fmt(today))
    setForm({
      agent_id: agent?.id || '',
      site_id: null,
      period,
      period_key: pKey,
      ...emptyTarget(),
      agentName: agent?.full_name,
    })
    setShowModal(true)
  }

  function openEditModal(row: TargetRow) {
    const agent = agents.find(a => a.id === row.agent_id)
    setForm({ ...row, agentName: agent?.full_name })
    setShowModal(true)
  }

  async function saveForm() {
    if (!form.agent_id) { showToast('กรุณาเลือกพนักงาน'); return }
    setSaving(true)
    try {
      const selectedDate = new Date(targetDate + 'T00:00:00')
      const savePKey = periodKey(period, selectedDate)
      const row = {
        agent_id: form.agent_id,
        site_id: form.site_id || null,
        period, period_key: savePKey,
        target_calls: form.target_calls,
        target_answered: form.target_answered,
        target_deposit: form.target_deposit,
        target_calls_out: form.target_calls_out,
        target_connected: form.target_connected,
        target_appointments: form.target_appointments,
        target_interested: form.target_interested,
        target_sales: form.target_sales,
        target_fcr: form.target_fcr,
        updated_at: new Date().toISOString(),
      }

      if (form.id) {
        const { error } = await supabase.from('agent_targets').update(row).eq('id', form.id)
        if (error) { showToast('เกิดข้อผิดพลาด: ' + error.message); return }
      } else {
        const { error } = await supabase.from('agent_targets').insert(row)
        if (error) { showToast('เกิดข้อผิดพลาด: ' + error.message); return }
      }

      showToast('บันทึกเป้าหมายเรียบร้อย')
      setShowModal(false)
      loadTargets()
    } finally { setSaving(false) }
  }

  async function deleteTarget(id: string) {
    if (!confirm('ต้องการลบเป้าหมายนี้?')) return
    await supabase.from('agent_targets').delete().eq('id', id)
    showToast('ลบเป้าหมายแล้ว')
    loadTargets()
  }

  function toggleTgtSort(col: string) {
    if (tgtSortBy === col) setTgtSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setTgtSortBy(col); setTgtSortDir('desc') }
  }
  function tgtSortIcon(col: string) { return tgtSortBy === col ? (tgtSortDir === 'asc' ? ' ▲' : ' ▼') : '' }
  const tgtThStyle: React.CSSProperties = { cursor: 'pointer', userSelect: 'none' }

  const sortedTargets = [...targets].sort((a, b) => {
    if (!tgtSortBy) return 0
    let va: number, vb: number
    const getVal = (r: TargetRow, col: string) => {
      if (col === 'calls_out') return r.target_calls_out || 0
      if (col === 'connected') return r.target_connected || 0
      if (col === 'deposit') return parseFloat(String(r.target_deposit || 0))
      if (col === 'pct') {
        const act = actuals[r.agent_id] || { calls: 0, answered: 0, deposit: 0 }
        const totalTarget = r.target_calls_out || 0
        const totalTargetAns = r.target_connected || 0
        const pctCalls = calcPct(act.calls, totalTarget)
        const pctAns = calcPct(act.answered, totalTargetAns)
        const parts = [pctCalls, pctAns]
        if (r.target_deposit > 0) parts.push(calcPct(act.deposit, parseFloat(String(r.target_deposit || 0))))
        return parts.length > 0 ? Math.round(parts.reduce((x, y) => x + y, 0) / parts.length) : 0
      }
      return 0
    }
    va = getVal(a, tgtSortBy); vb = getVal(b, tgtSortBy)
    return tgtSortDir === 'asc' ? va - vb : vb - va
  })

  const teamCalls = Object.values(actuals).reduce((s, a) => s + a.calls, 0)
  const teamAnswered = Object.values(actuals).reduce((s, a) => s + a.answered, 0)
  const teamDeposit = Object.values(actuals).reduce((s, a) => s + a.deposit, 0)
  const teamTgtCalls = targets.reduce((s, t) => s + (t.target_calls_out || 0), 0)
  const teamTgtAns = targets.reduce((s, t) => s + (t.target_connected || 0), 0)
  const teamTgtDep = targets.reduce((s, t) => s + parseFloat(String(t.target_deposit || 0)), 0)

  const [targetDate, setTargetDate] = useState(fmt(today))

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 12px', fontSize: '13px',
    border: '1px solid var(--border)', borderRadius: '8px',
    background: 'var(--bg)', color: '#000',
  }

  if (loading && agents.length === 0) {
    return <div style={{ background: 'var(--bg)', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '12px' }}>
      <div className="spinner" /><span style={{ fontSize: '13px', color: 'var(--text3)' }}>กำลังโหลด...</span>
    </div>
  }

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      {/* Topbar */}
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '13px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 50 }}>
        <div>
          <h2 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text)' }}>🎯 เป้าหมายและผลงาน</h2>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>ติดตามเป้าหมายและผลงานของเจ้าหน้าที่ ({periodLabel})</p>
        </div>
      </div>

      {/* Toast */}
      {toast && <div style={{ position: 'fixed', top: '16px', right: '16px', zIndex: 200, background: '#065f46', color: '#fff', padding: '10px 20px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, boxShadow: '0 4px 12px rgba(0,0,0,.15)' }}>{toast}</div>}

      <div style={{ padding: '20px 24px', maxWidth: '1200px', margin: '0 auto' }}>
        {/* Period tabs */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
          {([{ key: 'daily' as Period, label: 'รายวัน' }, { key: 'weekly' as Period, label: 'รายสัปดาห์' }, { key: 'monthly' as Period, label: 'รายเดือน' }]).map(p => (
            <button key={p.key} className={`btn btn-sm ${period === p.key ? 'btn-primary' : 'btn-outline'}`} onClick={() => setPeriod(p.key)} style={{ fontSize: '12px' }}>{p.label}</button>
          ))}
        </div>

        {/* Team Summary */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,.06)', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)', marginBottom: '16px' }}>📊 สรุปภาพรวมทีม - {periodLabel}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
            {[
              { icon: '📞', label: 'โทร/รับสาย', actual: teamCalls, target: teamTgtCalls, pct: calcPct(teamCalls, teamTgtCalls) },
              { icon: '✅', label: 'ติดต่อสำเร็จ', actual: teamAnswered, target: teamTgtAns, pct: calcPct(teamAnswered, teamTgtAns) },
              { icon: '💰', label: 'ยอดฝากรวม', actual: teamDeposit, target: teamTgtDep, pct: calcPct(teamDeposit, teamTgtDep), isMoney: true },
            ].map(item => (
              <div key={item.label} style={{ padding: '12px', background: 'var(--bg)', borderRadius: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text2)' }}>{item.icon} {item.label}</span>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#000' }}>
                    {item.isMoney ? '฿' : ''}{item.actual.toLocaleString('th-TH', { maximumFractionDigits: 0 })}/{item.isMoney ? '฿' : ''}{item.target.toLocaleString('th-TH', { maximumFractionDigits: 0 })} ({item.pct}%)
                  </span>
                </div>
                <div style={{ height: '8px', background: '#e5e7eb', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min(item.pct, 100)}%`, height: '100%', background: pctColor(item.pct), borderRadius: '4px', transition: 'width 0.5s ease' }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Targets list */}
        {targets.length > 0 ? (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,.06)', overflow: 'hidden', marginBottom: '24px' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)', margin: 0 }}>📋 เป้าหมายที่ตั้งไว้ - {periodLabel}</h3>
            </div>
            <div className="table-wrap">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead className="dark">
                  <tr>
                    <th style={{ padding: '10px 16px', textAlign: 'left' }}>พนักงาน</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left' }}>เว็บ</th>
                    <th style={{ padding: '10px 12px', textAlign: 'center', ...tgtThStyle }} onClick={() => toggleTgtSort('calls_out')}>โทรออก{tgtSortIcon('calls_out')}</th>
                    <th style={{ padding: '10px 12px', textAlign: 'center', ...tgtThStyle }} onClick={() => toggleTgtSort('connected')}>ติดต่อได้{tgtSortIcon('connected')}</th>
                    {!isEditor && <th style={{ padding: '10px 12px', textAlign: 'center', ...tgtThStyle }} onClick={() => toggleTgtSort('deposit')}>ยอดฝาก{tgtSortIcon('deposit')}</th>}
                    <th style={{ padding: '10px 12px', textAlign: 'center', ...tgtThStyle }} onClick={() => toggleTgtSort('pct')}>ผลงาน{tgtSortIcon('pct')}</th>
                    {canEdit && <th style={{ padding: '10px 12px', textAlign: 'center' }}>จัดการ</th>}
                  </tr>
                </thead>
                <tbody>
                  {sortedTargets.map(row => {
                    const agent = agents.find(a => a.id === row.agent_id)
                    const site = sites.find(s => s.id === row.site_id)
                    const act = actuals[row.agent_id] || { calls: 0, answered: 0, deposit: 0 }
                    const totalTarget = row.target_calls_out || 0
                    const totalTargetAns = row.target_connected || 0
                    const pctCalls = calcPct(act.calls, totalTarget)
                    const pctAns = calcPct(act.answered, totalTargetAns)
                    const pctDep = calcPct(act.deposit, parseFloat(String(row.target_deposit || 0)))
                    const parts = [pctCalls, pctAns]
                    if (row.target_deposit > 0) parts.push(pctDep)
                    const avg = parts.length > 0 ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) : 0

                    return (
                      <tr key={row.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '10px 16px', fontWeight: 600 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'linear-gradient(135deg, #6c63ff, #4f46e5)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '11px', fontWeight: 700, flexShrink: 0 }}>
                              {(agent?.full_name || '?').charAt(0)}
                            </div>
                            <div>
                              <div style={{ fontSize: '13px', color: 'var(--text)' }}>{agent?.full_name || 'ไม่ระบุ'}</div>
                              <div style={{ fontSize: '10px', color: 'var(--text3)' }}>{roleLabel(agent?.role || '')}</div>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '10px 12px', fontSize: '12px', color: 'var(--text2)' }}>{site?.name || 'ทุกเว็บ'}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 600, color: '#000' }}>{row.target_calls_out || '-'}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 600, color: '#000' }}>{row.target_connected || '-'}</td>
                        {!isEditor && <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 600, color: '#000' }}>{row.target_deposit ? `฿${Number(row.target_deposit).toLocaleString('th-TH', { maximumFractionDigits: 0 })}` : '-'}</td>}
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          {avg > 0 ? (
                            <span style={{ background: pctBg(avg), color: pctColor(avg), padding: '3px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 700 }}>{avg}%</span>
                          ) : <span style={{ color: 'var(--text3)', fontSize: '11px' }}>รอข้อมูล</span>}
                        </td>
                        {canEdit && (
                          <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                            <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                              <button className="btn btn-outline btn-sm" onClick={() => openEditModal(row)} style={{ fontSize: '11px', padding: '3px 8px' }}>แก้ไข</button>
                              <button className="btn btn-outline btn-sm" onClick={() => deleteTarget(row.id!)} style={{ fontSize: '11px', padding: '3px 8px', color: 'var(--red)' }}>ลบ</button>
                            </div>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,.06)', padding: '40px', textAlign: 'center', marginBottom: '24px' }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>🎯</div>
            <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text)', marginBottom: '6px' }}>ยังไม่ได้ตั้งเป้าหมาย</div>
            <div style={{ fontSize: '13px', color: 'var(--text3)', marginBottom: '20px' }}>กดปุ่ม "เพิ่มเป้าหมาย" เพื่อตั้งเป้าให้พนักงานแต่ละคน</div>
            {canEdit && <button className="btn btn-primary" onClick={() => openAddModal()} style={{ fontSize: '13px' }}>➕ เพิ่มเป้าหมาย</button>}
          </div>
        )}

        {/* Agent Summary Cards */}
        {agents.length > 0 && targets.length > 0 && (
          <div style={{ marginBottom: '24px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)', marginBottom: '12px' }}>🏆 สรุปผลงานรายบุคคล</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '16px' }}>
              {agents.filter(a => targets.some(t => t.agent_id === a.id)).map(agent => {
                const t = getAgentTarget(agent.id)
                const act = actuals[agent.id] || { calls: 0, answered: 0, deposit: 0 }
                const totalTgtCalls = t.target_calls_out
                const totalTgtAns = t.target_connected
                const pctCalls = calcPct(act.calls, totalTgtCalls)
                const pctAns = calcPct(act.answered, totalTgtAns)
                const pctDep = calcPct(act.deposit, t.target_deposit)
                const parts = [pctCalls, pctAns]
                if (t.target_deposit > 0) parts.push(pctDep)
                const avg = parts.length > 0 ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) : 0

                return (
                  <div key={agent.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,.06)', overflow: 'hidden' }}>
                    <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'linear-gradient(135deg, #6c63ff, #4f46e5)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '14px', fontWeight: 700 }}>
                          {agent.full_name.charAt(0)}
                        </div>
                        <div>
                          <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>{agent.full_name}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text3)' }}>{roleLabel(agent.role)}</div>
                        </div>
                      </div>
                      <span style={{ background: pctBg(avg), color: pctColor(avg), padding: '3px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 700 }}>
                        {avg >= 80 ? '✅' : avg >= 50 ? '⚠️' : '❌'} {avg}%
                      </span>
                    </div>
                    <div style={{ padding: '14px 16px' }}>
                      {[
                        { label: '📞 โทร', actual: act.calls, target: totalTgtCalls },
                        { label: '✅ รับสาย/ติดต่อ', actual: act.answered, target: totalTgtAns },
                        ...(!isEditor ? [{ label: '💰 ยอดฝาก', actual: act.deposit, target: t.target_deposit, isMoney: true }] : []),
                      ].map(item => {
                        const pct = calcPct(item.actual, item.target)
                        return (
                          <div key={item.label} style={{ marginBottom: '10px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text2)' }}>{item.label}</span>
                              <span style={{ fontSize: '11px', fontWeight: 600, color: '#000' }}>
                                {(item as any).isMoney ? '฿' : ''}{item.actual.toLocaleString('th-TH', { maximumFractionDigits: 0 })}/{(item as any).isMoney ? '฿' : ''}{item.target.toLocaleString('th-TH', { maximumFractionDigits: 0 })}
                              </span>
                            </div>
                            <div style={{ height: '6px', background: '#e5e7eb', borderRadius: '3px', overflow: 'hidden' }}>
                              <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: pctColor(pct), borderRadius: '3px', transition: 'width 0.5s ease' }} />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {agents.length === 0 && !loading && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,.06)', padding: '40px', textAlign: 'center' }}>
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>👥</div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)' }}>ไม่พบเจ้าหน้าที่</div>
            <div style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '4px' }}>ยังไม่มีเจ้าหน้าที่ที่ active ในระบบ</div>
          </div>
        )}
      </div>

      {/* ═══════════ ADD/EDIT TARGET MODAL ═══════════ */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
          onClick={e => { if (e.target === e.currentTarget) setShowModal(false) }}>
          <div style={{ background: 'var(--surface)', borderRadius: '16px', boxShadow: '0 20px 60px rgba(0,0,0,.2)', width: '100%', maxWidth: '600px', maxHeight: '90vh', overflow: 'auto' }}>
            {/* Modal Header */}
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text)', margin: 0 }}>
                {form.id ? '✏️ แก้ไขเป้าหมาย' : '➕ เพิ่มเป้าหมาย'} ({periodLabel})
              </h3>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: 'var(--text3)' }}>✕</button>
            </div>

            <div style={{ padding: '24px' }}>
              {/* Agent & Site Selection */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
                <div>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: '#000', display: 'block', marginBottom: '6px' }}>👤 เลือกพนักงาน *</label>
                  <select value={form.agent_id} onChange={e => setForm(prev => ({ ...prev, agent_id: e.target.value }))} style={inputStyle} disabled={!!form.id}>
                    <option value="">-- เลือกพนักงาน --</option>
                    {agents.map(a => <option key={a.id} value={a.id}>{a.full_name} ({roleLabel(a.role)})</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: '#000', display: 'block', marginBottom: '6px' }}>🌐 เลือกเว็บ</label>
                  <select value={form.site_id ?? ''} onChange={e => setForm(prev => ({ ...prev, site_id: e.target.value ? Number(e.target.value) : null }))} style={inputStyle}>
                    <option value="">ทุกเว็บ</option>
                    {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>

              {/* Target Date Selection */}
              <div style={{ marginBottom: '24px', padding: '14px 16px', background: '#f0f4ff', borderRadius: '10px', border: '1px solid #d4deff' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#000', display: 'block', marginBottom: '6px' }}>📅 วันที่ตั้งเป้าหมาย</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <input type="date" value={targetDate}
                    onChange={e => setTargetDate(e.target.value)}
                    style={{ ...inputStyle, maxWidth: '200px' }} />
                  <span style={{ fontSize: '12px', color: '#555' }}>
                    {targetDate === fmt(today) ? `(วันนี้ - ${periodLabel})` : `(${period === 'daily' ? targetDate : period === 'weekly' ? `สัปดาห์ของ ${targetDate}` : `เดือนของ ${targetDate}`})`}
                  </span>
                </div>
                {targetDate !== fmt(today) && (
                  <div style={{ fontSize: '11px', color: '#6c63ff', marginTop: '6px', fontWeight: 500 }}>
                    ตั้งเป้าหมายล่วงหน้าสำหรับ {targetDate}
                  </div>
                )}
              </div>

              {/* Section 1: Call Volume */}
              <div style={{ marginBottom: '24px' }}>
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#000', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  จำนวนสายที่รับหรือโทรออก
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                  {[
                    { key: 'target_calls_out', label: 'โทรออก (สาย/วัน)', placeholder: '80-100' },
                    { key: 'target_connected', label: 'โทรสำเร็จ (Connected)', placeholder: '20-30' },
                  ].map(f => (
                    <div key={f.key}>
                      <label style={{ fontSize: '12px', color: '#000', display: 'block', marginBottom: '4px' }}>{f.label}</label>
                      <input type="text" inputMode="numeric" pattern="[0-9]*" placeholder={f.placeholder}
                        value={(form as any)[f.key] || ''}
                        onChange={e => setForm(prev => ({ ...prev, [f.key]: parseInt(e.target.value) || 0 }))}
                        style={{ ...inputStyle, textAlign: 'center' }} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Deposit target */}
              {!isEditor && (
                <div style={{ marginBottom: '24px' }}>
                  <label style={{ fontSize: '12px', color: '#000', display: 'block', marginBottom: '4px' }}>💰 เป้ายอดฝาก (฿)</label>
                  <input type="text" inputMode="numeric" pattern="[0-9]*" placeholder="0"
                    value={form.target_deposit || ''}
                    onChange={e => setForm(prev => ({ ...prev, target_deposit: parseInt(e.target.value) || 0 }))}
                    style={{ ...inputStyle, maxWidth: '200px' }} />
                </div>
              )}

              {/* Actions */}
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button className="btn btn-outline" onClick={() => setShowModal(false)} style={{ fontSize: '13px' }}>ยกเลิก</button>
                <button onClick={saveForm} disabled={saving} style={{ fontSize: '13px', padding: '10px 24px', background: '#22c55e', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 700, cursor: 'pointer' }}>
                  {saving ? 'กำลังบันทึก...' : '💾 บันทึกเป้าหมาย'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
