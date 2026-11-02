import { ActivityHub } from '@/components/hubs/ActivityHub';

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  return <ActivityHub initialTab={tab} />;
}
