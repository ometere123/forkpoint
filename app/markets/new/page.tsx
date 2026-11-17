import type { Metadata } from 'next';
import { CreateMarket } from './form';
export const metadata: Metadata = { title: 'Create a market' };
export default function Page() { return <CreateMarket />; }
