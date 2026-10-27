// Знак Douga: кадр с кнопкой play и «кира»-искрой. Та же графика лежит в
// app/icon.svg (фавикон) — правьте их вместе.
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      className="logo-mark"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="douga-logo-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff6fae" />
          <stop offset="1" stopColor="#7c9cff" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="9" fill="url(#douga-logo-gradient)" />
      <path
        d="M13 10.5 23.5 16 13 21.5Z"
        fill="#fff"
        stroke="#fff"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <path
        d="M24 4.3 24.9 6.6 27.2 7.5 24.9 8.4 24 10.7 23.1 8.4 20.8 7.5 23.1 6.6Z"
        fill="#fff"
      />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="logo">
      <LogoMark />
      <span className="logo-word">douga</span>
      <span className="logo-kanji">動画</span>
    </span>
  );
}
