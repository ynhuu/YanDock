const paths = {
  terminal: 'm5 7 4 5-4 5m7 0h7',
  plus: 'M12 5v14M5 12h14',
  more: 'M5 11v2m7-2v2m7-2v2',
  close: 'm6 6 12 12M6 18 18 6',
  logout: 'M9 4H4v16h5m6-12 4 4-4 4m-6-4h10',
  system: 'M4 4h16v12H4zM8 20h8m-4-4v4',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  enter: 'M9 10 4 15l5 5M20 4v7a4 4 0 0 1-4 4H4',
  keyboard: 'M3 3h18v12H3zM6 7h1m4 0h1m4 0h1M7 11h10M8 20h8',
  text: 'M4 5h16M12 5v14M8 19h8',
  folder:
    'M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 10h18',
  file: 'M6 3h8l4 4v14H6zM14 3v5h5M9 13h6m-6 4h6',
  upload: 'M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4',
  download: 'M12 4v12m-5-5 5 5 5-5M4 17v3h16v-3',
  openExternal:
    'M14 4h6v6m-1-5-8 8M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6',
  flask: 'M9 3h6m-5 0v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3m-7 10h12',
  refresh:
    'M20 7v5h-5M4 17v-5h5m-4-3a8 8 0 0 1 13-3l2 1m-16 8-2 1a8 8 0 0 0 13 3',
  rotateCcw: 'M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5',
  trash: 'M3 6h18M8 6V4h8v2m3 0-.9 14H5.9L5 6m5 4v6m4-6v6',
  back: 'M19 12H5m7 7-7-7 7-7',
  chevronLeft: 'm15 18-6-6 6-6',
  chevronRight: 'm9 18 6-6-6-6',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  eyeOff:
    'm3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A11 11 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.1 3.8M6.2 6.2C3.5 8 2 12 2 12s3.5 7 10 7a10 10 0 0 0 4-.8',
  sidebar: 'M4 4h16v16H4zM9 4v16',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18m0 8v6m0-10h.01',
  check: 'm5 12 4 4L19 6',
  warning:
    'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0ZM12 9v4m0 4h.01',
  error:
    'M12 8v5m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  sun: 'M12 3v2m0 14v2M5.64 5.64l1.42 1.42m9.88 9.88 1.42 1.42M3 12h2m14 0h2m-16.36 6.36 1.42-1.42m9.88-9.88 1.42-1.42M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  moon: 'M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13z',
}

export function Icon({
  name,
  size = 18,
}: {
  name: keyof typeof paths
  size?: number
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  )
}
