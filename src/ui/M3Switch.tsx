import { Check } from 'lucide-react';

interface M3SwitchProps {
  checked: boolean;
  onChange: () => void;
  ariaLabel: string;
}

/**
 * Pixel Android Material 3 Expressive Switch with embedded check affordance
 */
export function M3Switch({ checked, onChange, ariaLabel }: M3SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={onChange}
      style={{
        backgroundColor: checked ? 'var(--m3-primary)' : 'var(--m3-surface-container-high)',
        borderColor: checked ? 'var(--m3-primary)' : 'var(--m3-outline)',
      }}
      className="relative w-[52px] h-[32px] rounded-full border-2 transition-colors duration-200 shrink-0 flex items-center cursor-pointer"
    >
      <span
        style={{
          backgroundColor: checked ? 'var(--m3-on-primary)' : 'var(--m3-outline)',
          color: checked ? 'var(--m3-primary)' : 'transparent',
        }}
        className={`flex items-center justify-center rounded-full shadow-xs transition-all duration-200 ${
          checked ? 'w-6 h-6 translate-x-[22px]' : 'w-4 h-4 translate-x-[4px]'
        }`}
      >
        {checked && <Check className="w-3.5 h-3.5 stroke-[3]" />}
      </span>
    </button>
  );
}
