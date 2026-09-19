import * as RadixSelect from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { type ComponentPropsWithoutRef, type ReactNode, useEffect, useRef, useState } from 'react';

type Props = Omit<ComponentPropsWithoutRef<typeof RadixSelect.Trigger>, 'value' | 'onChange' | 'children'> & {
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: string; disabled?: boolean; }[];
  /** Shown in the trigger in place of the selected label. */
  icon?: ReactNode;
};

export function Select({ value, onValueChange, options, icon, disabled, className = '', onFocus, ...props }: Props) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [portal, setPortal] = useState<HTMLElement>();
  const [contentReady, setContentReady] = useState(false);
  useEffect(() => {
    setPortal(trigger.current?.closest('dialog') || undefined);
    // Forms need Radix's native options even before the user visits this field.
    if (trigger.current?.form) setContentReady(true);
  }, []);
  // Closed Radix content still mounts every option in a DocumentFragment.
  // Prepare on first focus/open, then retain it for closed-menu typeahead.
  return (
    <RadixSelect.Root
      value={`option:${value}`}
      onValueChange={next => onValueChange(next.slice(7))}
      onOpenChange={open => {
        if (open) setContentReady(true);
      }}
      disabled={disabled}
    >
      <RadixSelect.Trigger
        ref={trigger}
        {...props}
        value={value}
        className={`ui-control select-trigger ${className}`}
        onFocus={event => {
          setContentReady(true);
          onFocus?.(event);
        }}
      >
        <span className='select-value'>
          <RadixSelect.Value placeholder='Select…'>{icon ?? options.find(option => option.value === value)?.label ?? value}</RadixSelect.Value>
        </span>
        <RadixSelect.Icon asChild>
          <ChevronDown className='select-chevron w-3.5 h-3.5 shrink-0' />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      {contentReady && (
        <RadixSelect.Portal container={portal}>
          <RadixSelect.Content className='select-popup' position='popper' sideOffset={4} collisionPadding={8} onEscapeKeyDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
            <RadixSelect.ScrollUpButton className='select-scroll'>
              <ChevronUp className='w-4 h-4' />
            </RadixSelect.ScrollUpButton>
            <RadixSelect.Viewport className='select-viewport'>
              {options.map(option => (
                <RadixSelect.Item className='select-option' key={option.value} value={`option:${option.value}`} data-option-value={option.value} disabled={option.disabled}>
                  <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                  <RadixSelect.ItemIndicator className='select-check'>
                    <Check className='w-4 h-4' />
                  </RadixSelect.ItemIndicator>
                </RadixSelect.Item>
              ))}
            </RadixSelect.Viewport>
            <RadixSelect.ScrollDownButton className='select-scroll'>
              <ChevronDown className='w-4 h-4' />
            </RadixSelect.ScrollDownButton>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      )}
    </RadixSelect.Root>
  );
}
