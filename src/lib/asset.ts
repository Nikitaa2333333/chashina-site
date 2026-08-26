/**
 * Путь к файлу из public/ с учётом того, где сайт стоит на хостинге.
 *
 * Сайт в корне домена   → BASE_URL = '/'          → asset('photos/x.webp') = '/photos/x.webp'
 * Сайт в подпапке /site → BASE_URL = '/site/'     → '/site/photos/x.webp'
 *
 * Ручная склейка `import.meta.env.BASE_URL + 'photos/x'` уже ломала фотографии
 * в соседнем репозитории: BASE_URL то со слэшем на конце, то без, и в подпапке
 * получалось '/sitephotos/x'. Здесь слэш нормализуется ровно один раз.
 *
 * Принимает путь и со слэшем в начале, и без.
 */
export function asset(p: string): string {
  const base = import.meta.env.BASE_URL || '/';
  return `${base.replace(/\/+$/, '')}/${String(p).replace(/^\/+/, '')}`;
}
