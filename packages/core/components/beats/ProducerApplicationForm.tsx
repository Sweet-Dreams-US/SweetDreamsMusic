'use client';

import { useState } from 'react';
import { Plus, X, Upload, CheckCircle, Loader2 } from 'lucide-react';

export default function ProducerApplicationForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [producerName, setProducerName] = useState('');
  const [portfolioLinks, setPortfolioLinks] = useState<string[]>(['']);
  const [genreSpecialties, setGenreSpecialties] = useState('');
  const [reason, setReason] = useState('');
  const [sampleBeat, setSampleBeat] = useState<File | null>(null);
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  function addLink() {
    setPortfolioLinks((prev) => [...prev, '']);
  }

  function removeLink(index: number) {
    setPortfolioLinks((prev) => prev.filter((_, i) => i !== index));
  }

  function updateLink(index: number, value: string) {
    setPortfolioLinks((prev) => prev.map((l, i) => (i === index ? value : l)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !email || !producerName) return;

    setStatus('submitting');
    setErrorMsg('');

    const formData = new FormData();
    formData.append('name', name);
    formData.append('email', email);
    formData.append('producer_name', producerName);
    formData.append('portfolio_links', JSON.stringify(portfolioLinks.filter(Boolean)));
    formData.append('genre_specialties', genreSpecialties);
    formData.append('reason', reason);
    if (sampleBeat) formData.append('sample_beat', sampleBeat);

    try {
      const res = await fetch('/api/producer/apply', { method: 'POST', body: formData });
      const data = await res.json();

      if (res.ok) {
        setStatus('success');
      } else {
        setErrorMsg(data.error || 'Something went wrong');
        setStatus('error');
      }
    } catch {
      setErrorMsg('Network error. Please try again.');
      setStatus('error');
    }
  }

  if (status === 'success') {
    return (
      <div className="border-2 border-accent p-12 text-center">
        <CheckCircle className="w-16 h-16 text-accent mx-auto mb-6" strokeWidth={1} />
        <h3 className="text-heading-lg mb-4">APPLICATION SUBMITTED</h3>
        <p className="font-mono text-black/60 text-body-sm max-w-lg mx-auto">
          Thank you for your interest in selling beats on Sweet Dreams Music.
          We&apos;ll review your application and get back to you within a few business days.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Name + Email */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block font-mono text-xs text-black/60 uppercase tracking-wider mb-1">
            Full Name *
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full border-2 border-black px-4 py-3 font-mono text-sm bg-transparent focus:border-accent focus:outline-none transition-colors"
            placeholder="Your name"
          />
        </div>
        <div>
          <label className="block font-mono text-xs text-black/60 uppercase tracking-wider mb-1">
            Email *
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full border-2 border-black px-4 py-3 font-mono text-sm bg-transparent focus:border-accent focus:outline-none transition-colors"
            placeholder="your@email.com"
          />
        </div>
      </div>

      {/* Producer Name */}
      <div>
        <label className="block font-mono text-xs text-black/60 uppercase tracking-wider mb-1">
          Producer / Artist Name *
        </label>
        <input
          type="text"
          value={producerName}
          onChange={(e) => setProducerName(e.target.value)}
          required
          className="w-full border-2 border-black px-4 py-3 font-mono text-sm bg-transparent focus:border-accent focus:outline-none transition-colors"
          placeholder="Your producer name"
        />
      </div>

      {/* Portfolio Links */}
      <div>
        <label className="block font-mono text-xs text-black/60 uppercase tracking-wider mb-2">
          Portfolio Links
        </label>
        <p className="font-mono text-[10px] text-black/40 mb-2">
          SoundCloud, YouTube, BeatStars, Spotify, etc.
        </p>
        <div className="space-y-2">
          {portfolioLinks.map((link, i) => (
            <div key={i} className="flex gap-2">
              <input
                type="url"
                value={link}
                onChange={(e) => updateLink(i, e.target.value)}
                className="flex-1 border-2 border-black px-4 py-3 font-mono text-sm bg-transparent focus:border-accent focus:outline-none transition-colors"
                placeholder="https://soundcloud.com/yourname"
              />
              {portfolioLinks.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeLink(i)}
                  className="border-2 border-black/20 px-3 text-black/40 hover:text-red-500 hover:border-red-300 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={addLink}
            className="font-mono text-xs text-accent hover:text-accent/80 uppercase tracking-wider inline-flex items-center gap-1"
          >
            <Plus className="w-3 h-3" /> Add Link
          </button>
        </div>
      </div>

      {/* Genre Specialties */}
      <div>
        <label className="block font-mono text-xs text-black/60 uppercase tracking-wider mb-1">
          Genre Specialties
        </label>
        <input
          type="text"
          value={genreSpecialties}
          onChange={(e) => setGenreSpecialties(e.target.value)}
          className="w-full border-2 border-black px-4 py-3 font-mono text-sm bg-transparent focus:border-accent focus:outline-none transition-colors"
          placeholder="Hip-Hop, R&B, Trap, Pop (comma separated)"
        />
      </div>

      {/* Sample Beat Upload */}
      <div>
        <label className="block font-mono text-xs text-black/60 uppercase tracking-wider mb-1">
          Sample Beat
        </label>
        <p className="font-mono text-[10px] text-black/40 mb-2">
          Upload one of your best beats so we can hear your work.
        </p>
        <label className="border-2 border-dashed border-black/20 p-6 flex flex-col items-center gap-2 cursor-pointer hover:border-accent transition-colors">
          <Upload className="w-6 h-6 text-black/30" />
          <span className="font-mono text-xs text-black/50">
            {sampleBeat ? sampleBeat.name : 'Click to upload (MP3, WAV)'}
          </span>
          <input
            type="file"
            accept="audio/*"
            onChange={(e) => setSampleBeat(e.target.files?.[0] || null)}
            className="hidden"
          />
        </label>
      </div>

      {/* Reason */}
      <div>
        <label className="block font-mono text-xs text-black/60 uppercase tracking-wider mb-1">
          Why do you want to sell on Sweet Dreams?
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={4}
          className="w-full border-2 border-black px-4 py-3 font-mono text-sm bg-transparent focus:border-accent focus:outline-none transition-colors resize-none"
          placeholder="Tell us about yourself, your production style, and why you'd be a good fit..."
        />
      </div>

      {errorMsg && (
        <p className="font-mono text-sm text-red-600">{errorMsg}</p>
      )}

      <button
        type="submit"
        disabled={!name || !email || !producerName || status === 'submitting'}
        className="bg-black text-white font-mono text-base font-bold tracking-wider uppercase px-8 py-4 hover:bg-black/80 transition-colors disabled:opacity-50 inline-flex items-center gap-2"
      >
        {status === 'submitting' ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" /> Submitting...
          </>
        ) : (
          'SUBMIT APPLICATION'
        )}
      </button>
    </form>
  );
}
