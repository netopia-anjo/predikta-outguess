'use client';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { INDUSTRIES } from '@/shared/validation';

interface Props {
  id: string;
  defaultValue?: string;
  required?: boolean;
  disabled?: boolean;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  onChange: () => void;
}

/** Styled select-only combobox; the hidden input keeps the existing FormData contract. */
export function IndustrySelect({ id, defaultValue = '', required, disabled, onChange, ...aria }: Props) {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(Math.max(0, INDUSTRIES.findIndex(o => o === defaultValue)));
  const [placement, setPlacement] = useState({ above: false, height: 280 });
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const activeOption = useRef<HTMLButtonElement>(null);
  const search = useRef({ text: '', at: 0 });
  const listId = `${id}-options`;

  const choose = (index: number) => {
    setValue(INDUSTRIES[index]);
    setOpen(false);
    search.current = { text: '', at: 0 };
    onChange();
  };
  const show = (index = Math.max(0, INDUSTRIES.findIndex(o => o === value))) => {
    const rect = trigger.current?.getBoundingClientRect();
    if (rect) {
      const bounds = root.current?.closest('.screen')?.getBoundingClientRect();
      const below = Math.min(window.innerHeight, bounds?.bottom ?? window.innerHeight) - rect.bottom - 12;
      const above = rect.top - Math.max(0, bounds?.top ?? 0) - 12;
      const upward = below < 180 && above > below;
      setPlacement({ above: upward, height: Math.max(80, Math.min(280, upward ? above : below)) });
    }
    setActive(index);
    setOpen(true);
  };

  useEffect(() => {
    if (!open || disabled) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, disabled]);
  useEffect(() => {
    if (open && !disabled) activeOption.current?.scrollIntoView({ block: 'nearest' });
  }, [open, active, disabled]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const last = INDUSTRIES.length - 1;
    switch (event.key) {
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (open) choose(active); else show();
        return;
      case 'ArrowDown':
        event.preventDefault();
        if (open) setActive(i => Math.min(last, i + 1)); else show();
        return;
      case 'ArrowUp':
        event.preventDefault();
        if (open && event.altKey) choose(active);
        else if (open) setActive(i => Math.max(0, i - 1));
        else show();
        return;
      case 'Home':
      case 'End':
        event.preventDefault();
        show(event.key === 'Home' ? 0 : last);
        return;
      case 'Escape':
        if (open) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
        search.current = { text: '', at: 0 };
        return;
      case 'Tab':
        if (open) choose(active);
        return;
    }
    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    const now = Date.now();
    const text = (now - search.current.at < 700 ? search.current.text : '') + event.key.toLowerCase();
    search.current = { text, at: now };
    const repeated = [...text].every(char => char === text[0]);
    const prefix = repeated ? text[0] : text;
    const start = text.length > 1 && !repeated ? active : active + 1;
    const match = Array.from({ length: INDUSTRIES.length }, (_, offset) => (start + offset) % INDUSTRIES.length)
      .find(index => INDUSTRIES[index].toLowerCase().startsWith(prefix));
    if (match !== undefined) show(match);
  };

  return <div className="industry-select" ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button {...aria} id={id} name="industry" ref={trigger} type="button" role="combobox"
      className="industry-select-trigger" disabled={disabled} aria-required={required}
      aria-expanded={open && !disabled} aria-haspopup="listbox" aria-controls={open && !disabled ? listId : undefined}
      aria-activedescendant={open && !disabled ? `${id}-option-${active}` : undefined}
      onKeyDown={onKeyDown} onClick={() => { if (open) setOpen(false); else show(); }}>
      <span className={value ? '' : 'muted'}>{value || 'Choose…'}</span>
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
    <input type="hidden" name="industry" value={value} disabled={disabled} />
    {open && !disabled && <div id={listId} className={`industry-select-menu${placement.above ? ' above' : ''}`}
      role="listbox" aria-label="Industry" style={{ maxHeight: placement.height }}>
      {INDUSTRIES.map((option, index) => <button key={option} id={`${id}-option-${index}`} type="button"
        role="option" tabIndex={-1} aria-selected={index === active} data-selected={option === value}
        ref={index === active ? activeOption : undefined}
        onPointerMove={() => setActive(index)} onMouseDown={event => event.preventDefault()}
        onClick={() => { choose(index); trigger.current?.focus(); }}>
        <span>{option}</span><span aria-hidden="true">{option === value ? '✓' : ''}</span>
      </button>)}
    </div>}
  </div>;
}
