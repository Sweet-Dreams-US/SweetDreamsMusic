// components/messaging/MessageWidgetSlot.tsx
//
// Server component that conditionally renders the floating chat widget
// for authenticated users. Lives in the root layout so the widget
// appears on every logged-in page (dashboard, /admin, /engineer, etc.)
// without each page importing it.

import { getSessionUser } from '@/lib/auth';
import FloatingChatWidget from './FloatingChatWidget';

export default async function MessageWidgetSlot() {
  const user = await getSessionUser();
  if (!user) return null;
  return <FloatingChatWidget authenticated={true} />;
}
