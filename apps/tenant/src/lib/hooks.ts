import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@immo/ui';

/** Mutation mit Erfolgsmeldung, Fehlermeldung und Cache-Invalidierung. */
export function useAction<TArgs, TRes = unknown>(fn: (args: TArgs) => Promise<TRes>, opts: { success?: string | ((r: TRes) => string); invalidate?: readonly unknown[][]; onSuccess?: (r: TRes) => void } = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      if (opts.success) toast(typeof opts.success === 'function' ? opts.success(r) : opts.success);
      for (const k of opts.invalidate ?? []) qc.invalidateQueries({ queryKey: k });
      opts.onSuccess?.(r);
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });
}
