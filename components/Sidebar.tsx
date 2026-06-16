'use client'
import { useEffect, useState, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase-client'
import { SITE_ORDER } from '@/lib/constants'
import type { Site } from '@/lib/types'

interface SearchResult {
  id: number
  phone: string
  siteName: string
  call_date: string
  answered: boolean
  not_answered: boolean
  total_deposit: number
}

export default function Sidebar() {
  const [sites, setSites] = useState<Site[]>([])
  const [returnCounts, setReturnCounts] = useState<Record<string, number>>({})
  const [callbackCount, setCallbackCount] = useState(0)
  const [userName, setUserName] = useState('')
  const [userRole, setUserRole] = useState('')
  const [realRole, setRealRole] = useState('')
  const [impersonating, setImpersonating] = useState(false)
  const [hovered, setHovered] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchOpen, setSearchOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)
  const searchTimeout = useRef<NodeJS.Timeout>()
  const router = useRouter()
  const pathname = usePathname()
  const supabase = createClient()

  useEffect(() => {
    loadSites()
    loadUser()
    loadCallbacks()
  }, [])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  async function loadCallbacks() {
    const now = new Date()
    now.setHours(23, 59, 59, 999)
    const { count } = await supabase.from('customers').select('id', { count: 'exact', head: true })
      .not('next_call_at', 'is', null).lte('next_call_at', now.toISOString())
    setCallbackCount(count || 0)
  }

  async function loadSites() {
    const { data: siteList } = await supabase.from('sites').select('*').order('id')
    if (!siteList) return
    const sorted = [...siteList].sort((a, b) => {
      const ai = SITE_ORDER.indexOf(a.name)
      const bi = SITE_ORDER.indexOf(b.name)
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
    })
    setSites(sorted)
    const { data: custs } = await supabase
      .from('customers').select('site_id, total_deposit').gt('total_deposit', 0)
    const counts: Record<string, number> = {}
    for (const c of custs || []) {
      const s = siteList.find(s => s.id === c.site_id)
      if (s) counts[s.name] = (counts[s.name] || 0) + 1
    }
    setReturnCounts(counts)
  }

  async function loadUser() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: profile } = await supabase.from('user_profiles').select('*').eq('id', user.id).single()
    const meta = user.user_metadata || {}
    setUserName(profile?.full_name || meta.full_name || user.email || '')
    const role = profile?.role || meta.role || ''
    setRealRole(role)
    const saved = localStorage.getItem('impersonate_role')
    if (saved && (role === 'manager' || role === 'admin')) {
      setUserRole(saved)
      setImpersonating(true)
    } else {
      setUserRole(role)
      localStorage.removeItem('impersonate_role')
    }
  }

  async function handleSearch(query: string) {
    setSearchQuery(query)
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    if (!query || query.length < 2) { setSearchResults([]); setSearchOpen(false); return }
    setSearchOpen(true)
    setSearching(true)
    searchTimeout.current = setTimeout(async () => {
      const clean = query.replace(/\D/g, '')
      const isPhone = clean.length >= 3
      let q = supabase.from('customers').select('id, phone, call_date, answered, not_answered, total_deposit, sites(name)').limit(10)
      if (isPhone) q = q.ilike('phone', `%${clean}%`)
      else q = q.ilike('phone', `%${query}%`)
      const { data } = await q
      setSearchResults((data || []).map(c => ({ ...c, siteName: (c.sites as any)?.name || '' })))
      setSearching(false)
    }, 300)
  }

  async function handleLogout() {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        fetch('/api/audit-login', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: user.email, success: true, userId: user.id, userName: userName, action: 'logout' })
        }).catch(() => {})
      }
    } catch {}
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const sectionLabel = (text: string) => (
    <div style={{
      fontSize: '10px', color: '#94a3b8', padding: '8px 16px 6px',
      textTransform: 'uppercase', letterSpacing: '1.2px', fontWeight: 700,
    }}>{text}</div>
  )

  const navItem = (href: string, icon: string, label: string, badge?: number, badgeColor?: string) => {
    const isActive = pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
    const isHover = hovered === href
    return (
      <a key={href} href={href}
        onMouseEnter={() => setHovered(href)}
        onMouseLeave={() => setHovered('')}
        style={{
          display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 16px',
          color: isActive ? '#1e293b' : isHover ? '#334155' : '#475569',
          background: isActive ? 'linear-gradient(90deg, rgba(99,102,241,.12), rgba(99,102,241,.03))' : isHover ? 'rgba(0,0,0,.03)' : 'transparent',
          borderLeft: `3px solid ${isActive ? '#6366f1' : 'transparent'}`,
          fontSize: '13px', fontWeight: isActive ? 600 : 500, transition: 'all .2s', textDecoration: 'none',
          cursor: 'pointer', borderRadius: '0 6px 6px 0', marginRight: '6px',
        }}>
        <span style={{ fontSize: '14px', opacity: isActive ? 1 : 0.7 }}>{icon}</span>
        <span style={{ flex: 1 }}>{label}</span>
        {badge !== undefined && badge > 0 && (
          <span style={{
            background: badgeColor || '#22c55e', color: '#fff', fontSize: '10px',
            padding: '2px 7px', borderRadius: '10px', fontWeight: 700, minWidth: '20px', textAlign: 'center',
          }}>
            {badgeColor === '#dc2626' ? '🔔 ' : ''}{badge}
          </span>
        )}
      </a>
    )
  }

  return (
    <nav style={{
      width: '230px', height: '100vh',
      background: '#fff',
      borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column',
      position: 'fixed', top: 0, left: 0, zIndex: 100,
    }}>
      {/* Logo */}
      <div style={{ padding: '18px 18px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
          <div style={{
            width: '36px', height: '36px', borderRadius: '10px',
            background: 'linear-gradient(145deg, #1e1650 0%, #130d35 100%)',
            boxShadow: '0 0 12px rgba(108,99,255,0.2), 0 3px 10px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.08)',
            position: 'relative', overflow: 'hidden',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: '0 6px 6px',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', width: '100%', position: 'relative', zIndex: 1 }}>
              <div style={{ flex: 1, height: '8px', borderRadius: '1.5px 1.5px 0 0', background: 'linear-gradient(180deg, rgba(139,92,246,0.7), rgba(139,92,246,0.3))' }} />
              <div style={{ flex: 1, height: '13px', borderRadius: '1.5px 1.5px 0 0', background: 'linear-gradient(180deg, rgba(99,179,255,0.8), rgba(99,179,255,0.3))' }} />
              <div style={{ flex: 1, height: '10px', borderRadius: '1.5px 1.5px 0 0', background: 'linear-gradient(180deg, rgba(168,85,247,0.7), rgba(168,85,247,0.3))' }} />
              <div style={{ flex: 1, height: '18px', borderRadius: '1.5px 1.5px 0 0', background: 'linear-gradient(180deg, rgba(108,99,255,1), rgba(108,99,255,0.5))', boxShadow: '0 0 4px rgba(108,99,255,0.4)' }} />
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: '14px', fontWeight: 700, color: '#1e293b', lineHeight: 1.2 }}>CRM Tracking</h1>
            <p style={{ fontSize: '10px', color: '#94a3b8', marginTop: '1px' }}>Customer Reactivation</p>
          </div>
        </div>

        {/* Quick Search */}
        <div ref={searchRef} style={{ position: 'relative' }}>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '13px', color: '#94a3b8' }}>🔍</span>
            <input
              type="text"
              value={searchQuery}
              onChange={e => handleSearch(e.target.value)}
              onFocus={() => searchQuery.length >= 2 && setSearchOpen(true)}
              placeholder="ค้นหาเบอร์โทร..."
              style={{
                width: '100%', padding: '8px 10px 8px 32px', border: '1px solid var(--border)',
                borderRadius: '8px', fontSize: '12px', outline: 'none', background: 'var(--surface2)',
                color: 'var(--text)', transition: 'border-color .2s',
              }}
            />
          </div>
          {searchOpen && (
            <div style={{
              position: 'absolute', top: '40px', left: 0, right: 0, width: '100%',
              background: '#fff', border: '1px solid var(--border)', borderRadius: '10px',
              boxShadow: '0 8px 30px rgba(0,0,0,.12)', zIndex: 200, overflow: 'hidden',
            }}>
              {searching ? (
                <div style={{ padding: '16px', textAlign: 'center', color: '#94a3b8', fontSize: '12px' }}>
                  <span className="spinner" style={{ width: '14px', height: '14px', marginRight: '6px', verticalAlign: 'middle' }} /> กำลังค้นหา...
                </div>
              ) : searchResults.length === 0 ? (
                <div style={{ padding: '16px', textAlign: 'center', color: '#94a3b8', fontSize: '12px' }}>ไม่พบผลลัพธ์</div>
              ) : (
                <div style={{ maxHeight: '250px', overflowY: 'auto' }}>
                  {searchResults.map(r => (
                    <a key={r.id} href={`/sites/${encodeURIComponent(r.siteName)}`}
                      onClick={() => { setSearchOpen(false); setSearchQuery('') }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px',
                        borderBottom: '1px solid var(--border)', textDecoration: 'none', color: 'inherit',
                        transition: 'background .15s', cursor: 'pointer',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                      onMouseLeave={e => (e.currentTarget.style.background = '')}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: '#1e293b' }}>📱 {r.phone}</div>
                        <div style={{ fontSize: '11px', color: '#64748b', marginTop: '1px' }}>
                          {r.siteName} • {r.call_date}
                          {r.answered && <span style={{ color: '#16a34a', marginLeft: '6px' }}>✅ รับสาย</span>}
                          {r.not_answered && <span style={{ color: '#dc2626', marginLeft: '6px' }}>❌ ไม่รับ</span>}
                        </div>
                      </div>
                      {r.total_deposit > 0 && (
                        <span style={{ fontSize: '11px', fontWeight: 700, color: '#16a34a' }}>฿{r.total_deposit.toLocaleString()}</span>
                      )}
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
        <div style={{ paddingBottom: '6px', borderBottom: '1px solid var(--border)' }}>
          {sectionLabel('เมนูหลัก')}
          {navItem('/dashboard', '📊', 'Dashboard')}
          {navItem('/tracking', '📞', 'การโทรติดตาม', callbackCount, '#dc2626')}
          {navItem('/reports/cohort', '📈', 'ติดตามการกลับมาฝาก')}
          {navItem('/daily', '📅', 'รายงานรายวัน')}
          {userRole !== 'editor' && navItem('/weekly', '📋', 'สรุปรายสัปดาห์/รายเดือน')}
          {navItem('/admin/sms-templates', '💬', 'คลัง SMS')}
          {navItem('/calendar', '🗓️', 'ปฏิทินนัดโทร')}
          {userRole !== 'editor' && navItem('/reports/agents', '👤', 'ผลงานรายพนักงาน')}
        </div>

        {userRole !== 'editor' && (
          <div style={{ paddingBottom: '6px', borderBottom: '1px solid var(--border)' }}>
            {sectionLabel('ทีมงาน')}
            {navItem('/team', '👥', 'ภาพรวมทีม')}
            {navItem('/targets', '🎯', 'เป้าหมาย')}
            {navItem('/notes', '📝', 'บันทึกช่วยจำ')}
          </div>
        )}

        <div style={{ paddingBottom: '6px', borderBottom: '1px solid var(--border)' }}>
          {sectionLabel('เว็บไซต์')}
          {sites.map(s => navItem(`/sites/${encodeURIComponent(s.name)}`, '🌐', s.name, returnCounts[s.name]))}
        </div>

        {userRole !== 'editor' && (
          <div style={{ paddingBottom: '6px' }}>
            {sectionLabel('ตั้งค่า')}
            {navItem('/import', '📥', 'นำเข้าข้อมูลลูกค้า')}
            {navItem('/settings/password', '⚙️', 'จัดการแอดมิน')}
            {navItem('/admin/audit', '📋', 'Audit Log')}
            {navItem('/admin/notifications', '🔔', 'แจ้งเตือน Telegram')}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{
        padding: '14px 16px', borderTop: '1px solid var(--border)', flexShrink: 0,
        background: impersonating ? 'rgba(251,191,36,.08)' : 'var(--surface2)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
          <div style={{
            width: '32px', height: '32px', borderRadius: '50%',
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '14px', color: '#fff', fontWeight: 700,
          }}>{userName.charAt(0).toUpperCase()}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{userName}</div>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>
              {userRole === 'manager' ? '🔑 Manager' : userRole === 'admin' ? '🛡️ Admin' : userRole === 'editor' ? '✏️ Editor' : '👁 Viewer'}
              {impersonating && <span style={{ color: '#d97706', fontWeight: 700 }}> (จำลอง)</span>}
            </div>
          </div>
        </div>
        {(realRole === 'manager' || realRole === 'admin') && (
          <div style={{ marginBottom: '8px' }}>
            {impersonating ? (
              <button onClick={() => { localStorage.removeItem('impersonate_role'); setUserRole(realRole); setImpersonating(false) }} style={{ width: '100%', padding: '6px 8px', background: 'linear-gradient(90deg, #fbbf24, #f59e0b)', border: 'none', borderRadius: '6px', fontSize: '11px', color: '#78350f', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700 }}>🔄 กลับเป็น {realRole === 'manager' ? 'Manager' : 'Admin'}</button>
            ) : (
              <select value="" onChange={e => { if (!e.target.value) return; localStorage.setItem('impersonate_role', e.target.value); setUserRole(e.target.value); setImpersonating(true) }} style={{ width: '100%', padding: '6px 8px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '11px', color: '#64748b', cursor: 'pointer', fontFamily: 'inherit' }}>
                <option value="">🔍 จำลองบทบาท...</option>
                <option value="admin">🛡️ Admin</option>
                <option value="editor">✏️ Editor</option>
                <option value="viewer">👁 Viewer</option>
              </select>
            )}
          </div>
        )}
        <button
          onClick={handleLogout}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,.08)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'var(--surface)')}
          style={{ width: '100%', padding: '6px 8px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '11px', color: '#ef4444', cursor: 'pointer', fontFamily: 'inherit', transition: 'all .2s' }}
        >ออกจากระบบ</button>
      </div>
    </nav>
  )
}
