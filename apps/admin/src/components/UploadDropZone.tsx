import { useId, useRef, useState } from 'react';
import { useStorage } from '../data/storage';
import { cs, glossary } from '../i18n/cs';
import { PICKER_ACCEPT } from '../upload/intake';
import { useUploadActions, useUploadState } from '../upload/UploadProvider';

/**
 * Drop zone and "Vybrat fotky" of the album screen (ADMIN-UX 3.4, F1). While the storage level is full both are
 * disabled and the reason is announced (role=alert); the server still decides on every reserve.
 */
export function UploadDropZone({ albumId, large = false }: { albumId: string; large?: boolean }) {
  const actions = useUploadActions();
  const { notice } = useUploadState();
  const storage = useStorage();
  const full = storage.data?.level === 'full';
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  function choose(list: FileList | null) {
    if (full || !list || list.length === 0) return;
    void actions.submit(albumId, Array.from(list));
  }

  return (
    <div
      className="dropzone"
      data-large={large || undefined}
      data-over={over || undefined}
      data-disabled={full || undefined}
      onDragOver={(event) => {
        event.preventDefault(); // always: otherwise a drop would make the browser open the file
        if (!full) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        choose(event.dataTransfer.files);
      }}
    >
      <label htmlFor={inputId}>{over ? cs.upload.dropActive : cs.album.dropZone}</label>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        multiple
        hidden
        accept={PICKER_ACCEPT}
        disabled={full}
        onChange={(event) => {
          choose(event.target.files);
          event.target.value = ''; // the same files can be picked again
        }}
      />
      <button
        type="button"
        className="button button-primary"
        disabled={full}
        onClick={() => inputRef.current?.click()}
      >
        {glossary.choosePhotos}
      </button>
      {full ? (
        <p className="field-error" role="alert">
          {cs.storage.full}
        </p>
      ) : notice ? (
        <p className="field-error" role="alert">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
