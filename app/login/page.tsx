import type { Metadata } from 'next';
import { SITE_URL } from '@/lib/constants';
import { getBrand } from '@/lib/brand-server';
import AuthForm from '@/components/auth/AuthForm';

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand();
  return {
    title: 'Sign In',
    description: `Sign in to your ${brand.name} account to book sessions, view your files, and manage your profile.`,
    alternates: { canonical: `${SITE_URL}/login` },
  };
}

export default function LoginPage() {
  return (
    <section className="bg-white text-black min-h-[80vh] flex items-center justify-center py-20">
      <div className="max-w-md w-full mx-auto px-4 sm:px-6">
        <div className="text-center mb-8">
          <h1 className="text-heading-xl mb-3">SIGN IN</h1>
          <p className="font-mono text-sm text-black/60">
            Sign in to book sessions, view your files, and manage your profile.
          </p>
        </div>
        <AuthForm />
      </div>
    </section>
  );
}
