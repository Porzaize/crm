import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export async function POST(req: NextRequest) {
  const { username } = await req.json()
  if (!username) return NextResponse.json({ email: null })

  const input = username.trim().toLowerCase()
  const admin = createAdminClient()
  const { data: profiles } = await admin.from('user_profiles').select('id, full_name')
  const { data: { users } } = await admin.auth.admin.listUsers()

  if (input.includes('@')) {
    const exact = users.find(u => u.email?.toLowerCase() === input)
    if (exact?.email) return NextResponse.json({ email: exact.email })
  }

  const byName = (profiles || []).find(p => {
    const name = (p.full_name || '').toLowerCase()
    const slug = name.replace(/\s+/g, '-')
    const slug2 = name.replace(/\s+/g, '')
    return name === input || slug === input || slug2 === input
  })
  if (byName) {
    const user = users.find(u => u.id === byName.id)
    if (user?.email) return NextResponse.json({ email: user.email })
  }

  const byPrefix = users.find(u => {
    const prefix = (u.email || '').split('@')[0].toLowerCase()
    return prefix === input
  })
  if (byPrefix?.email) return NextResponse.json({ email: byPrefix.email })

  return NextResponse.json({ email: null })
}
