'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { homeFor, useAuth } from '@/lib/auth';
import { LoadingBlock } from '@/components/govflow/shell';

export default function IndexPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  React.useEffect(() => {
    if (loading) return;
    router.replace(user ? homeFor(user.role) : '/login');
  }, [user, loading, router]);

  return (
    <main className="mx-auto max-w-md p-10">
      <LoadingBlock label="Loading GovFlow…" />
    </main>
  );
}
