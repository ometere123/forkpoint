import type { Metadata } from 'next';
import { Shell } from './shell';
import { WalletProvider } from './wallet';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'FORKPOINT — Conditional prediction markets', template: '%s | FORKPOINT' },
  description: 'Predict how open-source projects respond to real events on GitHub.',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><WalletProvider><Shell>{children}</Shell></WalletProvider></body></html>;
}
