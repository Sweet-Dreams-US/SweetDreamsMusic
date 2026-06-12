'use client';

import React from 'react';

interface EmptyStateProps {
  icon: React.ElementType;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
  secondaryAction?: { label: string; onClick: () => void };
}

export default function EmptyState({ icon: Icon, title, description, action, secondaryAction }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center group">
      <style>{`
        @keyframes borderPulse {
          0%, 100% { border-color: rgba(0,0,0,0.1); }
          50% { border-color: #F4C430; }
        }
        .empty-state-hover:hover {
          animation: borderPulse 2s ease-in-out infinite;
        }
      `}</style>

      <div className="border-2 border-black/10 p-10 empty-state-hover transition-colors">
        <Icon className="w-12 h-12 text-black/15 mx-auto mb-5" />

        <h3 className="font-mono font-bold uppercase text-sm tracking-wider mb-2">
          {title}
        </h3>

        <p className="font-mono text-xs text-black/50 max-w-xs mx-auto mb-6">
          {description}
        </p>

        {action && (
          <button
            onClick={action.onClick}
            className="bg-accent text-black font-mono text-xs font-bold uppercase tracking-wider px-6 py-2.5 hover:bg-accent/90 transition-colors"
          >
            {action.label}
          </button>
        )}

        {secondaryAction && (
          <button
            onClick={secondaryAction.onClick}
            className="block mx-auto mt-3 font-mono text-xs text-black/50 underline underline-offset-2 hover:text-black transition-colors"
          >
            {secondaryAction.label}
          </button>
        )}
      </div>
    </div>
  );
}
