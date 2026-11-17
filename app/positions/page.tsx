import type { Metadata } from 'next';
import { Positions } from './positions';
export const metadata: Metadata = { title: 'My positions' };
export default function Page() { return <Positions />; }
