'use client';

// components/media/MediaCartContext.tsx
//
// Client-side cart state for the new /dashboard/media cart pattern.
// Lives entirely in React state — page refresh resets the cart, which
// is the right behavior for a low-frequency, high-consideration purchase
// (we don't want a stale cart from 3 days ago surprising the buyer).
//
// The cart sidebar / bottom bar reads from this hook; expandable cards
// (PackageCard, AlaCarteCard) write into it via addItem / removeItem.

import { createContext, useContext, useState, useMemo, type ReactNode } from 'react';
import type { MediaCartItem } from '@/lib/media-cart';

interface CartContextValue {
  items: MediaCartItem[];
  addItem: (item: MediaCartItem) => void;
  removeItem: (id: string) => void;
  clear: () => void;
  totalCents: number;
}

const CartContext = createContext<CartContextValue | null>(null);

export function MediaCartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<MediaCartItem[]>([]);

  const addItem = (item: MediaCartItem) => {
    setItems((prev) => [...prev, item]);
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const clear = () => setItems([]);

  const totalCents = useMemo(
    () => items.reduce((sum, it) => sum + it.computedPriceCents, 0),
    [items],
  );

  return (
    <CartContext.Provider value={{ items, addItem, removeItem, clear, totalCents }}>
      {children}
    </CartContext.Provider>
  );
}

export function useMediaCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error('useMediaCart must be used inside <MediaCartProvider>');
  }
  return ctx;
}
