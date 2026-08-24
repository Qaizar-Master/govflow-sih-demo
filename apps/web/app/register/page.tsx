'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { api, setToken } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import type { AuthUser } from '@/lib/types';

export default function RegisterPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [form, setForm] = React.useState({
    name: '',
    email: '',
    password: '',
    citizenExternalId: '',
    dateOfBirth: '',
    district: '',
  });
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const payload: Record<string, string> = {
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
      };
      if (form.citizenExternalId.trim()) {
        payload.citizenExternalId = form.citizenExternalId.trim().toUpperCase();
      } else {
        payload.dateOfBirth = form.dateOfBirth;
        payload.district = form.district.trim();
      }

      const data = await api.publicPost<{
        token: string;
        user: AuthUser;
        registryDataAvailable: boolean;
        notice: string | null;
      }>('/api/auth/register', payload);

      setToken(data.token);
      await refresh();
      if (data.notice) {
        setNotice(data.notice);
        setTimeout(() => router.replace('/dashboard'), 4000);
      } else {
        router.replace('/dashboard');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="gov-accent-bar h-1" />
      <div className="mx-auto max-w-lg px-6 py-10">
        <Link href="/login" className="text-sm text-primary underline-offset-2 hover:underline">
          ← Back to sign in
        </Link>

        <div className="mt-4 rounded-lg border border-border bg-card p-6 shadow-sm">
          <h1 className="text-xl font-semibold tracking-tight">Create a citizen account</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Link to an existing synthetic registry identity to see a full cross-department run.
          </p>

          <form onSubmit={onSubmit} className="mt-5 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Full name</Label>
              <Input id="name" required value={form.name} onChange={set('name')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={form.email} onChange={set('email')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={8}
                value={form.password}
                onChange={set('password')}
              />
              <p className="text-xs text-muted-foreground">
                At least 8 characters, including a letter and a digit.
              </p>
            </div>

            <div className="rounded-md border border-border bg-muted/40 p-3">
              <div className="space-y-1.5">
                <Label htmlFor="citizenExternalId">Registry identifier (optional)</Label>
                <Input
                  id="citizenExternalId"
                  placeholder="CIT-1001"
                  value={form.citizenExternalId}
                  onChange={set('citizenExternalId')}
                />
                <p className="text-xs text-muted-foreground">
                  The simulated departments hold records for CIT-1001 … CIT-1010. Supplying one
                  links this login to that identity so verification returns data. Leave blank to
                  register a brand-new identity — verification will then correctly report that no
                  department holds a record.
                </p>
              </div>

              {!form.citizenExternalId.trim() ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="dateOfBirth">Date of birth</Label>
                    <Input
                      id="dateOfBirth"
                      type="date"
                      required
                      value={form.dateOfBirth}
                      onChange={set('dateOfBirth')}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="district">District</Label>
                    <Input id="district" required value={form.district} onChange={set('district')} />
                  </div>
                </div>
              ) : null}
            </div>

            {error ? <Alert variant="destructive">{error}</Alert> : null}
            {notice ? (
              <Alert variant="warning" title="Account created">
                {notice}
              </Alert>
            ) : null}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Create account
            </Button>
          </form>
        </div>
      </div>
    </main>
  );
}
