import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Detail } from './detail';
export const metadata: Metadata = { title: 'Market details' };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^(?:0|[1-9]\d*)$/.test(id) || !Number.isSafeInteger(Number(id))) notFound();
  return <Detail id={Number(id)} />;
}
