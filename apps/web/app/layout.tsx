import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/lib/auth';
import { AppShell } from '@/components/govflow/shell';

export const metadata: Metadata = {
  title: 'GovFlow — Government Interoperability & Workflow Orchestration',
  description:
    'Prototype interoperability middleware connecting independently built departmental systems. Synthetic data only.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
