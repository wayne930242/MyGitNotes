// Browser fixture: all changes stay in React state; no workspace API is used.
import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Select } from '../src/components/Select.js';
import { NoteStatusSelect } from '../src/components/NoteStatusSelect.js';
import '../src/index.css';

function Fixture() {
  const [value, setValue] = useState('done');
  const [translated, setTranslated] = useState(false);
  const [opens, setOpens] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const options = [
    { value: '', label: 'No status' },
    { value: 'done', label: translated ? '完成' : 'Completed' },
    { value: 'working', label: 'Working' },
    { value: 'waiting', label: 'Waiting', disabled: true },
    { value: 'review', label: 'Review' },
  ];
  return <main style={{ padding: 24, display: 'grid', gap: 16 }}>
    <h1>Select regression fixture</h1>
    <button onClick={() => setValue('done')}>Reset value</button>
    <button onClick={() => setTranslated(t => !t)}>Translate label</button>
    <Select aria-label="Status" value={value} onValueChange={setValue} options={options} />
    <Select aria-label="Read only" value={value} onValueChange={setValue} options={options} disabled />
    <div onClick={() => setOpens(n => n + 1)}>
      <NoteStatusSelect label="Inline status" status={value} statuses={['done', 'working', 'review']}
        readOnly={false} onChange={setValue} />
    </div>
    <output aria-label="Current value">{value || '(empty)'}</output>
    <output aria-label="Opened notes">{opens}</output>
    <button onClick={() => dialog.current?.showModal()}>Open dialog</button>
    <dialog ref={dialog}>
      <button onClick={() => dialog.current?.close()}>Close dialog</button>
      <Select aria-label="Dialog status" value={value} onValueChange={setValue} options={options} />
    </dialog>
    <form onSubmit={event => event.preventDefault()}>
      <Select aria-label="Form status" value={value} onValueChange={setValue} options={options} />
    </form>
  </main>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>);
