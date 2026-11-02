import { Hono } from 'hono'

const app = new Hono<{ Bindings: Env }>()

type Home = { id: string; name: string }
type Member = { id: string; homeId: string; name: string }
type Share = {
  id: string
  memberId: string
  amountCents: number
  paidAt: string | null
}
type Bill = {
  id: string
  homeId: string
  title: string
  totalCents: number
  shares: Share[]
}

app.get('/api/health', (c) => c.json({ status: 'ok' }))

// Create a home.
app.post('/api/homes', async (c) => {
  const body = await c.req.json<{ name?: unknown }>().catch(() => null)

  if (!body || typeof body.name !== 'string' || !body.name.trim()) {
    return c.json({ error: 'A valid home name is required' }, 422)
  }

  const home: Home = {
    id: crypto.randomUUID(),
    name: body.name.trim(),
  }

  await c.env.DB.prepare(
    'INSERT INTO homes (id, name) VALUES (?, ?)',
  ).bind(home.id, home.name).run()

  return c.json(home, 201)
})

// Add a member to a home.
app.post('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare(
    'SELECT id FROM homes WHERE id = ?',
  ).bind(homeId).first()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const body = await c.req.json<{ name?: unknown }>().catch(() => null)

  if (!body || typeof body.name !== 'string' || !body.name.trim()) {
    return c.json({ error: 'A valid member name is required' }, 422)
  }

  const member: Member = {
    id: crypto.randomUUID(),
    homeId,
    name: body.name.trim(),
  }

  await c.env.DB.prepare(
    'INSERT INTO members (id, home_id, name) VALUES (?, ?, ?)',
  ).bind(member.id, member.homeId, member.name).run()

  return c.json(member, 201)
})

// Create a bill and divide it equally among the home's members.
app.post('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare(
    'SELECT id FROM homes WHERE id = ?',
  ).bind(homeId).first()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const body = await c.req.json<{
    title?: unknown
    totalCents?: unknown
  }>().catch(() => null)

  if (
    !body ||
    typeof body.title !== 'string' ||
    !body.title.trim() ||
    typeof body.totalCents !== 'number' ||
    !Number.isSafeInteger(body.totalCents) ||
    body.totalCents <= 0
  ) {
    return c.json({ error: 'A title and positive integer totalCents are required' }, 422)
  }

  const membersResult = await c.env.DB.prepare(
    'SELECT id FROM members WHERE home_id = ? ORDER BY rowid',
  ).bind(homeId).all<{ id: string }>()

  const members = membersResult.results

  if (members.length === 0) {
    return c.json({ error: 'Add at least one member before creating a bill' }, 422)
  }

  const billId = crypto.randomUUID()
  const totalCents = body.totalCents
  const baseAmount = Math.floor(totalCents / members.length)
  const extraCents = totalCents % members.length

  const shares: Share[] = members.map((member, index) => ({
    id: crypto.randomUUID(),
    memberId: member.id,
    amountCents: baseAmount + (index < extraCents ? 1 : 0),
    paidAt: null,
  }))

  await c.env.DB.prepare(
    'INSERT INTO bills (id, home_id, title, total_cents) VALUES (?, ?, ?, ?)',
  ).bind(billId, homeId, body.title.trim(), totalCents).run()

  for (const share of shares) {
    await c.env.DB.prepare(
  'INSERT INTO shares (id, bill_id, member_id, amount_cents) VALUES (?, ?, ?, ?)',
).bind(share.id, billId, share.memberId, share.amountCents).run()
  }

  const bill: Bill = {
    id: billId,
    homeId,
    title: body.title.trim(),
    totalCents,
    shares,
  }

  return c.json(bill, 201)
})

// Pay a share. A repeated request with the same key is safe.
app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const billId = c.req.param('billId')
  const shareId = c.req.param('shareId')
  const key = c.req.header('Idempotency-Key')

  if (!key || !key.trim()) {
    return c.json({ error: 'Idempotency-Key header is required' }, 400)
  }

  const share = await c.env.DB.prepare(
    `SELECT id, member_id AS memberId, amount_cents AS amountCents,
            paid_at AS paidAt, idempotency_key AS idempotencyKey
     FROM shares
     WHERE id = ? AND bill_id = ?`,
  ).bind(shareId, billId).first<{
    id: string
    memberId: string
    amountCents: number
    paidAt: string | null
    idempotencyKey: string | null
  }>()

  if (!share) {
    return c.json({ error: 'Bill or share not found' }, 404)
  }

  if (share.paidAt !== null) {
    if (share.idempotencyKey === key) {
      return c.json({
        id: share.id,
        memberId: share.memberId,
        amountCents: share.amountCents,
        paidAt: share.paidAt,
      })
    }

    return c.json({ error: 'This share has already been paid' }, 409)
  }

  const paidAt = new Date().toISOString()

  const update = await c.env.DB.prepare(
    `UPDATE shares
     SET paid_at = ?, idempotency_key = ?
     WHERE id = ? AND bill_id = ? AND paid_at IS NULL`,
  ).bind(paidAt, key, shareId, billId).run()

  if (update.meta.changes === 0) {
    const current = await c.env.DB.prepare(
      `SELECT id, member_id AS memberId, amount_cents AS amountCents,
              paid_at AS paidAt, idempotency_key AS idempotencyKey
       FROM shares WHERE id = ? AND bill_id = ?`,
    ).bind(shareId, billId).first<{
      id: string
      memberId: string
      amountCents: number
      paidAt: string | null
      idempotencyKey: string | null
    }>()

    if (!current) {
      return c.json({ error: 'Bill or share not found' }, 404)
    }

    if (current.paidAt !== null && current.idempotencyKey === key) {
      return c.json({
        id: current.id,
        memberId: current.memberId,
        amountCents: current.amountCents,
        paidAt: current.paidAt,
      })
    }

    return c.json({ error: 'This share has already been paid' }, 409)
  }

  return c.json({
    id: share.id,
    memberId: share.memberId,
    amountCents: share.amountCents,
    paidAt,
  })
})

// Get each member's outstanding unpaid amount.
app.get('/api/homes/:homeId/balances', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare(
    'SELECT id FROM homes WHERE id = ?',
  ).bind(homeId).first()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const result = await c.env.DB.prepare(
    `SELECT m.id AS memberId,
            m.name AS name,
            COALESCE(SUM(
              CASE WHEN s.paid_at IS NULL THEN s.amount_cents ELSE 0 END
            ), 0) AS outstandingCents
     FROM members m
     LEFT JOIN shares s ON s.member_id = m.id
     LEFT JOIN bills b ON b.id = s.bill_id AND b.home_id = m.home_id
     WHERE m.home_id = ?
     GROUP BY m.id, m.name
     ORDER BY m.rowid`,
  ).bind(homeId).all<{
    memberId: string
    name: string
    outstandingCents: number
  }>()

  return c.json({ balances: result.results })
})

export default app
