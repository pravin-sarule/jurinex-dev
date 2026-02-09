import { useState, useCallback, useEffect } from 'react';
import { listEvidence, uploadEvidence, deleteEvidence } from '../services/draftTemplateApi';

/**
 * Hook for evidence list and upload for a draft
 * @param {string} draftId - Current draft ID
 * @param {boolean} enabled - Whether to fetch (e.g. when draft and panel open)
 */
export function useEvidence(draftId, enabled = true) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  const fetchList = useCallback(async () => {
    if (!draftId) {
      setList([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const evidence = await listEvidence(draftId);
      setList(Array.isArray(evidence) ? evidence : []);
    } catch (err) {
      console.error('Error fetching evidence:', err);
      setError(err.message);
      setList([]);
    } finally {
      setLoading(false);
    }
  }, [draftId]);

  useEffect(() => {
    if (enabled && draftId) fetchList();
    else if (!draftId) setList([]);
  }, [draftId, enabled, fetchList]);

  const upload = useCallback(async (file) => {
    if (!draftId || !file) return;
    setUploading(true);
    setError(null);
    try {
      const result = await uploadEvidence(draftId, file);
      if (result?.evidence) {
        setList((prev) => [...prev, result.evidence]);
      }
      await fetchList();
    } catch (err) {
      console.error('Error uploading evidence:', err);
      throw err;
    } finally {
      setUploading(false);
    }
  }, [draftId, fetchList]);

  const remove = useCallback(async (evidenceId) => {
    if (!draftId || !evidenceId) return;
    try {
      await deleteEvidence(draftId, evidenceId);
      setList((prev) => prev.filter((e) => e.evidenceId !== evidenceId && e.id !== evidenceId));
    } catch (err) {
      console.error('Error deleting evidence:', err);
      throw err;
    }
  }, [draftId]);

  return {
    list,
    loading,
    uploading,
    error,
    fetchList,
    upload,
    remove,
  };
}
