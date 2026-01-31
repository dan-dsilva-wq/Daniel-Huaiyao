'use client';

import { useEffect, useRef } from 'react';

interface MathDisplayProps {
  math: string;
  display?: boolean;
  className?: string;
}

// Lazy load KaTeX only when needed
let katexLoaded = false;
let katexPromise: Promise<void> | null = null;

const loadKaTeX = (): Promise<void> => {
  if (katexLoaded) return Promise.resolve();
  if (katexPromise) return katexPromise;

  katexPromise = new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css';
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js';
    script.onload = () => {
      katexLoaded = true;
      resolve();
    };
    document.head.appendChild(script);
  });

  return katexPromise;
};

export default function MathDisplay({ math, display = false, className = '' }: MathDisplayProps) {
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    loadKaTeX().then(() => {
      if (containerRef.current && (window as unknown as { katex: { render: (tex: string, el: HTMLElement, opts: object) => void } }).katex) {
        try {
          (window as unknown as { katex: { render: (tex: string, el: HTMLElement, opts: object) => void } }).katex.render(math, containerRef.current, {
            displayMode: display,
            throwOnError: false,
            trust: true,
          });
        } catch {
          containerRef.current.textContent = math;
        }
      }
    });
  }, [math, display]);

  return (
    <span
      ref={containerRef}
      className={`math-display ${className}`}
      style={{ display: display ? 'block' : 'inline' }}
    >
      {math}
    </span>
  );
}

export function renderMathInText(text: string): React.ReactNode[] {
  const parts = text.split(/(\$\$[\s\S]+?\$\$|\$[^$]+?\$)/g);

  return parts.map((part, index) => {
    if (part.startsWith('$$') && part.endsWith('$$')) {
      const math = part.slice(2, -2);
      return <MathDisplay key={index} math={math} display className="my-4" />;
    } else if (part.startsWith('$') && part.endsWith('$')) {
      const math = part.slice(1, -1);
      return <MathDisplay key={index} math={math} />;
    }
    return <span key={index}>{part}</span>;
  });
}
