'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  const supabase = createClient()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const res = await fetch('/api/users/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username }) })
    const json = await res.json()
    const email = json.email

    if (!email) {
      setError('ไม่พบชื่อผู้ใช้นี้ในระบบ')
      setLoading(false)
      return
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง')
      fetch('/api/audit-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, success: false }) }).catch(() => {})
      setLoading(false)
    } else {
      fetch('/api/audit-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, success: true, userId: data.user?.id, userName: data.user?.user_metadata?.full_name || email }) }).catch(() => {})
      router.push('/dashboard')
      router.refresh()
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'radial-gradient(ellipse at 20% 50%, #1a1145 0%, #0d0b1a 50%, #05020d 100%)',
      padding: '20px', position: 'relative', overflow: 'hidden'
    }}>
      {/* Stars */}
      {Array.from({ length: 60 }).map((_, i) => (
        <div key={i} style={{
          position: 'absolute',
          width: i % 5 === 0 ? '3px' : i % 3 === 0 ? '2px' : '1px',
          height: i % 5 === 0 ? '3px' : i % 3 === 0 ? '2px' : '1px',
          borderRadius: '50%',
          background: '#fff',
          opacity: 0.15 + (i % 7) * 0.1,
          top: `${(i * 37 + 13) % 100}%`,
          left: `${(i * 53 + 7) % 100}%`,
          pointerEvents: 'none',
          animation: `twinkle ${2 + (i % 4)}s ease-in-out ${(i % 5) * 0.5}s infinite alternate`,
        }} />
      ))}
      {/* Nebula glow */}
      <div style={{ position: 'absolute', width: '500px', height: '500px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(108,70,229,0.12) 0%, rgba(79,70,229,0.05) 40%, transparent 70%)', top: '-150px', right: '-100px', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', width: '400px', height: '400px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(59,130,246,0.08) 0%, rgba(14,165,233,0.04) 40%, transparent 70%)', bottom: '-100px', left: '-80px', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', width: '300px', height: '300px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(168,85,247,0.06) 0%, transparent 60%)', top: '40%', left: '60%', pointerEvents: 'none' }} />

      <div style={{
        background: 'rgba(255,255,255,0.06)',
        backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: '24px', padding: '48px 40px', width: '100%', maxWidth: '420px',
        boxShadow: '0 25px 60px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.05) inset',
        position: 'relative', zIndex: 1
      }}>
        {/* Logo — Cosmic Chart */}
        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
          <div style={{ width: '88px', height: '88px', margin: '0 auto 20px', position: 'relative' }}>
            <div style={{
              position: 'absolute', inset: '-6px', borderRadius: '22px',
              background: 'linear-gradient(145deg, rgba(108,99,255,0.25), rgba(168,85,247,0.1))',
              animation: 'pulse-glow 3s ease-in-out infinite',
            }} />
            <div style={{
              width: '88px', height: '88px', borderRadius: '22px', position: 'relative',
              background: 'linear-gradient(145deg, #1e1650 0%, #130d35 100%)',
              boxShadow: '0 0 40px rgba(108,99,255,0.2), 0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08)',
              overflow: 'hidden', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: '0 14px 16px',
            }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '45%', background: 'linear-gradient(180deg, rgba(108,99,255,0.08) 0%, transparent 100%)', pointerEvents: 'none' }} />
              {/* Bars */}
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '5px', position: 'relative', zIndex: 1, width: '100%' }}>
                <div style={{ flex: 1, height: '20px', borderRadius: '3px 3px 0 0', background: 'linear-gradient(180deg, rgba(139,92,246,0.7), rgba(139,92,246,0.3))', boxShadow: '0 0 8px rgba(139,92,246,0.3)' }} />
                <div style={{ flex: 1, height: '32px', borderRadius: '3px 3px 0 0', background: 'linear-gradient(180deg, rgba(99,179,255,0.8), rgba(99,179,255,0.3))', boxShadow: '0 0 8px rgba(99,179,255,0.3)' }} />
                <div style={{ flex: 1, height: '24px', borderRadius: '3px 3px 0 0', background: 'linear-gradient(180deg, rgba(168,85,247,0.7), rgba(168,85,247,0.3))', boxShadow: '0 0 8px rgba(168,85,247,0.3)' }} />
                <div style={{ flex: 1, height: '44px', borderRadius: '3px 3px 0 0', background: 'linear-gradient(180deg, rgba(108,99,255,1), rgba(108,99,255,0.5))', boxShadow: '0 0 12px rgba(108,99,255,0.5)' }} />
              </div>
              {/* Trend line */}
              <svg width="60" height="40" viewBox="0 0 60 40" fill="none" style={{ position: 'absolute', bottom: '14px', left: '14px', zIndex: 2, pointerEvents: 'none' }}>
                <path d="M2 32 L16 22 L32 28 L56 6" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="56" cy="6" r="2.5" fill="#fff" style={{ filter: 'drop-shadow(0 0 4px rgba(255,255,255,0.6))' }} />
              </svg>
            </div>
          </div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#fff', letterSpacing: '0.5px' }}>CRM Tracking</h1>
          <p style={{ fontSize: '13px', color: 'rgba(200,190,255,0.5)', marginTop: '6px', fontWeight: 400, letterSpacing: '2px', textTransform: 'uppercase' }}>Customer Reactivation</p>
        </div>

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.8px' }}>ชื่อผู้ใช้</label>
            <input
              type="text" value={username} onChange={e => setUsername(e.target.value)}
              placeholder="Username" required autoFocus
              style={{
                background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)',
                color: '#fff', padding: '12px 16px', borderRadius: '12px',
                fontSize: '14px', outline: 'none', transition: 'border-color 0.2s, background 0.2s',
                fontFamily: 'inherit'
              }}
              onFocus={e => { e.target.style.borderColor = 'rgba(108,99,255,0.6)'; e.target.style.background = 'rgba(255,255,255,0.1)' }}
              onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.12)'; e.target.style.background = 'rgba(255,255,255,0.07)' }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.8px' }}>รหัสผ่าน</label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••" required
              style={{
                background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)',
                color: '#fff', padding: '12px 16px', borderRadius: '12px',
                fontSize: '14px', outline: 'none', transition: 'border-color 0.2s, background 0.2s',
                fontFamily: 'inherit'
              }}
              onFocus={e => { e.target.style.borderColor = 'rgba(108,99,255,0.6)'; e.target.style.background = 'rgba(255,255,255,0.1)' }}
              onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.12)'; e.target.style.background = 'rgba(255,255,255,0.07)' }}
            />
          </div>

          {error && (
            <div style={{ background: 'rgba(239,68,68,.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '12px', padding: '12px 16px', fontSize: '13px', color: '#fca5a5' }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} style={{
            width: '100%', padding: '13px', fontSize: '14px', fontWeight: 600, marginTop: '6px',
            background: 'linear-gradient(135deg, #6c63ff 0%, #4f46e5 100%)',
            color: '#fff', border: 'none', borderRadius: '12px', cursor: 'pointer',
            boxShadow: '0 4px 16px rgba(108,99,255,0.35)',
            transition: 'transform 0.15s, box-shadow 0.15s', fontFamily: 'inherit',
            opacity: loading ? 0.7 : 1
          }}
          onMouseEnter={e => { if (!loading) { (e.target as HTMLElement).style.transform = 'translateY(-1px)'; (e.target as HTMLElement).style.boxShadow = '0 6px 24px rgba(108,99,255,0.45)' } }}
          onMouseLeave={e => { (e.target as HTMLElement).style.transform = 'translateY(0)'; (e.target as HTMLElement).style.boxShadow = '0 4px 16px rgba(108,99,255,0.35)' }}
          >
            {loading ? <span className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px', borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} /> : 'เข้าสู่ระบบ'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: '28px', fontSize: '12px', color: 'rgba(255,255,255,0.35)' }}>
          ยังไม่มีบัญชี?{' '}
          <a href="/setup" style={{ color: 'rgba(108,99,255,0.9)', fontWeight: 500 }}>ตั้งค่าครั้งแรก</a>
        </p>
      </div>
    </div>
  )
}
