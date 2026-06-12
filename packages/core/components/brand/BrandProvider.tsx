'use client';

// BrandProvider — makes the server-loaded Brand available to client components
// (chat widget, forms, notifications) without prop-threading. The app layout
// loads brand via getBrand() and wraps the tree; useBrand() falls back to the
// constants (exact Sweet Dreams literals) if a component renders outside the
// provider, so output never changes for the flagship.

import { createContext, useContext, type ReactNode } from 'react';
import { brandFromConstants, type Brand } from '@/lib/brand';

const BrandContext = createContext<Brand | null>(null);

export function BrandProvider({ brand, children }: { brand: Brand; children: ReactNode }) {
  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>;
}

export function useBrand(): Brand {
  return useContext(BrandContext) ?? brandFromConstants();
}
