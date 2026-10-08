const P = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  subs: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  check: '<path d="m5 12.5 5 5L19 7"/>',
  share: '<path d="M12 15V4m0 0L8 8m4-4 4 4M5 13v6h14v-6"/>',
} as const;

export type IconName = keyof typeof P;

interface Props {
  name: IconName;
  small?: boolean;
  className?: string;
}

export function Icon({ name, small, className = '' }: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={`flex-none fill-none stroke-current ${small ? 'size-[18px]' : 'size-6'} ${className}`}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: P[name] }}
    />
  );
}

export function Logo({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" aria-label="Reader" className={className}>
      <rect width="40" height="40" rx="10" fill="#FF6719" />
      <path
        d="M11 14a15 15 0 0 1 15 15M11 21a8 8 0 0 1 8 8"
        stroke="#fff"
        strokeWidth="3.2"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="12" cy="28" r="2.4" fill="#fff" />
    </svg>
  );
}
