import type { Metadata } from 'next';
import { Explorer } from './explorer';
export const metadata: Metadata = { title: 'Markets' };
export default function Page() { return <Explorer />; }
