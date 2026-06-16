'use client'
import { useEffect, useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase-client'
import type { UserProfile } from '@/lib/types'

function fmt(d: Date) { return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }) }

type DateTab = 'today' | 'week' | 'month'

interface AgentPerf {
  id: string
  name: string
  role: string
  calls: number
  answered: number
  notAnswered: number
  deposits: number
  returnedCustomers: number
  lastActivity: string | null   // ISO datetime string
}

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #6c63ff, #4f46e5)',
  'linear-gradient(135deg, #14b8a6, #0d9488)',
  'linear-gradient(135deg, #f59e0b, #d97706)',
  'linear-gradient(135deg, #ec4899, #db2777)',
  'linear-gradient(135deg, #3b82f6, #2563eb)',
  'linear-gradient(135deg, #8b5cf6, #7c3aed)',
  'linear-gradient(135deg, #ef4444, #dc2626)',
  'linear-gradient(135deg, #10b981, #059669)',
]

const ROLE_LABELS: Record<string, { label: string; bg: string; text: string }> = {
  admin:   { label: 'Admin',   bg: '#fef3c7', text: '#92400e' },
  manager: { label: 'Manager', bg: '#dbeafe', text: '#1e40af' },
  editor:  { label: 'Editor',  bg: '#dcfce7', text: '#166534' },
  viewer:  { label: 'Viewer',  bg: '#f3f4f6', text: '#374151' },
}

type SortKey = 'name' | 'calls' | 'answered' | 'rate' | 'deposits' | 'score'

export default function TeamPage() {
  const [userRole, setUserRole] = useState('')
  const [loading, setLoading] = useState(true)
  const [dateTab, setDateTab] = useState<DateTab>('today')
  const [agents, setAgents] = useState<AgentPerf[]>([])
  const [profiles, setProfiles] = useState<UserProfile[]>([])
  const [countdown, setCountdown] = useState(30)
  const [sortBy, setSortBy] = useState<SortKey>('calls')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const supabase = createClient()

  function handleSort(key: SortKey) {
    if (sortBy === key) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(key)
      setSortDir('desc')
    }
  }

  const isEditor = userRole === 'editor'
  const isViewer = userRole === 'viewer'

  // ---------- role ----------
  async function loadRole() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const saved = localStorage.getItem('impersonate_role')
    const { data: profile } = await supabase.from('user_profiles').select('role').eq('id', user.id).single()
    const real = profile?.role || user.user_metadata?.role || ''
    if (saved && (real === 'manager' || real === 'admin')) setUserRole(saved)
    else setUserRole(real)
  }

  // ---------- date range ----------
  function getDateRange(tab: DateTab): { from: string; to: string } {
    const now = new Date()
    const today = fmt(now)
    if (tab === 'today') return { from: today, to: today }
    if (tab === 'week') {
      const d = now.getDay()
      const mon = new Date(now)
      mon.setDate(now.getDate() - (d === 0 ? 6 : d - 1))
      return { from: fmt(mon), to: today }
    }
    // month
    const y = now.getFullYear()
    const m = now.getMonth()
    return { from: `${y}-${String(m + 1).padStart(2, '0')}-01`, to: today }
  }

  // ---------- load data ----------
  const loadData = useCallback(async (tab?: DateTab) => {
    setLoading(true)
    const range = getDateRange(tab ?? dateTab)

    // 1) active profiles
    const { data: profs } = await supabase
      .from('user_profiles')
      .select('id, full_name, role, is_active, created_at')
      .eq('is_active', true)

    setProfiles(profs as UserProfile[] || [])

    const profileMap: Record<string, UserProfile> = {}
    for (const p of profs || []) profileMap[p.id] = p as UserProfile

    // 2) customers in date range (paginated)
    let allCusts: any[] = []
    for (let page = 0; ; page++) {
      const from = page * 1000
      const { data } = await supabase
        .from('customers')
        .select('id, called_by, call_date, call_time, answered, not_answered, total_deposit')
        .gte('call_date', range.from)
        .lte('call_date', range.to)
        .range(from, from + 999)
      if (!data || data.length === 0) break
      allCusts = allCusts.concat(data)
      if (data.length < 1000) break
    }

    // 3) aggregate per agent
    const agentMap: Record<string, AgentPerf> = {}

    // seed with all active profiles so agents with 0 calls still appear
    for (const p of profs || []) {
      agentMap[p.id] = {
        id: p.id,
        name: p.full_name,
        role: p.role,
        calls: 0,
        answered: 0,
        notAnswered: 0,
        deposits: 0,
        returnedCustomers: 0,
        lastActivity: null,
      }
    }

    for (const c of allCusts) {
      const agentId = c.called_by
      if (!agentId || !agentMap[agentId]) continue

      const a = agentMap[agentId]
      a.calls++
      if (c.answered) a.answered++
      if (c.not_answered) a.notAnswered++
      const dep = parseFloat(String(c.total_deposit || 0))
      if (dep > 0) { a.deposits += dep; a.returnedCustomers++ }

      // track last activity
      const dt = c.call_date + (c.call_time ? 'T' + c.call_time : 'T00:00')
      if (!a.lastActivity || dt > a.lastActivity) a.lastActivity = dt
    }

    setAgents(Object.values(agentMap).sort((a, b) => b.calls - a.calls))
    setLoading(false)
  }, [dateTab])

  // ---------- effects ----------
  useEffect(() => { loadRole(); loadData() }, [])
  useEffect(() => { loadData(dateTab) }, [dateTab])

  // auto-refresh every 30s
  useEffect(() => {
    setCountdown(30)
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) { loadData(); return 30 }
        return prev - 1
      })
    }, 1000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [dateTab, loadData])

  // ---------- computed ----------
  const totalCalls = agents.reduce((s, a) => s + a.calls, 0)
  const totalAnswered = agents.reduce((s, a) => s + a.answered, 0)
  const totalDeposits = agents.reduce((s, a) => s + a.deposits, 0)
  const totalReturned = agents.reduce((s, a) => s + a.returnedCustomers, 0)
  const bestPerformer = agents.length > 0 ? agents.reduce((best, a) => a.calls > best.calls ? a : best, agents[0]) : null

  // ranking with sort support
  const ranked = [...agents].filter(a => a.calls > 0).sort((a, b) => {
    const getScore = (ag: AgentPerf) => ag.calls + ag.answered * 2 + ag.returnedCustomers * 5
    const getRate = (ag: AgentPerf) => ag.calls > 0 ? ag.answered / ag.calls : 0

    let cmp = 0
    switch (sortBy) {
      case 'name':
        cmp = a.name.localeCompare(b.name, 'th')
        break
      case 'calls':
        cmp = a.calls - b.calls
        break
      case 'answered':
        cmp = a.answered - b.answered
        break
      case 'rate':
        cmp = getRate(a) - getRate(b)
        break
      case 'deposits':
        cmp = a.deposits - b.deposits
        break
      case 'score':
        cmp = getScore(a) - getScore(b)
        break
    }
    return sortDir === 'asc' ? cmp : -cmp
  })

  function sortIndicator(key: SortKey) {
    if (sortBy !== key) return ''
    return sortDir === 'asc' ? ' ▲' : ' ▼'
  }

  const sortableTh: React.CSSProperties = { cursor: 'pointer', userSelect: 'none' }

  function isOnline(lastActivity: string | null) {
    if (!lastActivity) return false
    const diff = Date.now() - new Date(lastActivity).getTime()
    return diff <= 30 * 60 * 1000
  }

  const DATE_TABS: { key: DateTab; label: string }[] = [
    { key: 'today', label: 'วันนี้' },
    { key: 'week', label: 'สัปดาห์นี้' },
    { key: 'month', label: 'เดือนนี้' },
  ]

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      {/* ── Topbar ── */}
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '13px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 50 }}>
        <div>
          <h2 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text)' }}>ภาพรวมทีม</h2>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>ประสิทธิภาพการทำงานของทีมแบบ Real-time</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Date tabs */}
          <div style={{ display: 'flex', background: 'var(--bg)', borderRadius: '8px', padding: '2px', gap: '2px' }}>
            {DATE_TABS.map(t => (
              <button key={t.key} onClick={() => setDateTab(t.key)}
                style={{
                  padding: '5px 14px', fontSize: '12px', fontWeight: 600, borderRadius: '6px', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  background: dateTab === t.key ? 'var(--accent)' : 'transparent',
                  color: dateTab === t.key ? '#fff' : 'var(--text2)',
                  transition: 'all .15s',
                }}
              >{t.label}</button>
            ))}
          </div>
          {/* Countdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--bg)', border: '1px solid var(--border)', padding: '4px 12px', borderRadius: '20px', fontSize: '11px', color: 'var(--text3)' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', display: 'inline-block', animation: 'pulse 2s infinite' }} />
            รีเฟรชใน {countdown} วินาที
          </div>
        </div>
      </div>

      <div style={{ padding: '24px 28px' }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '300px', gap: '12px', color: 'var(--text3)' }}>
            <div className="spinner" /> กำลังโหลด...
          </div>
        ) : (
          <>
            {/* ── Summary Cards ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px', marginBottom: '28px' }}>
              {[
                { label: 'โทรทั้งหมด', value: totalCalls.toLocaleString(), color: 'var(--accent)' },
                { label: 'รับสาย', value: totalAnswered.toLocaleString(), color: 'var(--green)' },
                ...(!isEditor ? [{ label: 'ยอดฝากรวม', value: `฿${totalDeposits.toLocaleString('th-TH', { maximumFractionDigits: 0 })}`, color: '#f59e0b' }] : []),
                { label: 'ลูกค้ากลับมา', value: `${totalReturned} ราย`, color: '#8b5cf6' },
                { label: 'ผู้ทำงานดีที่สุด', value: bestPerformer?.name || '-', color: '#ec4899' },
              ].map((card, i) => (
                <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,.06)', padding: '16px 20px' }}>
                  <div style={{ fontSize: '12px', color: 'var(--text3)', fontWeight: 500, marginBottom: '8px' }}>{card.label}</div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: '#000', lineHeight: 1 }}>{card.value}</div>
                </div>
              ))}
            </div>

            {/* ── Agent Cards Grid ── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text)' }}>สมาชิกในทีม</span>
              <span style={{ background: 'var(--accent)', color: '#fff', fontSize: '11px', fontWeight: 700, padding: '2px 10px', borderRadius: '20px' }}>
                {agents.length} คน
              </span>
              <span style={{ fontSize: '11px', color: 'var(--text3)', marginLeft: '4px' }}>
                ({agents.filter(a => isOnline(a.lastActivity)).length} ออนไลน์)
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '14px', marginBottom: '32px' }}>
              {agents.map((agent, idx) => {
                const rate = agent.calls > 0 ? (agent.answered / agent.calls) * 100 : 0
                const online = isOnline(agent.lastActivity)
                const roleMeta = ROLE_LABELS[agent.role] || ROLE_LABELS.viewer

                return (
                  <div key={agent.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,.06)', padding: '20px', transition: 'box-shadow .15s' }}>
                    {/* Header: avatar + name + status */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                      {/* Avatar */}
                      <div style={{
                        width: 44, height: 44, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: AVATAR_GRADIENTS[idx % AVATAR_GRADIENTS.length],
                        color: '#fff', fontWeight: 700, fontSize: '16px', flexShrink: 0, position: 'relative',
                      }}>
                        {agent.name.charAt(0).toUpperCase()}
                        {/* Online dot */}
                        <span style={{
                          position: 'absolute', bottom: 0, right: 0, width: 12, height: 12, borderRadius: '50%',
                          background: online ? 'var(--green)' : '#9ca3af',
                          border: '2px solid var(--surface)',
                        }} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {agent.name}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
                          <span style={{ fontSize: '10px', fontWeight: 600, padding: '1px 8px', borderRadius: '10px', background: roleMeta.bg, color: roleMeta.text }}>{roleMeta.label}</span>
                          <span style={{ fontSize: '10px', color: online ? 'var(--green)' : 'var(--text3)' }}>
                            {online ? 'ออนไลน์' : 'ออฟไลน์'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Stats */}
                    <div style={{ display: 'grid', gridTemplateColumns: isEditor ? 'repeat(3, 1fr)' : 'repeat(4, 1fr)', gap: '8px', marginBottom: '14px' }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--accent)' }}>{agent.calls}</div>
                        <div style={{ fontSize: '10px', color: 'var(--text3)' }}>โทรออก</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--green)' }}>{agent.answered}</div>
                        <div style={{ fontSize: '10px', color: 'var(--text3)' }}>รับสาย</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--red)' }}>{agent.notAnswered}</div>
                        <div style={{ fontSize: '10px', color: 'var(--text3)' }}>ไม่รับ</div>
                      </div>
                      {!isEditor && (
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: '18px', fontWeight: 800, color: '#f59e0b' }}>฿{agent.deposits.toLocaleString('th-TH', { maximumFractionDigits: 0 })}</div>
                          <div style={{ fontSize: '10px', color: 'var(--text3)' }}>ยอดฝาก</div>
                        </div>
                      )}
                    </div>

                    {/* Answer rate progress bar */}
                    <div style={{ marginBottom: '12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <span style={{ fontSize: '11px', color: 'var(--text3)' }}>อัตรารับสาย</span>
                        <span style={{ fontSize: '11px', fontWeight: 700, color: rate >= 50 ? 'var(--green)' : 'var(--red)' }}>{rate.toFixed(1)}%</span>
                      </div>
                      <div style={{ height: 6, background: 'var(--bg)', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${Math.min(rate, 100)}%`, borderRadius: '3px', background: rate >= 50 ? 'var(--green)' : 'var(--red)', transition: 'width .4s ease' }} />
                      </div>
                    </div>

                    {/* Last activity */}
                    <div style={{ fontSize: '11px', color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span>กิจกรรมล่าสุด:</span>
                      <span style={{ fontWeight: 500, color: 'var(--text2)' }}>
                        {agent.lastActivity
                          ? new Date(agent.lastActivity).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                          : 'ยังไม่มี'}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* ── Ranking Table ── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text)' }}>อันดับประสิทธิภาพ</span>
              <span style={{ background: '#fef3c7', color: '#92400e', fontSize: '11px', fontWeight: 700, padding: '2px 10px', borderRadius: '20px' }}>
                Ranking
              </span>
            </div>

            <div className="table-wrap">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead className="dark">
                  <tr>
                    <th style={{ padding: '10px 16px', textAlign: 'center', fontWeight: 600, width: 50 }}>#</th>
                    <th onClick={() => handleSort('name')} style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, ...sortableTh }}>ชื่อพนักงาน{sortIndicator('name')}</th>
                    <th onClick={() => handleSort('calls')} style={{ padding: '10px 16px', textAlign: 'center', fontWeight: 600, ...sortableTh }}>โทรออก{sortIndicator('calls')}</th>
                    <th onClick={() => handleSort('answered')} style={{ padding: '10px 16px', textAlign: 'center', fontWeight: 600, ...sortableTh }}>รับสาย{sortIndicator('answered')}</th>
                    <th onClick={() => handleSort('rate')} style={{ padding: '10px 16px', textAlign: 'center', fontWeight: 600, ...sortableTh }}>อัตรา %{sortIndicator('rate')}</th>
                    {!isEditor && <th onClick={() => handleSort('deposits')} style={{ padding: '10px 16px', textAlign: 'center', fontWeight: 600, ...sortableTh }}>ยอดฝาก{sortIndicator('deposits')}</th>}
                    <th onClick={() => handleSort('score')} style={{ padding: '10px 16px', textAlign: 'center', fontWeight: 600, ...sortableTh }}>คะแนน{sortIndicator('score')}</th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.length === 0 ? (
                    <tr><td colSpan={isEditor ? 6 : 7} style={{ padding: '32px', textAlign: 'center', color: 'var(--text3)' }}>ไม่มีข้อมูล</td></tr>
                  ) : ranked.map((agent, i) => {
                    const rate = agent.calls > 0 ? (agent.answered / agent.calls * 100) : 0
                    const score = agent.calls + agent.answered * 2 + agent.returnedCustomers * 5
                    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : ''
                    return (
                      <tr key={agent.id} style={{ borderBottom: '1px solid var(--border)', transition: 'background .1s' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg)')}
                        onMouseLeave={e => (e.currentTarget.style.background = '')}
                      >
                        <td style={{ padding: '10px 16px', textAlign: 'center', fontWeight: 700 }}>
                          {medal ? <span style={{ fontSize: '16px' }}>{medal}</span> : i + 1}
                        </td>
                        <td style={{ padding: '10px 16px', fontWeight: 600, color: 'var(--text)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{
                              width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                              background: AVATAR_GRADIENTS[agents.findIndex(a => a.id === agent.id) % AVATAR_GRADIENTS.length],
                              color: '#fff', fontWeight: 700, fontSize: '12px', flexShrink: 0,
                            }}>
                              {agent.name.charAt(0).toUpperCase()}
                            </div>
                            {agent.name}
                          </div>
                        </td>
                        <td style={{ padding: '10px 16px', textAlign: 'center', color: 'var(--text2)' }}>{agent.calls}</td>
                        <td style={{ padding: '10px 16px', textAlign: 'center', color: 'var(--green)', fontWeight: 600 }}>{agent.answered}</td>
                        <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                          <span style={{
                            display: 'inline-block', padding: '2px 10px', borderRadius: '10px', fontSize: '12px', fontWeight: 600,
                            background: rate >= 50 ? '#dcfce7' : '#fef2f2',
                            color: rate >= 50 ? 'var(--green)' : 'var(--red)',
                          }}>
                            {rate.toFixed(1)}%
                          </span>
                        </td>
                        {!isEditor && (
                          <td style={{ padding: '10px 16px', textAlign: 'center', fontWeight: 600, color: '#f59e0b' }}>
                            ฿{agent.deposits.toLocaleString('th-TH', { maximumFractionDigits: 0 })}
                          </td>
                        )}
                        <td style={{ padding: '10px 16px', textAlign: 'center', fontWeight: 700, color: 'var(--accent)' }}>{score}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
