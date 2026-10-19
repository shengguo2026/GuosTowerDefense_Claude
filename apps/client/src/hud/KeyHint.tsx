import { createContext, useContext, useEffect, useState } from 'react';
import { keyLabel, readKeyboardLayout } from '../input/bindings';

interface KeyContext {
  bindings: Record<string, string>;
  layout?: Map<string, string>;
  /** Keyboard hints are left out on touch screens, where nobody has keys. */
  show: boolean;
}

const KeysContext = createContext<KeyContext>({ bindings: {}, show: false });

export function KeysProvider({
  bindings,
  show,
  children,
}: {
  bindings: Record<string, string>;
  show: boolean;
  children: React.ReactNode;
}) {
  const [layout, setLayout] = useState<Map<string, string> | undefined>(undefined);
  useEffect(() => {
    void readKeyboardLayout().then(setLayout);
  }, []);
  return <KeysContext.Provider value={{ bindings, layout, show }}>{children}</KeysContext.Provider>;
}

/** Leaves out key hints inside it: the hot-seat Defender plays with the mouse only and has no keys (spec §5.2). */
export function NoKeyHints({ children }: { children: React.ReactNode }) {
  const keys = useContext(KeysContext);
  return <KeysContext.Provider value={{ ...keys, show: false }}>{children}</KeysContext.Provider>;
}

export function useKeyLabel(): (action: string) => string | null {
  const { bindings, layout } = useContext(KeysContext);
  return (action) => {
    const code = bindings[action];
    return code ? keyLabel(code, layout) : null;
  };
}

/** The key that triggers an action, drawn as a small key cap on a button. */
export function KeyHint({ action }: { action: string }) {
  const { bindings, layout, show } = useContext(KeysContext);
  const code = bindings[action];
  if (!show || !code) return null;
  return (
    <kbd className="key-hint" aria-hidden="true">
      {keyLabel(code, layout)}
    </kbd>
  );
}
