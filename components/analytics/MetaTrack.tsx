'use client';

import { useEffect, useRef } from 'react';
import { trackMeta, type MetaEventParams } from '@/lib/meta-pixel';

/**
 * Fires a Meta standard event ONCE on mount. Lets SERVER pages report a
 * conversion — e.g. ViewContent on a landing page, or Purchase on an order
 * confirmation page — by rendering <MetaTrack event="ViewContent" /> without
 * having to become a client component themselves.
 *
 * The ref guard prevents a double-fire under React StrictMode's dev
 * double-mount, so a Purchase is never counted twice.
 */
export default function MetaTrack({
  event,
  params,
}: {
  event: string;
  params?: MetaEventParams;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    trackMeta(event, params);
    // Fire once on mount; params are captured at first render by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
