'use client';
import { useState, type InputHTMLAttributes } from 'react';
import { limitMobileInput } from '@/shared/validation';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'defaultValue' | 'value' | 'type' | 'maxLength' | 'onChange' | 'onPaste'> & { defaultValue?: string };

export function MobileInput({ defaultValue = '', ...props }: Props) {
  const [value, setValue] = useState(() => limitMobileInput(defaultValue));
  // Allow a complete international autofill; the change handler applies the prefix-specific cap.
  return <input {...props} type="tel" inputMode="tel" value={value} maxLength={13}
    onChange={e => setValue(limitMobileInput(e.currentTarget.value))}
    onPaste={e => {
      // Handle formatting before the browser's maxlength can cut off phone digits.
      e.preventDefault();
      const input = e.currentTarget;
      const start = input.selectionStart ?? value.length;
      const end = input.selectionEnd ?? start;
      const pasted = e.clipboardData.getData('text');
      setValue(limitMobileInput(value.slice(0, start) + pasted + value.slice(end)));
    }} />;
}
