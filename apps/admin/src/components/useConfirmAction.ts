import { useState } from 'react';

/**
 * The async confirm skeleton of a dialog: ignores a second call while saving, clears the previous failure,
 * and on error keeps the failure and re-enables the dialog. On success `run` is expected to close the dialog,
 * so `saving` stays true.
 */
export function useConfirmAction(run: () => Promise<void>) {
  const [failure, setFailure] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  async function confirm() {
    if (saving) return;
    setSaving(true);
    setFailure(null);
    try {
      await run();
    } catch (error) {
      setFailure(error);
      setSaving(false);
    }
  }

  return { saving, failure, confirm };
}
