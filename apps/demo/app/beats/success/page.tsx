import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CheckCircle, Loader2 } from 'lucide-react';
import BeatSuccessClient from '@/components/beats/BeatSuccessClient';

export const metadata: Metadata = {
  title: 'Purchase Complete',
};

export default function BeatSuccessPage() {
  return (
    <>
      <section className="bg-black text-white py-16 sm:py-24">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <CheckCircle className="w-16 h-16 text-accent mx-auto mb-6" strokeWidth={1} />
          <h1 className="text-display-md mb-4">PURCHASE COMPLETE</h1>
          <p className="font-mono text-white/60 text-body-sm">
            Your beat license is ready. Download your files below.
          </p>
        </div>
      </section>

      <section className="bg-white text-black py-12 sm:py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <Suspense fallback={
            <div className="text-center py-12">
              <Loader2 className="w-8 h-8 text-accent mx-auto animate-spin" />
            </div>
          }>
            <BeatSuccessClient />
          </Suspense>
        </div>
      </section>
    </>
  );
}
