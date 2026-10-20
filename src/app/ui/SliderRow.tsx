import ui from './ui.module.css';

interface Props {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (value: number) => void;
}

/** Label, slider and value on one row (panels). */
export function SliderRow({ label, value, min, max, step = 0.01, format, onChange }: Props) {
  return (
    <label className={ui.row}>
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output>{format ? format(value) : value}</output>
    </label>
  );
}
