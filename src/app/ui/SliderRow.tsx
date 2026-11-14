import { useSteppedRange } from './sliderStep';
import ui from './ui.module.css';

interface Props {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  /** Display units per value unit for Shift/Alt steps (100 = percent); null turns them off. */
  unit?: number | null;
  /** Label and value above a full-width track, for long ranges that need the precision. */
  wide?: boolean;
  onChange: (value: number) => void;
}

/** Label, slider and value on one row (panels). Shift and Alt step coarsely (Settings → Input). */
export function SliderRow({
  label,
  value,
  min,
  max,
  step = 0.01,
  format,
  unit,
  wide,
  onChange,
}: Props) {
  const stepped = useSteppedRange({ value, min, max, unit, onChange });
  return (
    <label className={wide ? ui.wideRow : ui.row}>
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={stepped.onPointerDown}
        onPointerMove={stepped.onPointerMove}
        onKeyDown={stepped.onKeyDown}
        onChange={(e) => onChange(stepped.snap(Number(e.target.value)))}
      />
      <output>{format ? format(value) : value}</output>
    </label>
  );
}
