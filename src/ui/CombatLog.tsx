import { useState } from 'react';

export function CombatLog({ entries }: { entries: string[][] }) {
  const [open, setOpen] = useState(false);

  if (entries.length === 0) return null;

  return (
    <div className="combat-log">
      <button
        className="combat-log__toggle"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="combat-log-content"
      >
        <span>Combat Log ({entries.length} {entries.length === 1 ? 'entry' : 'entries'})</span>
        <span>{open ? '\u25B2' : '\u25BC'}</span>
      </button>
      {open && (
        <div className="combat-log__content" id="combat-log-content">
          {entries.map((section, si) => (
            <div key={si} className={si > 0 ? 'combat-log__section' : ''}>
              {section.map((line, li) => (
                <div key={li} className="combat-log__entry">{line}</div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
