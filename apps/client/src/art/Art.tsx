import { createContext, useContext, useEffect, useState, type CSSProperties } from 'react';
import { api } from '../api';

/** Art ids that exist on the PC, mapped to their file names; empty until loaded. */
const ArtContext = createContext<Record<string, string>>({});

export function ArtProvider({ children }: { children: React.ReactNode }) {
  const [art, setArt] = useState<Record<string, string>>({});
  useEffect(() => {
    api.art().then(setArt, () => setArt({}));
  }, []);
  return <ArtContext.Provider value={art}>{children}</ArtContext.Provider>;
}

/** The file URL of a Codex picture, or null while it does not exist yet. */
export function useArtUrl(id: string | undefined): string | null {
  const art = useContext(ArtContext);
  const file = id ? art[id] : undefined;
  return file ? `/art/${encodeURIComponent(file)}` : null;
}

interface Props {
  id: string | undefined;
  /** Shown to screen readers; decorative pictures pass an empty string. */
  alt: string;
  className?: string;
  /** Width / height, so the placeholder has the same size as the picture will. */
  ratio?: number;
  /** Text drawn on the placeholder (e.g. the initials of a unit). */
  fallback?: string;
  tone?: 'attacker' | 'defender' | 'neutral';
  style?: CSSProperties;
}

/**
 * A Codex picture by art id (plan §1: art never blocks code). Until the file exists, a clean placeholder with the same
 * size and the side colour stands in.
 */
export function Art({ id, alt, className = '', ratio, fallback, tone = 'neutral', style }: Props) {
  const url = useArtUrl(id);
  const sized: CSSProperties = { ...(ratio ? { aspectRatio: String(ratio) } : {}), ...style };
  if (url) return <img src={url} alt={alt} className={`art ${className}`} style={sized} draggable={false} />;
  return (
    <span
      className={`art art-placeholder ${tone} ${className}`}
      style={sized}
      role={alt ? 'img' : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
      data-art={id}
    >
      {fallback && <span className="art-fallback">{fallback}</span>}
    </span>
  );
}

/** Up to two capital letters for a placeholder, from a name ("Expedition Team" → "ET"). */
export function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  if (/[一-鿿]/.test(name)) return name.slice(0, 2);
  return words
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
}
