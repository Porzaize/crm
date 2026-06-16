import { NextResponse } from 'next/server'

export async function POST() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!

  const sql = `
    CREATE TABLE IF NOT EXISTS agent_targets (
      id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      agent_id uuid NOT NULL,
      period text NOT NULL,
      period_key text NOT NULL,
      target_calls int NOT NULL DEFAULT 0,
      target_answered int NOT NULL DEFAULT 0,
      target_deposit numeric NOT NULL DEFAULT 0,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now(),
      UNIQUE(agent_id, period, period_key)
    );

    ALTER TABLE agent_targets ENABLE ROW LEVEL SECURITY;

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'agent_targets' AND policyname = 'Allow authenticated read'
      ) THEN
        CREATE POLICY "Allow authenticated read" ON agent_targets FOR SELECT TO authenticated USING (true);
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'agent_targets' AND policyname = 'Allow authenticated write'
      ) THEN
        CREATE POLICY "Allow authenticated write" ON agent_targets FOR ALL TO authenticated USING (true) WITH CHECK (true);
      END IF;
    END $$;
  `

  // Extract project ref from URL
  const ref = url.replace('https://', '').replace('.supabase.co', '')

  // Try multiple SQL execution endpoints
  const endpoints = [
    `${url}/rest/v1/rpc/exec_sql`,
    `${url}/pg/query`,
  ]

  let lastError = ''

  // Method 1: Try pg/query endpoint (pg-meta)
  try {
    const res = await fetch(`${url}/pg/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-supabase-key': key,
        'Authorization': `Bearer ${key}`,
        'apikey': key,
      },
      body: JSON.stringify({ query: sql }),
    })
    if (res.ok) {
      return NextResponse.json({ success: true, method: 'pg-query' })
    }
    lastError = `pg/query: ${res.status} ${await res.text()}`
  } catch (e: any) {
    lastError = `pg/query: ${e.message}`
  }

  // Method 2: Try using the Supabase Management API
  try {
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({ query: sql }),
    })
    if (res.ok) {
      return NextResponse.json({ success: true, method: 'management-api' })
    }
    lastError += ` | mgmt: ${res.status}`
  } catch (e: any) {
    lastError += ` | mgmt: ${e.message}`
  }

  // Method 3: Try direct postgres via supabase-js rpc
  try {
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    // Try simple table creation via REST - check if table exists
    const { error: checkError } = await supabase.from('agent_targets').select('id').limit(1)

    if (checkError?.code === '42P01') {
      // Table doesn't exist - return SQL for manual creation
      return NextResponse.json({
        success: false,
        needsManualSetup: true,
        error: lastError,
        sql: sql.trim(),
      })
    }

    if (!checkError) {
      return NextResponse.json({ success: true, method: 'already-exists' })
    }

    return NextResponse.json({
      success: false,
      needsManualSetup: true,
      error: lastError + ` | check: ${checkError.message}`,
      sql: sql.trim(),
    })
  } catch (e: any) {
    return NextResponse.json({
      success: false,
      error: lastError + ` | final: ${e.message}`,
      needsManualSetup: true,
      sql: sql.trim(),
    })
  }
}
