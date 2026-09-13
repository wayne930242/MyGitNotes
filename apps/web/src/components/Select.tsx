import * as RadixSelect from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { useEffect, useRef, useState, type ComponentPropsWithoutRef } from 'react';

type Props = Omit<ComponentPropsWithoutRef<typeof RadixSelect.Trigger>, 'value' | 'onChange' | 'children'> & {
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: string; disabled?: boolean }[];
};

export function Select({ value, onValueChange, options, disabled, className = '', ...props }: Props) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [portal, setPortal] = useState<HTMLElement>();
  useEffect(() => { setPortal(trigger.current?.closest('dialog') || undefined); }, []);
  return <RadixSelect.Root value={`option:${value}`} onValueChange={next => onValueChange(next.slice(7))} disabled={disabled}>
    <RadixSelect.Trigger ref={trigger} {...props} value={value} className={`ui-control select-trigger ${className}`}>
      <span className="select-value"><RadixSelect.Value placeholder="Select…" /></span>
      <RadixSelect.Icon asChild><ChevronDown className="select-chevron w-3.5 h-3.5 shrink-0" /></RadixSelect.Icon>
    </RadixSelect.Trigger>
    <RadixSelect.Portal container={portal}>
      <RadixSelect.Content className="select-popup" position="popper" sideOffset={4} collisionPadding={8} onEscapeKeyDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
        <RadixSelect.ScrollUpButton className="select-scroll"><ChevronUp className="w-4 h-4" /></RadixSelect.ScrollUpButton>
        <RadixSelect.Viewport className="select-viewport">
          {options.map(option => <RadixSelect.Item className="select-option" key={option.value} value={`option:${option.value}`} data-option-value={option.value} disabled={option.disabled}>
            <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
            <RadixSelect.ItemIndicator className="select-check"><Check className="w-4 h-4" /></RadixSelect.ItemIndicator>
          </RadixSelect.Item>)}
        </RadixSelect.Viewport>
        <RadixSelect.ScrollDownButton className="select-scroll"><ChevronDown className="w-4 h-4" /></RadixSelect.ScrollDownButton>
      </RadixSelect.Content>
    </RadixSelect.Portal>
  </RadixSelect.Root>;
}
