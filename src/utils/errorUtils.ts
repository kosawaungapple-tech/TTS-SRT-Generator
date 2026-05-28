import { translations, Language } from '../translations';

export const translateError = (err: unknown, language: Language = 'mm'): string => {
  const t = (path: string): string => {
    const keys = path.split('.');
    let current: Record<string, unknown> = translations as unknown as Record<string, unknown>;
    for (const key of keys) {
      if (!current || (current as Record<string, unknown>)[key] === undefined) return path;
      current = (current as Record<string, unknown>)[key] as Record<string, unknown>;
    }
    return (current as unknown as Record<Language, string>)[language] || (current as unknown as Record<string, string>)['en'] || path;
  };

  const error = err as { 
    status?: number; 
    message?: string; 
    error?: { code?: number; status?: string; message?: string } 
  };
  // Handle specific technical error codes or messages
  const status = Number(error.status || (error.error?.code) || (error.message && error.message.match(/\b\d{3}\b/)?.[0]) || 0);
  const rawMessage = (error.message || '').toUpperCase();
  const errorCode = (error.error?.status || '').toUpperCase();

  if (status == 403 || rawMessage.includes('PERMISSION_DENIED') || errorCode.includes('PERMISSION_DENIED')) {
    return t('errors.apiKey');
  }
  if (status == 404 || rawMessage.includes('NOT_FOUND') || errorCode.includes('NOT_FOUND')) {
    return t('errors.modelNotFound');
  }
  if (status == 400 || rawMessage.includes('INVALID_ARGUMENT') || errorCode.includes('INVALID_ARGUMENT')) {
    if (rawMessage.includes('API KEY IS REQUIRED')) {
      return t('generate.noApiKey');
    }
    return t('errors.invalidArgument');
  }
  if (status == 429 || rawMessage.includes('RATE_LIMIT') || rawMessage.includes('RESOURCE_EXHAUSTED') || errorCode.includes('RESOURCE_EXHAUSTED')) {
    return t('errors.rateLimit');
  }
  if (status >= 500 || rawMessage.includes('INTERNAL') || errorCode.includes('INTERNAL')) {
    return t('errors.connection');
  }
  if (rawMessage.includes('TIMEOUT') || rawMessage.includes('DEADLINE_EXCEEDED') || errorCode.includes('DEADLINE_EXCEEDED')) {
    return t('errors.timeout');
  }
  if (rawMessage.includes('EMPTY_TEXT_ERROR')) {
    return t('errors.emptyScript');
  }

  return t('errors.default');
};
