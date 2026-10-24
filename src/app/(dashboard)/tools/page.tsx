import { redirect } from 'next/navigation';

// Tools section merged into Settings — keep the old route as a redirect.
export default function ToolsPage() {
  redirect('/settings');
}
