import { useRef } from 'react';
import { Button, type ButtonProps } from './actions';

export interface FilePickButtonProps extends Omit<ButtonProps, 'onActivate'> {
  accept?: string;
  multiple?: boolean;
  // Fired with the picked File list; empty selections are not reported.
  onFiles?: (files: File[]) => void;
}

/* The single sanctioned bridge to the native file chooser: a visually hidden
   input owned by the library, triggered through a regular peers Button, so
   feature surfaces never hand-roll a raw <input type="file">. The value is
   reset after every pick, allowing the same file to be chosen again. */
export function FilePickButton({ accept, multiple, onFiles, ...buttonProps }: FilePickButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={inputRef} type="file" className="pt-sr-only" tabIndex={-1}
        accept={accept} multiple={multiple}
        onChange={event => {
          const files = [...(event.target.files ?? [])];
          if (files.length) onFiles?.(files);
          event.target.value = '';
        }} />
      <Button {...buttonProps} onActivate={() => inputRef.current?.click()} />
    </>
  );
}
