"use client";

import { useEffect, useRef } from "react";

export type CadCommandItem = {
  name: string;
  category: string;
  keywords: string;
  action: () => void;
  disabled?: boolean;
};

type CadCommandPaletteProps = {
  open: boolean;
  query: string;
  items: CadCommandItem[];
  onQueryChange: (query: string) => void;
  onClose: () => void;
};

export function CadCommandPalette({ open, query, items, onQueryChange, onClose }: CadCommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const handleEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose, open]);
  if (!open) return null;
  return <div className="cad-modal-backdrop cad-command-palette-backdrop">
    <button type="button" className="cad-modal-dismiss" aria-label="关闭命令搜索" onMouseDown={onClose} />
    <section className="cad-command-palette" role="dialog" aria-modal="true" aria-label="搜索建模命令">
      <header><input ref={inputRef} value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="搜索命令，例如：草图、选择面、适合窗口…" /><kbd>ESC</kbd></header>
      <div>{items.length ? items.map((item) => <button type="button" key={`${item.category}-${item.name}`} onClick={item.action} disabled={item.disabled}><span><small>{item.category}</small><strong>{item.name}</strong></span><em>执行</em></button>) : <p>没有匹配命令，可以换一个更简单的词。</p>}</div>
      <footer><kbd>Ctrl / Cmd + K</kbd> 打开命令搜索</footer>
    </section>
  </div>;
}
