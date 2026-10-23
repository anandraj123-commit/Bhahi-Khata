"use client";
import { useId } from "react";
export function DateFilter({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  const id = useId();
  return (
    <div className="a-date-range">
      <div className="a-filter">
        <label htmlFor={`${id}-from`}>From</label>
        <input
          id={`${id}-from`}
          className="a-input"
          type="date"
          value={from}
          max={to || undefined}
          onChange={(e) => onChange(e.target.value, to)}
        />
      </div>
      <div className="a-filter">
        <label htmlFor={`${id}-to`}>To</label>
        <input
          id={`${id}-to`}
          className="a-input"
          type="date"
          value={to}
          min={from || undefined}
          onChange={(e) => onChange(from, e.target.value)}
        />
      </div>
    </div>
  );
}
