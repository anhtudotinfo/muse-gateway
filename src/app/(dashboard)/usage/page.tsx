import { redirect } from 'next/navigation';

// Merged into Activity — keep the old link working.
export default function Page() {
  redirect('/activity');
}
