// A companion pixel sprite. Renders whichever character `id` names, reusing byte's
// exact wrapper classes so sizing is identical to the old <Byte> everywhere.
import { companionById } from '@/lib/companions';

export function Companion({
  id,
  size = 's28',
  className = '',
}: {
  id: string;
  size?: string;
  className?: string;
}) {
  const c = companionById(id);
  return (
    <span className={`byte ${size} ${className}`.trim()}>
      <img className="bimg" src={c.sprite} alt={c.name} draggable={false} />
    </span>
  );
}
