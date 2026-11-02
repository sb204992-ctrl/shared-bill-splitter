import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'

export const Route = createFileRoute('/')({
  component: Home,
})

type HomeData = {
  id: string
  name: string
}

type Member = {
  id: string
  homeId: string
  name: string
}

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

type Balance = {
  memberId: string
  name: string
  outstandingCents: number
}

async function apiRequest<T>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(url, options)
  const data: unknown = await response.json()

  if (!response.ok) {
    const message =
      typeof data === 'object' &&
      data !== null &&
      'error' in data &&
      typeof data.error === 'string'
        ? data.error
        : 'Something went wrong'

    throw new Error(message)
  }

  return data as T
}

function Home() {
  const [home, setHome] = useState<HomeData | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [bills, setBills] = useState<Bill[]>([])
  const [balances, setBalances] = useState<Balance[]>([])

  const [homeName, setHomeName] = useState('')
  const [memberName, setMemberName] = useState('')
  const [billTitle, setBillTitle] = useState('')
  const [billAmount, setBillAmount] = useState('')

  const [paymentKeys, setPaymentKeys] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  function startAction() {
    setError('')
    setMessage('')
    setLoading(true)
  }

  async function createHome(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    startAction()

    try {
      const result = await apiRequest<HomeData>('/api/homes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: homeName }),
      })

      setHome(result)
      setMembers([])
      setBills([])
      setBalances([])
      setHomeName('')
      setMessage('Home created successfully!')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create home')
    } finally {
      setLoading(false)
    }
  }

  async function addMember(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!home) return

    startAction()

    try {
      const result = await apiRequest<Member>(
        `/api/homes/${home.id}/members`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: memberName }),
        },
      )

      setMembers((current) => [...current, result])
      setMemberName('')
      setMessage('Member added successfully!')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to add member')
    } finally {
      setLoading(false)
    }
  }

  async function createBill(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!home) return

    startAction()

    try {
      const amount = Math.round(Number(billAmount) * 100)

      const result = await apiRequest<Bill>(
        `/api/homes/${home.id}/bills`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: billTitle,
            totalCents: amount,
          }),
        },
      )

      setBills((current) => [...current, result])
      setBillTitle('')
      setBillAmount('')
      setMessage('Bill created and split successfully!')
      await refreshBalances(home.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create bill')
    } finally {
      setLoading(false)
    }
  }

  async function refreshBalances(homeId: string) {
    const result = await apiRequest<{ balances: Balance[] }>(
      `/api/homes/${homeId}/balances`,
    )
    setBalances(result.balances)
  }

  async function payShare(billId: string, shareId: string) {
    if (!home) return

    startAction()

    const key =
      paymentKeys[shareId] ?? crypto.randomUUID()

    setPaymentKeys((current) => ({
      ...current,
      [shareId]: key,
    }))

    try {
      await apiRequest<Share>(
        `/api/bills/${billId}/shares/${shareId}/pay`,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': key },
        },
      )

      setBills((current) =>
        current.map((bill) =>
          bill.id !== billId
            ? bill
            : {
                ...bill,
                shares: bill.shares.map((share) =>
                  share.id === shareId
                    ? { ...share, paidAt: new Date().toISOString() }
                    : share,
                ),
              },
        ),
      )

      await refreshBalances(home.id)
      setMessage('Payment recorded successfully!')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed')
    } finally {
      setLoading(false)
    }
  }

  function formatMoney(cents: number) {
    return `₹${(cents / 100).toFixed(2)}`
  }

  return (
    <main className="page">
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; background: #f4f6fb; color: #20263a; font-family: Arial, sans-serif; }
        .page { max-width: 900px; margin: 0 auto; padding: 35px 20px; }
        .header { background: #293b75; color: white; padding: 28px; border-radius: 16px; margin-bottom: 22px; }
        .header h1 { margin: 0 0 8px; font-size: 30px; }
        .header p { margin: 0; color: #dce4ff; }
        .card { background: white; border-radius: 14px; padding: 22px; margin-bottom: 18px; box-shadow: 0 3px 15px #18264a0d; }
        h2 { margin-top: 0; font-size: 20px; }
        input { width: 100%; padding: 12px; margin: 7px 0 13px; border: 1px solid #d6dbea; border-radius: 8px; font-size: 15px; }
        button { background: #405bc0; color: white; border: 0; border-radius: 8px; padding: 11px 18px; cursor: pointer; font-size: 14px; }
        button:disabled { opacity: .55; cursor: not-allowed; }
        .secondary { background: #e9edfa; color: #293b75; }
        .item { display: flex; justify-content: space-between; gap: 12px; align-items: center; padding: 12px 0; border-bottom: 1px solid #edf0f6; }
        .item:last-child { border-bottom: 0; }
        .muted { color: #68728a; font-size: 14px; }
        .paid { color: #16834b; font-weight: bold; }
        .unpaid { color: #b66b13; font-weight: bold; }
        .notice { padding: 12px 15px; border-radius: 8px; margin-bottom: 15px; background: #e4f5e9; color: #176b38; }
        .error { background: #fde9e9; color: #a52626; }
        .empty { color: #737d92; padding: 12px 0; }
        .balance { font-size: 18px; font-weight: bold; }
        @media (max-width: 550px) { .page { padding: 18px 12px; } .header { padding: 22px; } .item { align-items: flex-start; } }
      `}</style>

      <header className="header">
        <h1>Shared Bill Splitter</h1>
        <p>Share expenses fairly. Keep track of payments easily.</p>
      </header>

      {error && <div className="notice error">{error}</div>}
      {message && <div className="notice">{message}</div>}

      <section className="card">
        <h2>1. Create your home</h2>
        {home ? (
          <p>
            <strong>{home.name}</strong>
            <span className="muted"> — Home created</span>
          </p>
        ) : (
          <form onSubmit={createHome}>
            <label htmlFor="homeName">Home name</label>
            <input
              id="homeName"
              value={homeName}
              onChange={(e) => setHomeName(e.target.value)}
              placeholder="Example: My Shared Home"
              required
            />
            <button disabled={loading}>Create Home</button>
          </form>
        )}
      </section>

      {home && (
        <>
          <section className="card">
            <h2>2. Add members</h2>
            <form onSubmit={addMember}>
              <label htmlFor="memberName">Member name</label>
              <input
                id="memberName"
                value={memberName}
                onChange={(e) => setMemberName(e.target.value)}
                placeholder="Enter member name"
                required
              />
              <button disabled={loading}>Add Member</button>
            </form>

            {members.length === 0 ? (
              <p className="empty">No members added yet.</p>
            ) : (
              members.map((member, index) => (
                <div className="item" key={member.id}>
                  <span>{index + 1}. {member.name}</span>
                  <span className="muted">Member</span>
                </div>
              ))
            )}
          </section>

          <section className="card">
            <h2>3. Create a bill</h2>
            <form onSubmit={createBill}>
              <label htmlFor="billTitle">Bill title</label>
              <input
                id="billTitle"
                value={billTitle}
                onChange={(e) => setBillTitle(e.target.value)}
                placeholder="Example: Electricity"
                required
              />
              <label htmlFor="billAmount">Total amount (₹)</label>
              <input
                id="billAmount"
                type="number"
                min="0.01"
                step="0.01"
                value={billAmount}
                onChange={(e) => setBillAmount(e.target.value)}
                placeholder="Example: 1000"
                required
              />
              <button disabled={loading || members.length === 0}>
                Create and Split Bill
              </button>
              {members.length === 0 && (
                <p className="muted">Add at least one member before creating a bill.</p>
              )}
            </form>
          </section>

          <section className="card">
            <h2>4. Bills and payments</h2>
            {bills.length === 0 ? (
              <p className="empty">No bills created yet.</p>
            ) : (
              bills.map((bill) => (
                <div key={bill.id}>
                  <div className="item">
                    <strong>{bill.title}</strong>
                    <strong>{formatMoney(bill.totalCents)}</strong>
                  </div>

                  {bill.shares.map((share) => {
                    const member = members.find(
                      (item) => item.id === share.memberId,
                    )

                    return (
                      <div className="item" key={share.id}>
                        <div>
                          <strong>{member?.name ?? 'Member'}</strong>
                          <div className="muted">
                            Share: {formatMoney(share.amountCents)}
                          </div>
                        </div>

                        {share.paidAt ? (
                          <span className="paid">Paid ✓</span>
                        ) : (
                          <button
                            disabled={loading}
                            onClick={() => payShare(bill.id, share.id)}
                          >
                            Pay
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              ))
            )}
          </section>

          <section className="card">
            <h2>5. Outstanding balances</h2>
            <button
              className="secondary"
              disabled={loading}
              onClick={async () => {
                startAction()
                try {
                  await refreshBalances(home.id)
                  setMessage('Balances refreshed.')
                } catch (err) {
                  setError(
                    err instanceof Error ? err.message : 'Unable to load balances',
                  )
                } finally {
                  setLoading(false)
                }
              }}
            >
              Refresh Balances
            </button>

            {balances.length === 0 ? (
              <p className="empty">Create a bill to see outstanding balances.</p>
            ) : (
              balances.map((balance) => (
                <div className="item" key={balance.memberId}>
                  <span>{balance.name}</span>
                  <span className="balance">
                    {formatMoney(balance.outstandingCents)}
                  </span>
                </div>
              ))
            )}
          </section>
        </>
      )}

      <p className="muted">
        Shared Bill Splitter · Amounts are calculated and stored in cents.
        Current session data is displayed in this browser session.
      </p>
    </main>
  )
} 