'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-client'
import type { Site, UserProfile } from '@/lib/types'

function strengthLevel(pwd: string): { label: string; color: string; pct: number } {
  if (!pwd) return { label: '', color: '#e5e7eb', pct: 0 }
  let score = 0
  if (pwd.length >= 6) score++
  if (pwd.length >= 10) score++
  if (/[A-Z]/.test(pwd)) score++
  if (/[0-9]/.test(pwd)) score++
  if (/[^A-Za-z0-9]/.test(pwd)) score++
  if (score <= 1) return { label: 'อ่อนมาก', color: '#dc2626', pct: 20 }
  if (score === 2) return { label: 'อ่อน', color: '#f97316', pct: 40 }
  if (score === 3) return { label: 'พอใช้', color: '#eab308', pct: 60 }
  if (score === 4) return { label: 'แข็งแรง', color: '#22c55e', pct: 80 }
  return { label: 'แข็งแรงมาก', color: '#16a34a', pct: 100 }
}

const ROLES = [
  { value: 'manager', label: 'Manager', desc: 'จัดการทุกอย่าง', color: '#6c63ff', icon: '🔑' },
  { value: 'admin',   label: 'Admin',   desc: 'ผู้ช่วย Manager', color: '#0891b2', icon: '🛡️' },
  { value: 'editor',  label: 'Editor',  desc: 'เพิ่ม/แก้ไขข้อมูล', color: '#d97706', icon: '✏️' },
  { value: 'viewer',  label: 'Viewer',  desc: 'ดูข้อมูลอย่างเดียว', color: '#6b7280', icon: '👁' },
]

const PERMISSIONS = [
  { feature: 'ดูข้อมูลลูกค้า',       manager: true, admin: true, editor: true, viewer: true },
  { feature: 'เพิ่ม/แก้ไขลูกค้า',     manager: true, admin: true, editor: true, viewer: false },
  { feature: 'ส่ง SMS / บันทึกโทร',   manager: true, admin: true, editor: true, viewer: false },
  { feature: 'ดูรายงาน Excel',        manager: true, admin: true, editor: true, viewer: true },
  { feature: 'ดู Cohort / Dashboard', manager: true, admin: true, editor: true, viewer: true },
  { feature: 'จัดการพนักงาน',         manager: true, admin: true, editor: false, viewer: false },
  { feature: 'จัดการ SMS Template',    manager: true, admin: false, editor: false, viewer: false },
  { feature: 'ดู Audit Log',          manager: true, admin: false, editor: false, viewer: false },
  { feature: 'ตั้งค่าแจ้งเตือน',       manager: true, admin: false, editor: false, viewer: false },
]

export default function ProfilePasswordPage() {
  const [form, setForm] = useState({ current: '', newPwd: '', confirm: '' })
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState({ msg: '', type: '' })
  const [profile, setProfile] = useState({ id: '', name: '', email: '', role: '' })
  const [users, setUsers] = useState<(UserProfile & { email: string })[]>([])
  const [sites, setSites] = useState<Site[]>([])
  const [usersLoading, setUsersLoading] = useState(true)
  const [editingUser, setEditingUser] = useState<string | null>(null)
  const [editRole, setEditRole] = useState('')
  const [editSiteAccess, setEditSiteAccess] = useState<string[]>([])
  const [editPhone, setEditPhone] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editActive, setEditActive] = useState(true)
  const [editPwdForm, setEditPwdForm] = useState({ newPwd: '', confirmPwd: '' })
  const [showPwdChange, setShowPwdChange] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [addForm, setAddForm] = useState({ full_name: '', email: '', password: '', confirmPwd: '', role: 'viewer' as string, site_access: [] as string[] })
  const [addSaving, setAddSaving] = useState(false)
  const [roleChanging, setRoleChanging] = useState(false)
  const [roleFilter, setRoleFilter] = useState<string[]>([])
  const [userSearch, setUserSearch] = useState('')
  const [showPermissions, setShowPermissions] = useState(false)
  const [userRole, setUserRole] = useState('')
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => { loadProfile(); loadUsers(); loadSites() }, [])

  async function loadSites() {
    const { data } = await supabase.from('sites').select('*').order('id')
    setSites(data || [])
  }

  async function loadProfile() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const res = await fetch('/api/users')
    const data = await res.json()
    const me = (data.users || []).find((u: any) => u.id === user.id)
    const real = me?.role || 'viewer'
    setProfile({ id: user.id, name: me?.full_name || user.email || '', email: user.email || '', role: real })
    const saved = localStorage.getItem('impersonate_role')
    if (saved && (real === 'manager' || real === 'admin')) setUserRole(saved)
    else setUserRole(real)
  }

  async function loadUsers() {
    setUsersLoading(true)
    const res = await fetch('/api/users')
    const data = await res.json()
    setUsers(data.users || [])
    setUsersLoading(false)
  }

  async function handleChangeOwnRole(newRole: string) {
    setRoleChanging(true)
    await fetch('/api/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update', id: profile.id, role: newRole })
    })
    setProfile(p => ({ ...p, role: newRole }))
    setRoleChanging(false)
    flash('เปลี่ยน Role สำเร็จ', 'success')
    loadUsers()
  }

  async function handleSaveUserEdit(userId: string) {
    await fetch('/api/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update', id: userId, role: editRole, site_access: editSiteAccess.length > 0 ? editSiteAccess : null, phone: editPhone || null, is_active: editActive, email: editEmail || undefined })
    })
    setEditingUser(null)
    setShowPwdChange(false)
    flash('อัปเดตสำเร็จ', 'success')
    loadUsers()
    if (userId === profile.id) setProfile(p => ({ ...p, role: editRole }))
  }

  async function handleChangeUserPwd(userId: string) {
    if (editPwdForm.newPwd !== editPwdForm.confirmPwd) { flash('รหัสผ่านไม่ตรงกัน', 'error'); return }
    if (editPwdForm.newPwd.length < 6) { flash('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร', 'error'); return }
    await fetch('/api/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update', id: userId, password: editPwdForm.newPwd })
    })
    setEditPwdForm({ newPwd: '', confirmPwd: '' })
    setShowPwdChange(false)
    flash('เปลี่ยนรหัสผ่านสำเร็จ', 'success')
  }

  async function handleDeleteUser(u: UserProfile & { email: string }) {
    if (!confirm(`ลบผู้ใช้ "${u.full_name}" (${u.email})? การกระทำนี้ย้อนกลับไม่ได้`)) return
    await fetch('/api/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id: u.id })
    })
    flash('ลบผู้ใช้สำเร็จ', 'success')
    loadUsers()
  }

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault()
    if (addForm.password !== addForm.confirmPwd) { flash('รหัสผ่านไม่ตรงกัน', 'error'); return }
    if (addForm.password.length < 6) { flash('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร', 'error'); return }
    if (!addForm.full_name) { flash('กรุณากรอกชื่อผู้ใช้', 'error'); return }
    setAddSaving(true)
    const slug = addForm.full_name.toLowerCase().replace(/[^a-z0-9]/g, '') || 'user'
    const autoEmail = addForm.email || `${slug}.${Date.now()}@crm-admin.com`
    const res = await fetch('/api/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create', full_name: addForm.full_name, email: autoEmail, password: addForm.password, role: addForm.role, site_access: addForm.site_access.length > 0 ? addForm.site_access : null })
    })
    const data = await res.json()
    if (data.error) { flash(data.error, 'error') }
    else { flash(`สร้าง "${addForm.full_name}" สำเร็จ!`, 'success'); setAddForm({ full_name: '', email: '', password: '', confirmPwd: '', role: 'viewer', site_access: [] }); setShowAddForm(false); loadUsers() }
    setAddSaving(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (form.newPwd !== form.confirm) { flash('รหัสผ่านใหม่ไม่ตรงกัน', 'error'); return }
    if (form.newPwd.length < 6) { flash('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร', 'error'); return }
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email) { flash('ไม่พบข้อมูลผู้ใช้', 'error'); setLoading(false); return }
    const { error: signInErr } = await supabase.auth.signInWithPassword({ email: user.email, password: form.current })
    if (signInErr) { flash('รหัสผ่านปัจจุบันไม่ถูกต้อง', 'error'); setLoading(false); return }
    const { error } = await supabase.auth.updateUser({ password: form.newPwd })
    if (error) { flash(error.message, 'error'); setLoading(false) }
    else {
      flash('เปลี่ยนรหัสผ่านสำเร็จ! กำลังออกจากระบบ...', 'success')
      setForm({ current: '', newPwd: '', confirm: '' }); setLoading(false)
      setTimeout(async () => { await supabase.auth.signOut(); router.push('/login'); router.refresh() }, 2000)
    }
  }

  function flash(msg: string, type: string) { setToast({ msg, type }); setTimeout(() => setToast({ msg: '', type: '' }), 4000) }

  const strength = strengthLevel(form.newPwd)
  const myRole = ROLES.find(r => r.value === profile.role) || ROLES[3]
  const isManager = profile.role === 'manager'
  const isAdminOrManager = isManager || profile.role === 'admin'
  const canViewAdmin = isAdminOrManager || userRole === 'viewer'
  const isViewer = userRole === 'viewer'

  return (
    <div>
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '13px 24px', position: 'sticky', top: 0, zIndex: 50 }}>
        <h2 style={{ fontSize: '15px', fontWeight: 600 }}>🔒 จัดการแอดมิน</h2>
        <p style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '2px' }}>จัดการโปรไฟล์, ผู้ใช้งาน, สิทธิ์การเข้าถึง</p>
      </div>

      <div style={{ padding: '20px', maxWidth: '720px' }}>
        {!profile.role ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '60px', gap: '8px', color: 'var(--text3)' }}><div className="spinner" /> กำลังโหลด...</div>
        ) : (<>
        {/* ─── Profile Card with Editable Role ─── */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '16px', padding: '24px', marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px' }}>
            <div style={{ width: '52px', height: '52px', borderRadius: '50%', background: `linear-gradient(135deg, ${myRole.color}33, ${myRole.color}15)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px' }}>
              {myRole.icon}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text)' }}>{profile.name}</div>
              <div style={{ fontSize: '12px', color: 'var(--text3)', fontFamily: 'monospace', marginTop: '2px' }}>{profile.email}</div>
            </div>
          </div>

          {isManager ? (
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.4px', display: 'block', marginBottom: '8px' }}>บทบาทของฉัน (คลิกเพื่อเปลี่ยน)</label>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {ROLES.map(ro => (
                  <button key={ro.value} onClick={() => handleChangeOwnRole(ro.value)} disabled={roleChanging}
                    style={{ padding: '8px 16px', borderRadius: '10px', border: `1.5px solid ${profile.role === ro.value ? ro.color : 'var(--border)'}`, background: profile.role === ro.value ? `${ro.color}15` : 'var(--surface2)', cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s' }}>
                    <div style={{ fontWeight: 700, fontSize: '12px', color: profile.role === ro.value ? ro.color : 'var(--text2)' }}>{ro.icon} {ro.label}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '2px' }}>{ro.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ background: `${myRole.color}15`, border: `1px solid ${myRole.color}30`, borderRadius: '10px', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '14px' }}>{myRole.icon}</span>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: myRole.color }}>{myRole.label.toUpperCase()}</div>
                <div style={{ fontSize: '11px', color: 'var(--text2)' }}>{myRole.desc}</div>
              </div>
            </div>
          )}
        </div>

        {/* ─── User Management ─── */}
        {canViewAdmin && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '16px', padding: '24px', marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)' }}>👥 รายชื่อแอดมิน ({users.length} คน)</h3>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button className="btn btn-outline btn-sm" onClick={() => setShowPermissions(!showPermissions)}>
                  {showPermissions ? '✕ ปิด' : '🛡️ รายละเอียดบทบาท'}
                </button>
                {!isViewer && <button className="btn btn-primary btn-sm" onClick={() => { setShowAddForm(!showAddForm); setEditingUser(null) }}>
                  {showAddForm ? '✕ ยกเลิก' : '+ ลงทะเบียนผู้ดูแลระบบ'}
                </button>}
              </div>
            </div>

            {showAddForm && (
              <form onSubmit={handleAddUser} style={{ display: 'flex', flexDirection: 'column', gap: '12px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '12px', padding: '18px', marginBottom: '16px' }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)', marginBottom: '4px' }}>ลงทะเบียนผู้ดูแลระบบ</div>
                <div className="form-group">
                  <label>บทบาท</label>
                  <select value={addForm.role} onChange={e => setAddForm({ ...addForm, role: e.target.value })} style={{ padding: '9px 12px' }}>
                    {ROLES.map(ro => <option key={ro.value} value={ro.value}>{ro.icon} {ro.label} — {ro.desc}</option>)}
                  </select>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div className="form-group"><label>ชื่อผู้ใช้</label><input value={addForm.full_name} onChange={e => setAddForm({ ...addForm, full_name: e.target.value })} placeholder="ชื่อผู้ใช้" required /></div>
                  <div className="form-group"><label>อีเมล (ไม่บังคับ)</label><input type="email" value={addForm.email} onChange={e => setAddForm({ ...addForm, email: e.target.value })} placeholder="ว่างไว้ = สร้างอัตโนมัติ" /></div>
                  <div className="form-group">
                    <label>รหัสผ่าน</label>
                    <input type="password" value={addForm.password} onChange={e => setAddForm({ ...addForm, password: e.target.value })} placeholder="อย่างน้อย 6 ตัวอักษร" required />
                    {addForm.password && (
                      <div style={{ marginTop: '4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '3px' }}>
                          <span style={{ fontSize: '11px', color: 'var(--text3)' }}>ความแข็งแรง:</span>
                          <span style={{ fontSize: '11px', fontWeight: 700, color: strengthLevel(addForm.password).color }}>{strengthLevel(addForm.password).label}</span>
                        </div>
                        <div style={{ background: '#e5e7eb', borderRadius: '3px', height: '4px', overflow: 'hidden' }}>
                          <div style={{ height: '100%', background: strengthLevel(addForm.password).color, borderRadius: '3px', width: `${strengthLevel(addForm.password).pct}%`, transition: 'all .3s' }} />
                        </div>
                        {addForm.password.length < 6 && <div style={{ fontSize: '11px', color: 'var(--red)', marginTop: '3px' }}>รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร</div>}
                      </div>
                    )}
                  </div>
                  <div className="form-group">
                    <label>ยืนยันรหัสผ่าน</label>
                    <input type="password" value={addForm.confirmPwd} onChange={e => setAddForm({ ...addForm, confirmPwd: e.target.value })} placeholder="ยืนยันรหัสผ่าน" required />
                    {addForm.confirmPwd && addForm.password !== addForm.confirmPwd && <div style={{ fontSize: '11px', color: 'var(--red)', marginTop: '3px' }}>รหัสผ่านไม่ตรงกัน</div>}
                    {addForm.confirmPwd && addForm.password === addForm.confirmPwd && <div style={{ fontSize: '11px', color: 'var(--green)', marginTop: '3px' }}>✓ รหัสผ่านตรงกัน</div>}
                  </div>
                </div>
                <div className="form-group">
                  <label>จำกัดเว็บที่เข้าถึงได้</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                    {sites.map(s => (
                      <label key={s.id} style={{ padding: '4px 10px', borderRadius: '16px', fontSize: '11px', cursor: 'pointer', background: addForm.site_access.includes(s.name) ? 'rgba(108,99,255,.18)' : 'var(--surface)', border: `1px solid ${addForm.site_access.includes(s.name) ? 'var(--accent)' : 'var(--border)'}`, fontWeight: addForm.site_access.includes(s.name) ? 700 : 400, color: addForm.site_access.includes(s.name) ? 'var(--accent)' : 'var(--text2)' }}>
                        <input type="checkbox" checked={addForm.site_access.includes(s.name)} onChange={e => setAddForm({ ...addForm, site_access: e.target.checked ? [...addForm.site_access, s.name] : addForm.site_access.filter(x => x !== s.name) })} style={{ display: 'none' }} />
                        {s.name}
                      </label>
                    ))}
                  </div>
                </div>

                {/* ─── เกณฑ์ตรวจรับ ─── */}
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '12px 14px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)', marginBottom: '8px' }}>เกณฑ์ตรวจรับ</div>
                  {[
                    { check: addForm.password.length >= 6, label: 'รหัสผ่านอย่างน้อย 6 ตัวอักษร' },
                    { check: addForm.password === addForm.confirmPwd && addForm.confirmPwd.length > 0, label: 'รหัสผ่าน 2 ช่องตรงกัน' },
                    { check: addForm.full_name.length > 0, label: 'มีชื่อผู้ใช้' },
                  ].map((rule, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: rule.check ? 'var(--green)' : 'var(--text3)', marginBottom: '4px' }}>
                      <span>{rule.check ? '✅' : '⬜'}</span> {rule.label}
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button type="submit" className="btn btn-success" disabled={addSaving || addForm.password !== addForm.confirmPwd || addForm.password.length < 6} style={{ padding: '10px 24px' }}>
                    {addSaving ? 'กำลังสร้าง...' : '✅ บันทึก'}
                  </button>
                  <button type="button" className="btn btn-outline" onClick={() => setShowAddForm(false)} style={{ padding: '10px 24px' }}>ยกเลิก</button>
                </div>
              </form>
            )}

            {/* ─── Search ─── */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'flex-end' }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label>ชื่อผู้ใช้</label>
                <input value={userSearch} onChange={e => setUserSearch(e.target.value)} placeholder="ค้นหาชื่อผู้ใช้..." />
              </div>
              <button className="btn btn-success" onClick={() => {}}>🔍 ค้นหา</button>
            </div>

            {/* ─── Role Filter ─── */}
            <div style={{ marginBottom: '14px' }}>
              <label style={{ fontSize: '11px', color: 'var(--text3)', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '.4px' }}>บทบาท</label>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 12px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', background: roleFilter.length === 0 ? 'rgba(108,99,255,.15)' : 'var(--surface2)', border: `1px solid ${roleFilter.length === 0 ? 'var(--accent)' : 'var(--border)'}`, fontWeight: 600, color: roleFilter.length === 0 ? 'var(--accent)' : 'var(--text2)' }}>
                  <input type="checkbox" checked={roleFilter.length === 0} onChange={() => setRoleFilter([])} style={{ accentColor: 'var(--accent)' }} />
                  ทั้งหมด
                </label>
                {ROLES.map(ro => (
                  <label key={ro.value} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 12px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', background: roleFilter.includes(ro.value) ? `${ro.color}15` : 'var(--surface2)', border: `1px solid ${roleFilter.includes(ro.value) ? ro.color : 'var(--border)'}`, fontWeight: 600, color: roleFilter.includes(ro.value) ? ro.color : 'var(--text2)' }}>
                    <input type="checkbox" checked={roleFilter.includes(ro.value)} onChange={e => setRoleFilter(e.target.checked ? [...roleFilter, ro.value] : roleFilter.filter(x => x !== ro.value))} style={{ accentColor: ro.color }} />
                    {ro.label}
                  </label>
                ))}
              </div>
            </div>

            {usersLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px', gap: '8px', color: 'var(--text3)' }}><div className="spinner" /> กำลังโหลด...</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {users.filter(u => {
                  if (roleFilter.length > 0 && !roleFilter.includes(u.role)) return false
                  if (userSearch && !u.full_name.toLowerCase().includes(userSearch.toLowerCase()) && !u.email.toLowerCase().includes(userSearch.toLowerCase())) return false
                  return true
                }).map(u => {
                  const ur = ROLES.find(r => r.value === u.role) || ROLES[3]
                  const isEditing = editingUser === u.id
                  return (
                    <div key={u.id} style={{ border: `1px solid ${isEditing ? 'var(--accent)' : 'var(--border)'}`, borderRadius: '12px', padding: isEditing ? '20px' : '12px 16px', background: isEditing ? 'rgba(108,99,255,.04)' : 'var(--surface2)', transition: 'all .15s' }}>
                      {isEditing ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>
                            <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)' }}>✏️ เปลี่ยนแปลงข้อมูลแอดมิน</div>
                            <button className="btn btn-outline btn-xs" onClick={() => { setEditingUser(null); setShowPwdChange(false) }}>✕</button>
                          </div>

                          <div className="form-group">
                            <label>👤 ชื่อผู้ใช้</label>
                            <input value={u.full_name} readOnly style={{ background: '#f1f5f9', cursor: 'default' }} />
                          </div>

                          <div className="form-group">
                            <label>👥 บทบาท</label>
                            <select value={editRole} onChange={e => setEditRole(e.target.value)} style={{ padding: '9px 12px' }}>
                              {ROLES.map(ro => <option key={ro.value} value={ro.value}>{ro.icon} {ro.label}</option>)}
                            </select>
                          </div>

                          <div className="form-group">
                            <label>📱 เบอร์โทร</label>
                            <input value={editPhone} onChange={e => setEditPhone(e.target.value)} placeholder="เบอร์โทร" />
                          </div>

                          <div className="form-group">
                            <label>✉️ อีเมล์</label>
                            <input value={editEmail} onChange={e => setEditEmail(e.target.value)} placeholder="อีเมล์" />
                          </div>

                          <div className="form-group">
                            <label>👤+ สร้างเมื่อ</label>
                            <input value={u.created_at ? new Date(u.created_at).toLocaleString('th-TH') : '-'} readOnly style={{ background: '#f1f5f9', cursor: 'default' }} />
                          </div>

                          <div className="form-group">
                            <label>👤 เข้าสู่ระบบล่าสุด</label>
                            <input value={(u as any).last_sign_in_at ? new Date((u as any).last_sign_in_at).toLocaleString('th-TH') : 'ยังไม่เคยเข้าสู่ระบบ'} readOnly style={{ background: '#f1f5f9', cursor: 'default' }} />
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <button type="button" onClick={() => setEditActive(!editActive)}
                              style={{ width: '48px', height: '26px', borderRadius: '13px', border: 'none', background: editActive ? 'var(--green)' : '#d1d5db', cursor: 'pointer', position: 'relative', transition: 'background .2s' }}>
                              <span style={{ position: 'absolute', top: '3px', left: editActive ? '24px' : '3px', width: '20px', height: '20px', borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} />
                            </button>
                            <span style={{ fontSize: '13px', fontWeight: 600, color: editActive ? 'var(--green)' : 'var(--text3)' }}>เปิดใช้งาน: {editActive ? 'เปิด' : 'ปิด'}</span>
                          </div>

                          <div>
                            <label style={{ fontSize: '11px', color: 'var(--text3)', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '.4px' }}>จำกัดเว็บที่เข้าถึงได้</label>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                              {sites.map(s => (
                                <label key={s.id} style={{ padding: '4px 10px', borderRadius: '16px', fontSize: '11px', cursor: 'pointer', background: editSiteAccess.includes(s.name) ? 'rgba(108,99,255,.18)' : 'var(--surface)', border: `1px solid ${editSiteAccess.includes(s.name) ? 'var(--accent)' : 'var(--border)'}`, fontWeight: editSiteAccess.includes(s.name) ? 700 : 400, color: editSiteAccess.includes(s.name) ? 'var(--accent)' : 'var(--text2)' }}>
                                  <input type="checkbox" checked={editSiteAccess.includes(s.name)} onChange={e => setEditSiteAccess(e.target.checked ? [...editSiteAccess, s.name] : editSiteAccess.filter(x => x !== s.name))} style={{ display: 'none' }} />
                                  {s.name}
                                </label>
                              ))}
                            </div>
                          </div>

                          {/* ─── Change Password Section ─── */}
                          {showPwdChange && (
                            <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '10px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                              <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>🔒 เปลี่ยนรหัสผ่าน</div>
                              <div className="form-group">
                                <label>รหัสผ่านใหม่</label>
                                <input type="password" value={editPwdForm.newPwd} onChange={e => setEditPwdForm({ ...editPwdForm, newPwd: e.target.value })} placeholder="อย่างน้อย 6 ตัวอักษร" />
                                {editPwdForm.newPwd && (
                                  <div style={{ marginTop: '4px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '3px' }}>
                                      <span style={{ fontSize: '11px', color: 'var(--text3)' }}>ความแข็งแรง:</span>
                                      <span style={{ fontSize: '11px', fontWeight: 700, color: strengthLevel(editPwdForm.newPwd).color }}>{strengthLevel(editPwdForm.newPwd).label}</span>
                                    </div>
                                    <div style={{ background: '#e5e7eb', borderRadius: '3px', height: '4px', overflow: 'hidden' }}>
                                      <div style={{ height: '100%', background: strengthLevel(editPwdForm.newPwd).color, borderRadius: '3px', width: `${strengthLevel(editPwdForm.newPwd).pct}%`, transition: 'all .3s' }} />
                                    </div>
                                    {editPwdForm.newPwd.length < 6 && <div style={{ fontSize: '11px', color: 'var(--red)', marginTop: '3px' }}>รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร</div>}
                                  </div>
                                )}
                              </div>
                              <div className="form-group">
                                <label>ยืนยันรหัสผ่านใหม่</label>
                                <input type="password" value={editPwdForm.confirmPwd} onChange={e => setEditPwdForm({ ...editPwdForm, confirmPwd: e.target.value })} placeholder="ยืนยันรหัสผ่าน" />
                                {editPwdForm.confirmPwd && editPwdForm.newPwd !== editPwdForm.confirmPwd && <div style={{ fontSize: '11px', color: 'var(--red)', marginTop: '3px' }}>รหัสผ่านไม่ตรงกัน</div>}
                                {editPwdForm.confirmPwd && editPwdForm.newPwd === editPwdForm.confirmPwd && <div style={{ fontSize: '11px', color: 'var(--green)', marginTop: '3px' }}>✓ รหัสผ่านตรงกัน</div>}
                              </div>
                              <button type="button" className="btn btn-primary btn-sm" onClick={() => handleChangeUserPwd(u.id)} disabled={!editPwdForm.newPwd || editPwdForm.newPwd.length < 6 || editPwdForm.newPwd !== editPwdForm.confirmPwd}>ยืนยันเปลี่ยนรหัสผ่าน</button>
                            </div>
                          )}

                          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            <button type="button" className="btn btn-sm" style={{ background: '#4f46e5', color: '#fff' }} onClick={() => { setShowPwdChange(!showPwdChange); setEditPwdForm({ newPwd: '', confirmPwd: '' }) }}>เปลี่ยนรหัสผ่าน</button>
                            {!(u as any).is_active && u.id !== profile.id && <button type="button" className="btn btn-sm" style={{ background: '#ec4899', color: '#fff' }} onClick={() => { setEditActive(true) }}>ปลดล็อคการเข้าสู่ระบบ</button>}
                          </div>

                          <button type="button" className="btn" style={{ background: '#f59e0b', color: '#fff', padding: '12px', fontSize: '14px', fontWeight: 700, width: '100%' }} onClick={() => handleSaveUserEdit(u.id)}>💾 บันทึก</button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: `${ur.color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', flexShrink: 0 }}>{ur.icon}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                              {u.full_name}
                              {u.id === profile.id && <span style={{ fontSize: '11px', color: 'var(--accent)', fontWeight: 700 }}>(ฉัน)</span>}
                              {(u as any).is_active === false && <span style={{ fontSize: '11px', color: '#fff', background: 'var(--red)', padding: '1px 6px', borderRadius: '8px' }}>ปิดใช้งาน</span>}
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--text3)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</div>
                          </div>
                          <span style={{ background: `${ur.color}18`, color: ur.color, padding: '3px 10px', borderRadius: '16px', fontSize: '11px', fontWeight: 700, flexShrink: 0 }}>{ur.label}</span>
                          {u.site_access && u.site_access.length > 0 && <span style={{ fontSize: '11px', color: 'var(--text3)', flexShrink: 0 }}>{u.site_access.length} เว็บ</span>}
                          {!isViewer && <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                            <button className="btn btn-outline btn-xs" onClick={() => { setEditingUser(u.id); setEditRole(u.role); setEditSiteAccess(u.site_access || []); setEditPhone((u as any).phone || ''); setEditEmail(u.email); setEditActive((u as any).is_active !== false); setShowPwdChange(false); setShowAddForm(false) }}>แก้ไข</button>
                            {u.id !== profile.id && <button className="btn btn-xs" style={{ background: 'rgba(239,68,68,.1)', border: '1px solid var(--red)', color: 'var(--red)' }} onClick={() => handleDeleteUser(u)}>ลบ</button>}
                          </div>}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ─── Change Own Password ─── */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '16px', padding: '24px', marginBottom: '20px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)', marginBottom: '16px' }}>🔑 เปลี่ยนรหัสผ่านของฉัน</h3>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '400px' }}>
            <div className="form-group">
              <label>รหัสผ่านปัจจุบัน</label>
              <input type="password" value={form.current} onChange={e => setForm({ ...form, current: e.target.value })} placeholder="กรอกรหัสผ่านปัจจุบัน" required />
            </div>
            <div className="form-group">
              <label>รหัสผ่านใหม่</label>
              <input type="password" value={form.newPwd} onChange={e => setForm({ ...form, newPwd: e.target.value })} placeholder="อย่างน้อย 6 ตัวอักษร" required />
              {form.newPwd && (
                <div style={{ marginTop: '6px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--text3)' }}>ความแข็งแรง:</span>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: strength.color }}>{strength.label}</span>
                  </div>
                  <div style={{ background: '#e5e7eb', borderRadius: '4px', height: '5px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', background: strength.color, borderRadius: '4px', width: `${strength.pct}%`, transition: 'all .3s' }} />
                  </div>
                </div>
              )}
            </div>
            <div className="form-group">
              <label>ยืนยันรหัสผ่านใหม่</label>
              <input type="password" value={form.confirm} onChange={e => setForm({ ...form, confirm: e.target.value })} placeholder="กรอกรหัสผ่านใหม่อีกครั้ง" required />
              {form.confirm && form.newPwd !== form.confirm && <div style={{ fontSize: '11px', color: 'var(--red)', marginTop: '4px' }}>รหัสผ่านไม่ตรงกัน</div>}
              {form.confirm && form.newPwd === form.confirm && form.confirm.length >= 6 && <div style={{ fontSize: '11px', color: 'var(--green)', marginTop: '4px' }}>✓ รหัสผ่านตรงกัน</div>}
            </div>
            <button type="submit" className="btn btn-primary" disabled={loading || !form.current || form.newPwd.length < 6 || form.newPwd !== form.confirm} style={{ padding: '10px 24px', alignSelf: 'flex-start' }}>
              {loading ? 'กำลังเปลี่ยน...' : '🔐 เปลี่ยนรหัสผ่าน'}
            </button>
          </form>
        </div>

        {/* ─── Role Permissions Reference ─── */}
        {canViewAdmin && showPermissions && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '16px', padding: '24px', marginBottom: '20px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)', marginBottom: '14px' }}>🛡️ ตารางสิทธิ์ตามบทบาท</h3>
            <div className="table-wrap">
              <table style={{ fontSize: '12px' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>ฟีเจอร์</th>
                    {ROLES.map(r => <th key={r.value} style={{ textAlign: 'center', color: r.color }}>{r.icon} {r.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {PERMISSIONS.map(p => (
                    <tr key={p.feature}>
                      <td style={{ fontWeight: 500 }}>{p.feature}</td>
                      {ROLES.map(r => {
                        const allowed = p[r.value as keyof typeof p]
                        return <td key={r.value} style={{ textAlign: 'center', fontSize: '14px' }}>{allowed ? '✅' : '❌'}</td>
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        </>)}
      </div>

      {toast.msg && <div className={`toast ${toast.type}`}>{toast.msg}</div>}
    </div>
  )
}
