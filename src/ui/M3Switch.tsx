import { motion } from 'motion/react';
import { Check } from 'lucide-react';
import { M3_FAST_EASE, M3_SPRING } from '../utils/motion';

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
      className="relative w-[52px] h-[32px] rounded-full border-2 transition-colors duration-150 shrink-0 flex items-center cursor-pointer"
    >
      <motion.span
        initial={false}
        animate={{
          x: checked ? 22 : 4,
          scale: checked ? 1 : 0.72,
        }}
        transition={M3_SPRING}
        style={{
          backgroundColor: checked ? 'var(--m3-on-primary)' : 'var(--m3-outline)',
          color: checked ? 'var(--m3-primary)' : 'transparent',
        }}
        className="w-6 h-6 flex items-center justify-center rounded-full shadow-xs"
      >
        <motion.span
          initial={false}
          animate={{ opacity: checked ? 1 : 0, scale: checked ? 1 : 0.6 }}
          transition={M3_FAST_EASE}
          className="flex items-center justify-center"
        >
          <Check className="w-3.5 h-3.5 stroke-[3]" />
        </motion.span>
      </motion.span>
    </button>
  );
}
