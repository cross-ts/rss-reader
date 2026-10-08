import { avatarColor, initial } from '../utils/avatar';

export function Avatar({ title, size = 40 }: { title: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex flex-none items-center justify-center rounded-full font-bold text-white uppercase"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.45), background: avatarColor(title) }}
    >
      {initial(title)}
    </span>
  );
}
