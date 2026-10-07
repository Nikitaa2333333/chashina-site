// Видео сайта: два жанра, одни данные на главную и на страницу /video/.
//
// Почему отдельный раздел: Оксана попросила «проваливаться туда, как со
// статьями» — у неё профессиональных роликов много, а на главной их место
// ограничено. Приём тот же, что у прессы и блога: на главной витрина
// с кнопкой, весь список — своей страницей.
//
// Поле `home` решает, попадает ли ролик на главную. Весь список всегда
// целиком на /video/. Так новый ролик добавляется одной строкой, а
// «убрать со стартовой, оставить в разделе» — это снятый флаг, а не
// правка разметки в двух местах.

export type Demo = {
  title: string;
  time: string;
  src: string;
  poster: string;
  home: boolean;
};

export type Reel = {
  src: string;
  poster: string;
  home: boolean;
};

/** Разборы процедур: горизонтальные ролики из клиники, со звуком. */
export const demos: Demo[] = [
  {
    title: 'Радиоволновой лифтинг',
    time: '2:30',
    src: '/video/method-morpheus.mp4',
    poster: '/video/method-morpheus.webp',
    home: true,
  },
  {
    title: 'Световые и лазерные методики',
    time: '2:39',
    src: '/video/method-fotona.mp4',
    poster: '/video/method-fotona.webp',
    home: true,
  },
];

/** Вертикальные ответы на вопросы — ролики из инстаграма. */
export const reels: Reel[] = ['01', '02', '03', '04'].map((n) => ({
  src: `/video/reels/reel-${n}.mp4`,
  poster: `/video/reels/reel-${n}.webp`,
  home: true,
}));

export const homeDemos = demos.filter((d) => d.home);
export const homeReels = reels.filter((r) => r.home);
