'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, ShieldCheck, TriangleAlert } from 'lucide-react';
import { setToken } from '@/lib/api';
import { homeFor, useAuth } from '@/lib/auth';

/**
 * Landing point for the SSO redirect.
 *
 * The token arrives in the URL fragment rather than the query string, so it is
 * never sent to a server, never written to an access log and never leaked in a
 * Referer header. The fragment is cleared as soon as it has been read.
 */
function CallbackHandler() {
  const router = useRouter();
  const params = useSearchParams();
  const { refresh } = useAuth();
  const [error, setError] = React.useState<string | null>(null);
  const [linked, setLinked] = React.useState<number | null>(null);

  React.useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const token = fragment.get('token');
    const linkedCount = Number(fragment.get('linked') ?? '0');

    if (!token) {
      setError('The identity provider did not return a session.');
      return;
    }

    setToken(token);
    setLinked(Number.isFinite(linkedCount) ? linkedCount : null);
    window.history.replaceState(null, '', window.location.pathname);

    void (async () => {
      await refresh();
      const returnTo = params.get('returnTo');
      router.replace(returnTo && returnTo.startsWith('/') ? returnTo : homeFor('CITIZEN'));
    })();
  }, [params, refresh, router]);

  if (error) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div>
          <p className="font-medium">Sign-in could not be completed</p>
          <p className="mt-1 text-muted-foreground">{error}</p>
          <button
            className="mt-3 text-primary underline underline-offset-4"
            onClick={() => router.replace('/login')}
          >
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <ShieldCheck className="size-8 text-primary" />
      <p className="text-sm font-medium">Identity verified</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        {linked === null
          ? 'Completing sign-in…'
          : `MeriPehchaan (Simulated) confirmed your identity and shared your identifiers at ${linked} department${linked === 1 ? '' : 's'}.`}
      </p>
      <Loader2 className="mt-2 size-4 animate-spin text-muted-foreground" />
    </div>
  );
}

export default function SsoCallbackPage() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md items-center justify-center px-4">
      <React.Suspense
        fallback={<Loader2 className="size-5 animate-spin text-muted-foreground" />}
      >
        <CallbackHandler />
      </React.Suspense>
    </main>
  );
}
