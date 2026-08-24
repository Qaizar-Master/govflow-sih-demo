'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, ShieldCheck } from 'lucide-react';
import { homeFor, useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';

/** Demo credentials, surfaced in the UI so a judge never has to hunt for them. */
const DEMO_ACCOUNTS = [
  {
    role: 'Citizen',
    email: 'rohan.prajapati@example.gov.in',
    note: 'No application yet — best for a live end-to-end run',
  },
  { role: 'Officer', email: 'officer@govflow.gov.in', note: 'Review queue and decisions' },
  { role: 'Admin', email: 'admin@govflow.gov.in', note: 'Connector health and failure simulation' },
];

const DEMO_PASSWORD = 'Password@123';

export default function LoginPage() {
  const { login, user, loading } = useAuth();
  const router = useRouter();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState(DEMO_PASSWORD);
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!loading && user) router.replace(homeFor(user.role));
  }, [user, loading, router]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const signedIn = await login(email.trim(), password);
      router.replace(homeFor(signedIn.role));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="gov-accent-bar h-1" />
      <div className="mx-auto grid min-h-[calc(100vh-4px)] max-w-6xl items-center gap-10 px-6 py-10 lg:grid-cols-2">
        <section className="order-2 lg:order-1">
          <div className="mb-6 flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded bg-primary text-lg font-bold text-primary-foreground">
              GF
            </span>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">GovFlow</h1>
              <p className="text-sm text-muted-foreground">
                Government Interoperability &amp; Workflow Orchestration Platform
              </p>
            </div>
          </div>

          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            Departments build their own portals, registries and workflow systems. GovFlow does
            not replace them — it connects them. Reusable connectors normalise four
            differently-shaped departmental systems into one common data model, orchestrate the
            scholarship workflow across them, and give the citizen a single place to track it.
          </p>

          <dl className="mt-6 grid gap-3 sm:grid-cols-2">
            {[
              ['Connect, don’t replace', 'Adapters per department, not a migration'],
              ['Consent first', 'No lookup without a recorded authorisation'],
              ['Human decides', 'AI assists the officer; it never approves'],
              ['Fails visibly', 'Retries, exceptions and SLA are all observable'],
            ].map(([title, body]) => (
              <div key={title} className="rounded-md border border-border bg-card p-3">
                <dt className="text-sm font-medium">{title}</dt>
                <dd className="mt-0.5 text-xs text-muted-foreground">{body}</dd>
              </div>
            ))}
          </dl>

          <Alert variant="warning" className="mt-6">
            <strong>Prototype.</strong> Every departmental system here is simulated and holds
            synthetic data. No real government database is connected.
          </Alert>
        </section>

        <section className="order-1 lg:order-2">
          <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <ShieldCheck className="h-5 w-5 text-primary" /> Sign in
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Use a demo account below, or register as a new citizen.
            </p>

            <form onSubmit={onSubmit} className="mt-5 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="officer@govflow.gov.in"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              {error ? <Alert variant="destructive">{error}</Alert> : null}

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Sign in
              </Button>
            </form>

            <div className="mt-5 border-t border-border pt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Demo accounts · password {DEMO_PASSWORD}
              </p>
              <ul className="space-y-1.5">
                {DEMO_ACCOUNTS.map((account) => (
                  <li key={account.email}>
                    <button
                      type="button"
                      onClick={() => {
                        setEmail(account.email);
                        setPassword(DEMO_PASSWORD);
                      }}
                      className="w-full rounded-md border border-border px-3 py-2 text-left text-xs transition-colors hover:border-primary hover:bg-primary-muted"
                    >
                      <span className="font-medium">{account.role}</span>
                      <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                        {account.email}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        {account.note}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <p className="mt-4 text-center text-sm text-muted-foreground">
              New citizen?{' '}
              <Link href="/register" className="text-primary underline-offset-2 hover:underline">
                Create an account
              </Link>
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
